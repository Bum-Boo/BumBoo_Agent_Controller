// End-to-end adapter flow against the fake WSL/Hermes harness: the real
// hermes-adapter.cjs builds real command lines, the fake wsl.exe runs them in
// bash, and gateways are real processes under an isolated tmux server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeEnv, waitFor } = require('./harness/fake-env.cjs');
const { createWslRunner } = require('../electron/shell.cjs');
const { createHermesAdapter } = require('../electron/hermes-adapter.cjs');

let fake;
let config;
let adapter;

test.before(async () => {
  fake = (await createFakeEnv({
    profiles: {
      alpha: {},
      beta: { model: 'gpt-5.4-mini', reasoning: 'high' },
      broken: { gateway: { mode: 'crash-on-start' } }
    }
  })).install();
  config = { ...fake.config };
  adapter = createHermesAdapter(createWslRunner(() => config), config);
});

test.after(() => fake && fake.cleanup());

async function profile(name, a = adapter) {
  const res = await a.listProfiles();
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.profiles.find((p) => p.name === name);
}

test('discovers profiles with model/reasoning from config.yaml', async () => {
  const res = await adapter.listProfiles();
  assert.equal(res.ok, true);
  assert.deepEqual(res.profiles.map((p) => p.name), ['alpha', 'beta', 'broken']);
  const beta = res.profiles.find((p) => p.name === 'beta');
  assert.equal(beta.model, 'gpt-5.4-mini');
  assert.equal(beta.reasoning, 'high');
  assert.equal(beta.running, false);
});

test('start -> running with live pid and connected platform; stop -> stopped', async () => {
  const started = await adapter.gatewayStartProfile('alpha');
  assert.equal(started.ok, true);
  const running = await waitFor(async () => { const p = await profile('alpha'); return p.running && p; });
  assert.ok(fake.isAlive(running.pid), 'pid from gateway_state.json is a live process');
  assert.deepEqual(running.platforms, [{ name: 'telegram', state: 'connected' }]);
  assert.deepEqual(fake.tmuxSessions(), ['gw-alpha']);

  const stopped = await adapter.gatewayStopProfile('alpha');
  assert.equal(stopped.ok, true, stopped.output);
  const after = await profile('alpha');
  assert.equal(after.running, false);
  assert.equal(fake.isAlive(running.pid), false);
  assert.deepEqual(after.platforms, [{ name: 'telegram', state: 'disconnected' }]);
});

test('restart (start with --replace while running) replaces the process', async () => {
  await adapter.gatewayStartProfile('alpha');
  const first = await waitFor(async () => { const p = await profile('alpha'); return p.running && p; });
  await adapter.gatewayStartProfile('alpha');
  const second = await waitFor(async () => { const p = await profile('alpha'); return p.running && p.pid !== first.pid && p; });
  assert.equal(fake.isAlive(first.pid), false, 'old gateway process is gone');
  assert.ok(fake.isAlive(second.pid));
  await adapter.gatewayStopProfile('alpha');
});

test('external crash (SIGKILL, stale pidfile) is reported as not running', async () => {
  await adapter.gatewayStartProfile('beta');
  await waitFor(async () => (await profile('beta')).running);
  fake.killGateway('beta');
  await waitFor(async () => !(await profile('beta')).running);
  assert.ok(fake.gatewayPid('beta'), 'stale pidfile left behind like a real crash');
});

test('crash-on-start: gateway process probe reports the failure and log tail', async () => {
  const res = await adapter.gatewayStartProfile('broken');
  assert.equal(res.ok, true, 'the launch command itself succeeds (request sent)');
  const probe = await waitFor(async () => {
    const p = await adapter.gatewayProcessStatus('broken');
    return p.ok && !p.sessionAlive && p;
  });
  assert.equal(probe.running, false);
  assert.match(probe.logTail, /invalid bot token/);
});

test('model settings change writes config.yaml and a backup; restore rolls it back', async () => {
  const before = fake.readConfigYaml('alpha');
  const res = await adapter.setProfileModelSettings('alpha', { model: 'gpt-5.4-mini', reasoning: 'low' });
  assert.equal(res.ok, true, res.error);
  assert.match(fake.readConfigYaml('alpha'), /gpt-5\.4-mini/);
  const backups = await adapter.listProfileBackups('alpha');
  assert.equal(backups.ok, true);
  assert.equal(backups.backups.length, 1);
  const restored = await adapter.restoreProfileBackup('alpha', backups.backups[0].id);
  assert.equal(restored.ok, true, restored.error);
  assert.equal(fake.readConfigYaml('alpha'), before);
});

test('log summary counts errors from gateway.log', async () => {
  const summary = await adapter.profileLogSummary('broken');
  assert.equal(summary.ok, true);
  assert.ok(summary.errorCount >= 1);
});

test('useProfile marks the sticky default', async () => {
  const res = await adapter.useProfile('beta');
  assert.equal(res.ok, true);
  assert.equal((await profile('beta')).current, true);
  assert.equal((await profile('alpha')).current, false);
});

test('honours an absolute hermesCommand that is not on PATH (regression)', async () => {
  const binDir = path.join(fake.root, 'custom-bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'harness', 'wsl-bin', 'hermes'), path.join(binDir, 'hermes-custom'));
  fs.chmodSync(path.join(binDir, 'hermes-custom'), 0o755);
  // Hide the PATH copy: only the absolute path can work.
  const cfg = { ...config, hermesCommand: path.join(binDir, 'hermes-custom') };
  const hidden = path.join(__dirname, 'harness', 'wsl-bin', 'hermes');
  const a = createHermesAdapter(createWslRunner(() => cfg), cfg);
  fs.renameSync(hidden, `${hidden}.hidden`);
  try {
    const res = await a.listProfiles();
    assert.equal(res.ok, true, res.error);
    assert.equal(res.profiles.length, 3);
  } finally {
    fs.renameSync(`${hidden}.hidden`, hidden);
  }
});

test('paths with spaces and quotes work (regression)', async () => {
  const odd = await createFakeEnv({ profiles: { gamma: {} } });
  try {
    const home = path.join(odd.root, "my lab's home");
    fs.renameSync(odd.hermesHome, home);
    const lab = path.join(odd.root, 'lab dir');
    fs.mkdirSync(lab);
    const cfg = { ...odd.config, hermesHome: home, labRoot: lab };
    Object.assign(process.env, { TMUX_TMPDIR: odd.env.TMUX_TMPDIR, FAKE_WSL_ROOT: odd.env.FAKE_WSL_ROOT, FAKE_WSL_HOME: odd.env.FAKE_WSL_HOME });
    const a = createHermesAdapter(createWslRunner(() => cfg), cfg);
    const list = await a.listProfiles();
    assert.equal(list.ok, true, list.error);
    assert.deepEqual(list.profiles.map((p) => p.name), ['gamma']);
    assert.equal(list.profiles[0].model, 'gpt-5.5');
    await a.gatewayStartProfile('gamma');
    await waitFor(async () => (await a.listProfiles()).profiles[0].running);
    assert.equal((await a.gatewayStopProfile('gamma')).ok, true);
    const summary = await a.profileLogSummary('gamma');
    assert.equal(summary.ok, true);
  } finally {
    odd.cleanup();
    fake.install();
  }
});

test('rejects profile names that could inject shell (regression)', async () => {
  for (const bad of ['a; touch /tmp/pwned', '$(id)', '../etc', '']) {
    assert.equal((await adapter.gatewayStartProfile(bad)).ok, false, bad);
    assert.equal((await adapter.gatewayStopProfile(bad)).ok, false, bad);
    assert.equal((await adapter.useProfile(bad)).ok, false, bad);
  }
});
