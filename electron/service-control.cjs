// Hermes "service" level control: WSL distro + dashboard + Codex auth status,
// whole-stack start/stop, connection test and environment detection.
//
// Start/stop used to return as soon as the commands were *sent*; the UI then
// said "stopped cleanly" even when WSL was still up. Both now poll the real
// status until it matches the request (or a deadline passes) and report an
// explicit `outcome`:
//   start: 'running' | 'timeout' | 'failed'
//   stop:  'stopped' | 'incomplete'
//
// All side effects are injected so tests can run this against the fake
// wsl.exe / powershell.exe harness.

const http = require('node:http');
const { shellQuote } = require('./shell.cjs');
const { publicConfig } = require('./runtime-config.cjs');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// wsl.exe prints UTF-16LE; decoded as UTF-8 that leaves NULs between chars.
function cleanWslText(text) {
  return String(text || '').replace(/\0/g, '').replace(/^﻿/, '');
}

function parseDistroList(stdout) {
  return cleanWslText(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function checkHttp(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let request;
    try {
      request = http.get(url, { timeout: timeoutMs }, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
    } catch {
      resolve(false);
      return;
    }
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function createServiceControl(deps) {
  const {
    getConfig,
    run,
    runWsl,
    runPowerShell,
    wslPath,
    httpCheck = checkHttp,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    startTimeoutMs = 30000,
    stopTimeoutMs = 15000,
    pollMs = 2000
  } = deps;

  function hermesEnvPrefix(cfg = getConfig()) {
    const cd = cfg.labRoot ? `cd ${shellQuote(cfg.labRoot)} && ` : '';
    const home = cfg.hermesHome ? `HERMES_HOME=${shellQuote(cfg.hermesHome)} ` : '';
    return `${cd}${home}`;
  }

  async function isWslRunning() {
    const cfg = getConfig();
    const result = await run(wslPath(), ['-l', '-v'], 6000);
    const text = cleanWslText(`${result.stdout}\n${result.stderr}`);
    return new RegExp(`^\\s*\\*?\\s*${escapeRegExp(cfg.distro)}\\s+Running\\s+2\\s*$`, 'm').test(text);
  }

  async function getGatewayStatus(wslRunning) {
    if (!wslRunning) return 'WSL off';
    const result = await runWsl('systemctl --user is-active hermes-gateway.service 2>/dev/null || true', 8000);
    const value = result.stdout.trim();
    return value || 'unknown';
  }

  async function getAuthStatus(wslRunning) {
    if (!wslRunning) return 'WSL off';
    const cfg = getConfig();
    const cmd = `${hermesEnvPrefix(cfg)}${shellQuote(cfg.hermesCommand)} auth status openai-codex 2>&1 | head -n 1`;
    const result = await runWsl(cmd, 12000);
    const value = result.stdout.trim();
    if (/not logged in|logged out/i.test(value)) return value;
    if (/logged in/i.test(value)) return 'logged in';
    return value || 'unknown';
  }

  async function getStatus() {
    const cfg = getConfig();
    const [wslRunning, dashboardOnline] = await Promise.all([
      isWslRunning(),
      httpCheck(cfg.dashboardUrl)
    ]);
    const [gateway, codexAuth] = await Promise.all([
      getGatewayStatus(wslRunning),
      getAuthStatus(wslRunning)
    ]);
    const ready = Boolean(wslRunning && dashboardOnline && codexAuth === 'logged in');
    return {
      wslRunning,
      dashboardOnline,
      gateway,
      codexAuth,
      ready,
      checkedAt: new Date().toISOString()
    };
  }

  // Poll `probe` until `done(status)` or the deadline; returns the last status.
  // `retry(status)` runs before each wait while not done (e.g. re-terminate).
  async function waitForStatus(probe, done, timeoutMs, retry = null) {
    const deadline = Date.now() + timeoutMs;
    let status = await probe();
    while (!done(status) && Date.now() < deadline) {
      if (retry) await retry(status);
      await sleep(pollMs);
      status = await probe();
    }
    return status;
  }

  async function start({ publish = getStatus } = {}) {
    const cfg = getConfig();
    const task = await runPowerShell(`Start-ScheduledTask -TaskName "${cfg.dashboardTaskName}"`, 10000);
    // Wakes the distro (and fails fast when it does not exist).
    const wake = await runWsl(`${hermesEnvPrefix(cfg)}${shellQuote(cfg.hermesCommand)} gateway status >/dev/null 2>&1 || true`, 12000);
    const status = await waitForStatus(publish, (s) => s.ready, startTimeoutMs);
    let outcome = 'running';
    let error = '';
    if (!status.ready) {
      const reasons = [];
      if (!task.ok) reasons.push(`dashboard task: ${(task.stderr || task.error || '').trim().split(/\r?\n/)[0]}`);
      if (!wake.ok) reasons.push(`wsl: ${cleanWslText(wake.stdout || wake.stderr || wake.error).trim().split(/\r?\n/)[0]}`);
      if (!status.wslRunning) reasons.push('WSL distro is not running');
      if (!status.dashboardOnline) reasons.push('dashboard is not answering');
      if (status.codexAuth !== 'logged in') reasons.push(`codex auth: ${status.codexAuth}`);
      outcome = !task.ok || !wake.ok ? 'failed' : 'timeout';
      error = reasons.join('; ');
    }
    return { ...status, outcome, error };
  }

  async function stop({ publish = getStatus } = {}) {
    const cfg = getConfig();
    await runPowerShell(`Stop-ScheduledTask -TaskName "${cfg.dashboardTaskName}"`, 10000);
    await runWsl(`systemctl --user stop hermes-dashboard.service >/dev/null 2>&1 || true; ${hermesEnvPrefix(cfg)}${shellQuote(cfg.hermesCommand)} gateway stop >/dev/null 2>&1 || systemctl --user stop hermes-gateway.service >/dev/null 2>&1 || true`, 15000);
    await run(wslPath(), ['--terminate', cfg.distro], 15000);
    // Any `wsl -d` call still in flight (a background poll) boots the distro
    // again right after the terminate, so terminate again while it is up.
    const status = await waitForStatus(publish, (s) => !s.wslRunning && !s.dashboardOnline, stopTimeoutMs, async (s) => {
      if (s.wslRunning) await run(wslPath(), ['--terminate', cfg.distro], 15000);
    });
    const outcome = !status.wslRunning && !status.dashboardOnline ? 'stopped' : 'incomplete';
    const error = outcome === 'stopped' ? '' : [status.wslRunning ? 'WSL distro still running' : '', status.dashboardOnline ? 'dashboard still answering' : ''].filter(Boolean).join('; ');
    return { ...status, outcome, error };
  }

  // Full WSL shutdown: `wsl --shutdown` stops the entire WSL2 backend VM.
  // Stops the gateways first so they can finalize sessions.
  async function shutdownWsl({ publish = getStatus } = {}) {
    const cfg = getConfig();
    await runPowerShell(`Stop-ScheduledTask -TaskName "${cfg.dashboardTaskName}"`, 10000);
    await runWsl(`${hermesEnvPrefix(cfg)}${shellQuote(cfg.hermesCommand)} gateway stop >/dev/null 2>&1 || true`, 12000);
    await run(wslPath(), ['--shutdown'], 25000);
    const status = await waitForStatus(publish, (s) => !s.wslRunning, stopTimeoutMs, async (s) => {
      if (s.wslRunning) await run(wslPath(), ['--shutdown'], 25000);
    });
    return { ...status, outcome: status.wslRunning ? 'incomplete' : 'stopped' };
  }

  async function detectControllerEnvironment() {
    const list = await run(wslPath(), ['-l', '-q'], 8000);
    const distros = parseDistroList(list.stdout).filter((line) => !/docker-desktop/i.test(line));
    const candidates = [];
    for (const distro of distros.slice(0, 8)) {
      const script = `python3 - <<'PY'
import json, os, shutil
from pathlib import Path
home = Path.home()
cmd = shutil.which('hermes') or 'hermes'
paths = []
for p in [Path(os.environ.get('HERMES_HOME','')), home/'.hermes', home/'hermes-lab'/'.hermes']:
    if str(p) and p.exists() and (p/'profiles').exists():
        paths.append(str(p))
roots = []
for p in [home/'hermes-lab', home/'workspace'/'hermes-lab', home]:
    if p.exists(): roots.append(str(p))
print(json.dumps({'hermesCommand': cmd, 'hermesHomes': paths, 'labRoots': roots}, ensure_ascii=False))
PY`;
      const res = await run(wslPath(), ['-d', distro, '--', 'bash', '-lc', script], 10000);
      let info = {};
      try { info = JSON.parse(res.stdout || '{}'); } catch { info = {}; }
      candidates.push({ distro, ok: res.ok, ...info });
    }
    return { ok: true, distros, candidates };
  }

  async function testControllerConfig(patch = null) {
    const base = getConfig();
    const cfg = patch ? { ...base, ...patch } : base;
    const checks = [];
    const runIn = (script, timeout = 12000) => run(wslPath(), ['-d', cfg.distro || 'Ubuntu', '--', 'bash', '-lc', script], timeout);
    const firstLine = (res) => cleanWslText(res.stderr || res.stdout || res.error).trim().split(/\r?\n/)[0] || '';
    const hermesCommand = shellQuote(cfg.hermesCommand || 'hermes');
    const hermesHome = shellQuote(cfg.hermesHome || '');
    const labRoot = shellQuote(cfg.labRoot || '');
    let res = await run(wslPath(), ['-l', '-q'], 8000);
    const distroFound = parseDistroList(res.stdout).includes(cfg.distro);
    checks.push({ name: 'wsl.distro', ok: distroFound, detail: cfg.distro || '' });
    if (!distroFound) {
      // Every later check would only repeat "no such distribution".
      for (const name of ['hermes.command', 'hermes.home', 'lab.root', 'hermes.profile_list']) {
        checks.push({ name, ok: false, skipped: true, detail: 'skipped: WSL distro not found' });
      }
      return { ok: false, checks, config: publicConfig(cfg) };
    }
    res = await runIn(`command -v ${hermesCommand}`, 8000);
    checks.push({ name: 'hermes.command', ok: res.ok && Boolean(res.stdout.trim()), detail: (res.stdout || res.stderr || '').trim().split(/\r?\n/)[0] || cfg.hermesCommand });
    res = await runIn(`test -d ${hermesHome} && test -d ${hermesHome}/profiles`, 8000);
    checks.push({ name: 'hermes.home', ok: res.ok, detail: cfg.hermesHome || '' });
    res = await runIn(`test -d ${labRoot}`, 8000);
    checks.push({ name: 'lab.root', ok: res.ok, detail: cfg.labRoot || '' });
    res = await runIn(`cd ${labRoot} && HERMES_HOME=${hermesHome} ${hermesCommand} profile list 2>&1`, 15000);
    checks.push({ name: 'hermes.profile_list', ok: res.ok, detail: res.ok ? 'ok' : (firstLine({ stdout: res.stdout, stderr: res.stderr, error: res.error }) || 'failed').slice(0, 300) });
    return { ok: checks.every((c) => c.ok), checks, config: publicConfig(cfg) };
  }

  return {
    getStatus,
    isWslRunning,
    start,
    stop,
    shutdownWsl,
    detectControllerEnvironment,
    testControllerConfig,
    hermesEnvPrefix
  };
}

module.exports = { createServiceControl, checkHttp, parseDistroList, cleanWslText, escapeRegExp };
