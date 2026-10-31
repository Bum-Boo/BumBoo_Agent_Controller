// Unit tests for every lifecycle transition with scripted fake deps, plus an
// integration pass against the fake WSL/Hermes harness (real processes).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGatewayLifecycle } = require('../electron/gateway-lifecycle.cjs');
const { createFakeEnv } = require('./harness/fake-env.cjs');
const { createWslRunner } = require('../electron/shell.cjs');
const { createHermesAdapter } = require('../electron/hermes-adapter.cjs');

// Scripted world: `running` is what Hermes reports; commands mutate it after
// `delayPolls` polls so we can observe the intermediate phases.
function scripted(opts = {}) {
  const world = { running: Boolean(opts.running), session: Boolean(opts.running), polls: 0, pending: null };
  let clock = 0;
  const phases = [];
  const lc = createGatewayLifecycle({
    startProfile: async () => {
      if (opts.startFails) return { ok: false, error: 'tmux: command not found' };
      if (opts.startThrows) throw new Error('boom');
      world.session = !opts.crashOnStart;
      if (!opts.crashOnStart && !opts.neverRuns) world.pending = { to: true, after: opts.delayPolls || 0 };
      return { ok: true, output: 'started' };
    },
    stopProfile: async () => {
      if (opts.stopFails) return { ok: false, error: 'Timed out stopping gateway' };
      if (!opts.stopIgnored) world.pending = { to: false, after: opts.delayPolls || 0 };
      world.session = false;
      return { ok: true };
    },
    listProfiles: async () => {
      world.polls += 1;
      if (opts.listFails) return { ok: false, profiles: [] };
      if (world.pending) {
        if (world.pending.after <= 0) { world.running = world.pending.to; world.pending = null; } else world.pending.after -= 1;
      }
      return { ok: true, profiles: [{ name: 'alpha', running: world.running }] };
    },
    probe: opts.noProbe ? null : async () => ({ ok: true, sessionAlive: world.session, running: world.running, logTail: 'ERROR invalid bot token' }),
    onChange: (e) => phases.push(e.phase),
    startTimeoutMs: 5000,
    stopTimeoutMs: 3000,
    pollMs: 1000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; }
  });
  return { lc, world, phases };
}

test('start: start-requested -> starting -> running', async () => {
  const { lc, phases } = scripted({ delayPolls: 2 });
  const res = await lc.start('alpha');
  assert.equal(res.ok, true);
  assert.equal(res.phase, 'running');
  assert.deepEqual([...new Set(phases)], ['start-requested', 'starting', 'running']);
});

test('start: command failure -> failed with the command error', async () => {
  const { lc, phases } = scripted({ startFails: true });
  const res = await lc.start('alpha');
  assert.equal(res.ok, false);
  assert.equal(res.phase, 'failed');
  assert.match(res.error, /tmux: command not found/);
  assert.deepEqual(phases, ['start-requested', 'failed']);
});

test('start: thrown error -> failed', async () => {
  const { lc } = scripted({ startThrows: true });
  const res = await lc.start('alpha');
  assert.equal(res.phase, 'failed');
  assert.match(res.error, /boom/);
});

test('start: process exits during startup -> failed fast with log tail', async () => {
  const { lc, world } = scripted({ crashOnStart: true });
  const res = await lc.start('alpha');
  assert.equal(res.phase, 'failed');
  assert.equal(res.error, 'gateway exited during startup');
  assert.match(res.detail, /invalid bot token/);
  assert.ok(world.polls <= 2, `failed fast (polls=${world.polls})`);
});

test('start: alive but never reported running -> failed on timeout', async () => {
  const { lc, world } = scripted({ neverRuns: true });
  const res = await lc.start('alpha');
  assert.equal(res.phase, 'failed');
  assert.match(res.error, /did not report running within 5s/);
  assert.equal(world.polls, 5);
});

test('start: Hermes listing unavailable -> times out rather than claiming running', async () => {
  const { lc } = scripted({ listFails: true, noProbe: true });
  const res = await lc.start('alpha');
  assert.equal(res.phase, 'failed');
});

test('stop: stop-requested -> stopping -> stopped', async () => {
  const { lc, phases } = scripted({ running: true, delayPolls: 1 });
  const res = await lc.stop('alpha');
  assert.equal(res.ok, true);
  assert.deepEqual([...new Set(phases)], ['stop-requested', 'stopping', 'stopped']);
});

test('stop: process ignores the stop -> failed on timeout', async () => {
  const { lc } = scripted({ running: true, stopIgnored: true });
  const res = await lc.stop('alpha');
  assert.equal(res.phase, 'failed');
  assert.match(res.error, /still running after 3s/);
});

test('stop: command error but process gone -> stopped', async () => {
  const { lc, world } = scripted({ running: false, stopFails: true });
  world.running = false;
  const res = await lc.stop('alpha');
  assert.equal(res.phase, 'stopped');
});

test('stop: command error and still running -> failed with the command error', async () => {
  const { lc } = scripted({ running: true, stopFails: true });
  const res = await lc.stop('alpha');
  assert.equal(res.phase, 'failed');
  assert.match(res.error, /Timed out stopping/);
});

test('restart: stops then starts; a failed stop does not start', async () => {
  const ok = scripted({ running: true });
  const res = await ok.lc.restart('alpha');
  assert.equal(res.phase, 'running');
  assert.equal(res.action, 'restart');
  assert.deepEqual([...new Set(ok.phases)], ['stop-requested', 'stopping', 'stopped', 'start-requested', 'starting', 'running']);

  const bad = scripted({ running: true, stopIgnored: true });
  const res2 = await bad.lc.restart('alpha');
  assert.equal(res2.phase, 'failed');
  assert.ok(!bad.phases.includes('start-requested'));
});

test('a second request while transitioning is rejected as busy', async () => {
  let release;
  const lc = createGatewayLifecycle({
    startProfile: () => new Promise((r) => { release = () => r({ ok: true }); }),
    stopProfile: async () => ({ ok: true }),
    listProfiles: async () => ({ ok: true, profiles: [{ name: 'alpha', running: true }] }),
    sleep: async () => {}
  });
  const first = lc.start('alpha');
  await new Promise((r) => setImmediate(r));
  assert.equal(lc.isBusy('alpha'), true);
  const second = await lc.stop('alpha');
  assert.equal(second.ok, false);
  assert.equal(second.busy, true);
  release();
  assert.equal((await first).phase, 'running');
  assert.equal(lc.isBusy('alpha'), false);
});

test('observe(): external start, crash and recovery update resting phases only', async () => {
  const { lc } = scripted();
  lc.observe([{ name: 'alpha', running: true }]);
  assert.equal(lc.get('alpha').phase, 'running');
  lc.observe([{ name: 'alpha', running: false }]);
  assert.equal(lc.get('alpha').phase, 'stopped');

  const failed = scripted({ startFails: true });
  await failed.lc.start('alpha');
  failed.lc.observe([{ name: 'alpha', running: false }]);
  assert.equal(failed.lc.get('alpha').phase, 'failed', 'failure stays visible until something changes');
  failed.lc.observe([{ name: 'alpha', running: true }]);
  assert.equal(failed.lc.get('alpha').phase, 'running', 'recovery clears the failure');
});

test('integration: real processes through fake WSL — start, crash on start, restart, stop timeout', async () => {
  const fake = (await createFakeEnv({
    profiles: {
      alpha: { gateway: { startDelayMs: 600 } },
      broken: { gateway: { mode: 'crash-on-start' } },
      stubborn: { gateway: { ignoreSigterm: true, stopWaitMs: 300 } }
    }
  })).install();
  try {
    const adapter = createHermesAdapter(createWslRunner(() => fake.config), fake.config);
    const seen = {};
    const lc = createGatewayLifecycle({
      startProfile: adapter.gatewayStartProfile,
      stopProfile: adapter.gatewayStopProfile,
      listProfiles: adapter.listProfiles,
      probe: adapter.gatewayProcessStatus,
      onChange: (e) => { (seen[e.name] = seen[e.name] || []).push(e.phase); },
      startTimeoutMs: 15000,
      stopTimeoutMs: 2000,
      pollMs: 200
    });

    const started = await lc.start('alpha');
    assert.equal(started.phase, 'running', JSON.stringify(started));
    assert.ok(seen.alpha.includes('starting'), 'starting observed before running (startDelayMs)');
    const pid1 = fake.gatewayPid('alpha');
    assert.ok(fake.isAlive(pid1));

    const restarted = await lc.restart('alpha');
    assert.equal(restarted.phase, 'running');
    assert.notEqual(fake.gatewayPid('alpha'), pid1);
    assert.equal(fake.isAlive(pid1), false);

    const stopped = await lc.stop('alpha');
    assert.equal(stopped.phase, 'stopped');
    assert.deepEqual(fake.tmuxSessions().filter((s) => s === 'gw-alpha'), []);

    const broken = await lc.start('broken');
    assert.equal(broken.phase, 'failed');
    assert.equal(broken.error, 'gateway exited during startup');
    assert.match(broken.detail, /invalid bot token/);

    // Recovery: fix the profile and start again.
    fake.setGateway('broken', { mode: 'ok' });
    assert.equal((await lc.start('broken')).phase, 'running');
    await lc.stop('broken');

    assert.equal((await lc.start('stubborn')).phase, 'running');
    const stuck = await lc.stop('stubborn');
    assert.equal(stuck.phase, 'failed');
    fake.killGateway('stubborn');
  } finally {
    fake.cleanup();
  }
});
