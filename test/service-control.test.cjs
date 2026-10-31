// Whole-stack status, start/stop and connection test against the fake
// wsl.exe / powershell.exe / dashboard harness.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeEnv } = require('./harness/fake-env.cjs');
const { run, createWslRunner, wslPath } = require('../electron/shell.cjs');
const { createServiceControl, parseDistroList, escapeRegExp } = require('../electron/service-control.cjs');

let fake;
let config;
let service;

function makeService(overrides = {}) {
  return createServiceControl({
    getConfig: () => config,
    run,
    runWsl: createWslRunner(() => config),
    runPowerShell: (command, t) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], t),
    wslPath,
    pollMs: 100,
    startTimeoutMs: 4000,
    stopTimeoutMs: 3000,
    ...overrides
  });
}

test.before(async () => {
  fake = (await createFakeEnv({ distros: ['Ubuntu', 'Debian-12'], profiles: { alpha: {} } })).install();
  config = { ...fake.config };
  service = makeService();
});
test.after(() => fake && fake.cleanup());

test('parses UTF-16 wsl.exe list output', () => {
  const raw = Buffer.from('Ubuntu\r\nDebian-12\r\n', 'utf16le').toString('utf8');
  assert.deepEqual(parseDistroList(raw), ['Ubuntu', 'Debian-12']);
  assert.equal(escapeRegExp('Ubuntu-22.04'), 'Ubuntu-22\\.04');
});

test('initial status: everything stopped', async () => {
  const status = await service.getStatus();
  assert.equal(status.wslRunning, false);
  assert.equal(status.dashboardOnline, false);
  assert.equal(status.ready, false);
  assert.equal(status.codexAuth, 'WSL off');
});

test('start: waits for WSL + dashboard + auth and reports outcome=running', async () => {
  const status = await service.start();
  assert.equal(status.outcome, 'running', status.error);
  assert.equal(status.ready, true);
  assert.equal(status.wslRunning, true);
  assert.equal(status.dashboardOnline, true);
  assert.equal(status.codexAuth, 'logged in');
});

test('stop: reports outcome=stopped only once WSL and dashboard are really down', async () => {
  const status = await service.stop();
  assert.equal(status.outcome, 'stopped', status.error);
  assert.equal(status.wslRunning, false);
  assert.equal(status.dashboardOnline, false);
});

test('stop: reports incomplete when WSL keeps running', async () => {
  await service.start();
  // A distro that refuses to terminate: keep reporting Running.
  const stubborn = makeService({ run: async (file, args, t) => (args[0] === '--terminate' ? { ok: false, stdout: '', stderr: 'denied', error: 'denied' } : run(file, args, t)) });
  const status = await stubborn.stop();
  assert.equal(status.outcome, 'incomplete');
  assert.match(status.error, /WSL distro still running/);
  await service.stop();
});

test('stop: a wsl -d call racing the terminate does not leave WSL running (regression)', async () => {
  await service.start();
  let raced = false;
  const racy = makeService({
    run: async (file, args, t) => {
      const res = await run(file, args, t);
      if (args[0] === '--terminate' && !raced) {
        raced = true; // a background poll that was already in flight boots it again
        await run(file, ['-d', config.distro, '--', 'bash', '-lc', 'true'], t);
      }
      return res;
    }
  });
  const status = await racy.stop();
  assert.equal(raced, true);
  assert.equal(status.outcome, 'stopped', status.error);
  assert.equal(status.wslRunning, false);
});

test('start: not logged in -> timeout with a reason, never "running" (regression)', async () => {
  // The old check matched /logged in/ and so treated "not logged in" as logged in.
  fake.setLoggedIn(false);
  try {
    const status = await service.start();
    assert.equal(status.ready, false);
    assert.equal(status.outcome, 'timeout');
    assert.match(status.codexAuth, /not logged in/);
    assert.match(status.error, /codex auth/);
  } finally {
    fake.setLoggedIn(true);
    await service.stop();
  }
});

test('start: missing dashboard task -> failed with the task error', async () => {
  process.env.FAKE_DASHBOARD_FAIL = '1';
  try {
    const status = await service.start();
    assert.equal(status.outcome, 'failed');
    assert.match(status.error, /dashboard task/);
  } finally {
    delete process.env.FAKE_DASHBOARD_FAIL;
    await service.stop();
  }
});

test('shutdownWsl stops every distro', async () => {
  await service.start();
  const status = await service.shutdownWsl();
  assert.equal(status.outcome, 'stopped');
  assert.equal(status.wslRunning, false);
});

test('connection test passes for a correct config', async () => {
  const res = await service.testControllerConfig();
  assert.equal(res.ok, true, JSON.stringify(res.checks));
  assert.deepEqual(res.checks.map((c) => c.name), ['wsl.distro', 'hermes.command', 'hermes.home', 'lab.root', 'hermes.profile_list']);
});

test('connection test: missing distro fails first check and skips the rest', async () => {
  const res = await service.testControllerConfig({ distro: 'NoSuchDistro' });
  assert.equal(res.ok, false);
  assert.equal(res.checks[0].ok, false);
  assert.ok(res.checks.slice(1).every((c) => c.skipped));
});

test('connection test: wrong paths fail their own checks', async () => {
  const res = await service.testControllerConfig({ hermesHome: '/nonexistent/.hermes', labRoot: '/nonexistent/lab' });
  const byName = Object.fromEntries(res.checks.map((c) => [c.name, c]));
  assert.equal(byName['wsl.distro'].ok, true);
  assert.equal(byName['hermes.command'].ok, true);
  assert.equal(byName['hermes.home'].ok, false);
  assert.equal(byName['lab.root'].ok, false);
  assert.equal(byName['hermes.profile_list'].ok, false);
  assert.match(byName['hermes.profile_list'].detail, /No such file|nonexistent/);
});

test('connection test: a failing `hermes profile list` shows its own error (regression)', async () => {
  // Its output used to be redirected to /tmp/hermes-controller-profile-list.txt,
  // so the check failed with an empty detail.
  const fs = require('node:fs');
  const path = require('node:path');
  const broken = path.join(fake.root, 'hermes-broken');
  fs.writeFileSync(broken, '#!/bin/sh\necho "error: config.yaml is not valid YAML" >&2\nexit 1\n');
  fs.chmodSync(broken, 0o755);
  const res = await service.testControllerConfig({ hermesCommand: broken });
  const check = res.checks.find((c) => c.name === 'hermes.profile_list');
  assert.equal(check.ok, false);
  assert.match(check.detail, /config\.yaml is not valid YAML/);
});

test('connection test: a hermes command that does not exist fails hermes.command', async () => {
  const res = await service.testControllerConfig({ hermesCommand: 'hermes-not-installed' });
  assert.equal(res.checks.find((c) => c.name === 'hermes.command').ok, false);
});

test('environment detection finds the synthetic Hermes home in each distro', async () => {
  const res = await service.detectControllerEnvironment();
  assert.deepEqual(res.distros, ['Ubuntu', 'Debian-12']);
  assert.ok(res.candidates[0].hermesHomes.includes(fake.hermesHome), JSON.stringify(res.candidates[0]));
});
