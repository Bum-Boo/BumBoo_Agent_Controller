const test = require('node:test');
const assert = require('node:assert/strict');
const { createGatewayWatchdog } = require('../electron/gateway-watchdog.cjs');

function harness({ autoRestartEnabled = false, startResult = { ok: true }, isBusy } = {}) {
  const world = { running: new Set(['alpha']) };
  const events = [];
  const starts = [];
  const wd = createGatewayWatchdog({
    listProfiles: async () => ({ ok: true, profiles: ['alpha', 'beta'].map((name) => ({ name, running: world.running.has(name) })) }),
    startProfile: async (name) => { starts.push(name); return typeof startResult === 'function' ? startResult(name) : startResult; },
    getConfig: () => ({ autoRestartEnabled, autoRestartMax: 2 }),
    onEvent: (e) => events.push(e),
    onProfiles: () => {},
    notify: () => {},
    isBusy
  });
  return { wd, world, events, starts };
}

const tick = () => new Promise((r) => setImmediate(r));

test('detects a crash of a desired, previously running gateway', async () => {
  const { wd, world, events } = harness();
  await wd.refreshNow();
  world.running.delete('alpha');
  await wd.refreshNow();
  assert.deepEqual(events.map((e) => e.type), ['crash']);
});

test('a manual stop is not a crash', async () => {
  const { wd, world, events } = harness();
  await wd.refreshNow();
  wd.setDesired('alpha', false);
  world.running.delete('alpha');
  await wd.refreshNow();
  assert.deepEqual(events, []);
});

test('no false crash while a user restart is between stop and running (regression)', async () => {
  const busy = new Set();
  const { wd, world, events } = harness({ isBusy: (n) => busy.has(n) });
  await wd.refreshNow(); // lastRunning = {alpha}
  // Restart: stop (desired off), then start (desired on) — gateway still down.
  busy.add('alpha');
  wd.setDesired('alpha', false);
  world.running.delete('alpha');
  wd.setDesired('alpha', true);
  await wd.refreshNow();
  assert.deepEqual(events, [], 'poll during the transition must not report a crash');
  world.running.add('alpha');
  busy.delete('alpha');
  await wd.refreshNow();
  world.running.delete('alpha');
  await wd.refreshNow();
  assert.deepEqual(events.map((e) => e.type), ['crash'], 'a real crash afterwards is still detected');
});

test('auto-restart reports restarted only when the start is confirmed (regression)', async () => {
  const { wd, world, events } = harness({
    autoRestartEnabled: true,
    startResult: { ok: false, phase: 'failed', error: 'gateway exited during startup', output: 'started' }
  });
  await wd.refreshNow();
  world.running.delete('alpha');
  await wd.refreshNow();
  await tick();
  assert.deepEqual(events.map((e) => e.type), ['crash', 'restarting', 'restart-failed']);
  assert.equal(events[2].reason, 'gateway exited during startup');
});

test('auto-restart gives up after the retry budget', async () => {
  const { wd, world, events, starts } = harness({ autoRestartEnabled: true, startResult: { ok: true } });
  await wd.refreshNow();
  for (let i = 0; i < 3; i += 1) {
    world.running.delete('alpha');
    await wd.refreshNow();
    await tick();
    world.running.add('alpha');
    await wd.refreshNow();
  }
  assert.equal(starts.length, 2);
  assert.equal(events.filter((e) => e.type === 'restart-failed' && e.reason === 'max-retries').length, 1);
});
