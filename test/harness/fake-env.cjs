// Builds an isolated, fully synthetic "Windows + WSL + Hermes" environment in
// a temp dir so the controller's real code paths run headlessly on Linux:
//
//   <root>/wsl-state      fake wsl.exe state + call log
//   <root>/home           $HOME inside the fake distro
//   <root>/home/.hermes   HERMES_HOME with synthetic profiles
//   <root>/home/lab       lab root
//   <root>/tmux           TMUX_TMPDIR, so tests never touch a real tmux server
//
// Nothing here reads or writes real accounts, tokens or user files.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const HARNESS = __dirname;
const WINDIR = path.join(HARNESS, 'windows');
const WSL_EXE = path.join(WINDIR, 'System32', 'wsl.exe');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function writeProfile(hermesHome, name, spec = {}) {
  const dir = path.join(hermesHome, 'profiles', name);
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  const model = spec.model || 'gpt-5.5';
  fs.writeFileSync(path.join(dir, 'config.yaml'), [
    'model:',
    `  provider: '${spec.provider || 'openai-codex'}'`,
    `  default: '${model}'`,
    `  base_url: 'http://127.0.0.1:1/fake'`,
    'agent:',
    `  reasoning_effort: '${spec.reasoning || ''}'`,
    ''
  ].join('\n'));
  if (spec.gateway) fs.writeFileSync(path.join(dir, 'fake-gateway.json'), JSON.stringify(spec.gateway));
}

async function createFakeEnv(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-fake-'));
  const wslRoot = path.join(root, 'wsl-state');
  const home = path.join(root, 'home');
  const hermesHome = path.join(home, '.hermes');
  const labRoot = path.join(home, 'lab');
  const tmuxDir = path.join(root, 'tmux');
  for (const d of [wslRoot, hermesHome, labRoot, tmuxDir, path.join(hermesHome, 'profiles')]) fs.mkdirSync(d, { recursive: true });

  const profiles = options.profiles || { alpha: {}, beta: {} };
  for (const [name, spec] of Object.entries(profiles)) writeProfile(hermesHome, name, spec);
  fs.writeFileSync(path.join(hermesHome, 'fake-auth.json'), JSON.stringify({ loggedIn: options.loggedIn !== false }));

  const dashboardPort = options.dashboardPort || await freePort();
  const env = {
    WINDIR,
    PATH: `${path.join(HARNESS, 'windows-bin')}${path.delimiter}${process.env.PATH}`,
    FAKE_WSL_ROOT: wslRoot,
    FAKE_WSL_HOME: home,
    FAKE_WSL_BIN: path.join(HARNESS, 'wsl-bin'),
    FAKE_WSL_DISTROS: (options.distros || ['Ubuntu']).join(','),
    FAKE_DASHBOARD_PORT: String(dashboardPort),
    TMUX_TMPDIR: tmuxDir
  };

  const config = {
    distro: options.distro || 'Ubuntu',
    dashboardUrl: `http://127.0.0.1:${dashboardPort}/`,
    dashboardTaskName: 'Fake Hermes Dashboard',
    labRoot,
    hermesHome,
    hermesCommand: 'hermes',
    pollMs: 3000
  };

  function profileDir(name) { return path.join(hermesHome, 'profiles', name); }

  return {
    root,
    home,
    hermesHome,
    labRoot,
    env,
    config,
    wslExe: WSL_EXE,
    dashboardPort,
    // Apply env to this process (child processes inherit it).
    install() { Object.assign(process.env, env); return this; },
    setGateway(name, behaviour) {
      fs.writeFileSync(path.join(profileDir(name), 'fake-gateway.json'), JSON.stringify(behaviour));
    },
    addProfile(name, spec) { writeProfile(hermesHome, name, spec); },
    setLoggedIn(loggedIn) {
      fs.writeFileSync(path.join(hermesHome, 'fake-auth.json'), JSON.stringify({ loggedIn }));
    },
    gatewayPid(name) {
      try { return Number(fs.readFileSync(path.join(profileDir(name), 'gateway.pid'), 'utf8')) || null; } catch { return null; }
    },
    isAlive(pid) {
      if (!pid) return false;
      try { process.kill(pid, 0); return true; } catch { return false; }
    },
    readConfigYaml(name) { return fs.readFileSync(path.join(profileDir(name), 'config.yaml'), 'utf8'); },
    wslCalls() {
      try {
        return fs.readFileSync(path.join(wslRoot, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch { return []; }
    },
    tmuxSessions() {
      const res = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], { env: { ...process.env, TMUX_TMPDIR: tmuxDir }, encoding: 'utf8' });
      return res.status === 0 ? res.stdout.trim().split('\n').filter(Boolean) : [];
    },
    // Simulate an external crash: SIGKILL leaves the stale pidfile behind.
    killGateway(name, signal = 'SIGKILL') {
      const pid = this.gatewayPid(name);
      if (pid) { try { process.kill(pid, signal); } catch { /* gone */ } }
      return pid;
    },
    cleanup() {
      spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: tmuxDir }, stdio: 'ignore' });
      try {
        const pid = Number(fs.readFileSync(path.join(wslRoot, 'dashboard.pid'), 'utf8'));
        if (pid) process.kill(pid, 'SIGTERM');
      } catch { /* none */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

module.exports = { createFakeEnv, waitFor, WINDIR, WSL_EXE };
