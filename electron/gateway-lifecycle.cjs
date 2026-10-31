// Per-profile gateway lifecycle: separates "the controller sent a command"
// from "the gateway process is actually up/down".
//
//   idle ──start()──> start-requested ──cmd ok──> starting ──seen running──> running
//                           │ cmd failed              │ process gone / timeout
//                           └──────────> failed <─────┘
//   running ──stop()──> stop-requested ──> stopping ──seen stopped──> stopped
//                                              └── still running at deadline ──> failed
//
// "Running" is confirmed only from Hermes itself (`profile list` via
// listProfiles). While starting, an optional probe (tmux session + pid
// liveness) lets a gateway that died during startup fail fast with its last
// log lines instead of waiting for the timeout.
//
// Resting phases (running / stopped / failed) are also reconciled from the
// watchdog's periodic profile snapshots via observe(), so an external start
// or a crash is reflected without a user action.

const TRANSITIONAL = new Set(['start-requested', 'starting', 'stop-requested', 'stopping']);

function createGatewayLifecycle(deps) {
  const {
    startProfile, // (name) => Promise<{ ok, output?, error? }>
    stopProfile, // (name) => Promise<{ ok, output?, error? }>
    listProfiles, // () => Promise<{ ok, profiles: [{ name, running }] }>
    probe = null, // (name) => Promise<{ ok, sessionAlive, running, logTail }>
    onChange = () => {}, // (entry) => void
    startTimeoutMs = 30000,
    stopTimeoutMs = 20000,
    pollMs = 1000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = deps;

  const entries = new Map(); // name -> entry
  // Names with an operation in flight. Reserved synchronously, before the
  // first await, so a request that arrives while restart() is still checking
  // the current state cannot slip past the busy guard.
  const inFlight = new Set();

  function get(name) {
    return entries.get(name) || { name, phase: 'idle', action: null, error: '', detail: '', since: null };
  }

  function set(name, patch) {
    const prev = get(name);
    const phaseChanged = patch.phase && patch.phase !== prev.phase;
    const entry = {
      ...prev,
      ...patch,
      name,
      since: phaseChanged ? now() : (prev.since || now()),
      updatedAt: now()
    };
    entries.set(name, entry);
    try { onChange({ ...entry }); } catch { /* listener errors must not break the flow */ }
    return entry;
  }

  function isBusy(name) {
    return inFlight.has(name) || TRANSITIONAL.has(get(name).phase);
  }

  async function isRunning(name) {
    const res = await listProfiles();
    if (!res || !res.ok) return null; // unknown
    const p = (res.profiles || []).find((item) => item.name === name);
    return p ? Boolean(p.running) : false;
  }

  function result(entry) {
    return { ok: entry.phase === 'running' || entry.phase === 'stopped', ...entry };
  }

  function errorText(res, fallback) {
    return String((res && (res.error || res.output)) || fallback).trim().slice(0, 500);
  }

  async function doStart(name, action) {
    set(name, { phase: 'start-requested', action, error: '', detail: '' });
    let res;
    try {
      res = await startProfile(name);
    } catch (error) {
      res = { ok: false, error: String(error && error.message ? error.message : error) };
    }
    if (!res || res.ok === false) {
      return set(name, { phase: 'failed', error: errorText(res, 'start command failed'), detail: '' });
    }
    set(name, { phase: 'starting' });

    const deadline = now() + startTimeoutMs;
    let lastProbe = null;
    while (now() < deadline) {
      await sleep(pollMs);
      if ((await isRunning(name)) === true) return set(name, { phase: 'running', error: '', detail: '' });
      if (probe) {
        try { lastProbe = await probe(name); } catch { lastProbe = null; }
        if (lastProbe && lastProbe.ok && !lastProbe.sessionAlive && !lastProbe.running) {
          return set(name, { phase: 'failed', error: 'gateway exited during startup', detail: lastProbe.logTail || '' });
        }
      }
    }
    return set(name, {
      phase: 'failed',
      error: `gateway did not report running within ${Math.round(startTimeoutMs / 1000)}s`,
      detail: (lastProbe && lastProbe.logTail) || ''
    });
  }

  async function doStop(name, action) {
    set(name, { phase: 'stop-requested', action, error: '', detail: '' });
    let res;
    try {
      res = await stopProfile(name);
    } catch (error) {
      res = { ok: false, error: String(error && error.message ? error.message : error) };
    }
    set(name, { phase: 'stopping' });
    const deadline = now() + stopTimeoutMs;
    for (;;) {
      const running = await isRunning(name);
      if (running === false) return set(name, { phase: 'stopped', error: '', detail: '' });
      if (now() >= deadline) break;
      await sleep(pollMs);
    }
    const why = res && res.ok === false ? errorText(res, 'stop command failed') : `gateway still running after ${Math.round(stopTimeoutMs / 1000)}s`;
    return set(name, { phase: 'failed', error: why, detail: '' });
  }

  function guard(name) {
    if (isBusy(name)) {
      const entry = get(name);
      return { ok: false, busy: true, ...entry, error: `already ${TRANSITIONAL.has(entry.phase) ? entry.phase : 'busy'}` };
    }
    return null;
  }

  // Run one operation for `name` exclusively; a concurrent one gets `busy`.
  async function exclusive(name, op) {
    const busy = guard(name);
    if (busy) return busy;
    inFlight.add(name);
    try {
      return await op();
    } finally {
      inFlight.delete(name);
    }
  }

  return {
    get,
    isBusy,
    snapshot() {
      const out = {};
      for (const [name, entry] of entries) out[name] = { ...entry };
      return out;
    },
    start(name) {
      return exclusive(name, async () => result(await doStart(name, 'start')));
    },
    stop(name) {
      return exclusive(name, async () => result(await doStop(name, 'stop')));
    },
    restart(name) {
      return exclusive(name, async () => {
        const running = await isRunning(name);
        if (running !== false) {
          const stopped = await doStop(name, 'restart');
          if (stopped.phase !== 'stopped') return result(stopped);
        }
        return result(await doStart(name, 'restart'));
      });
    },
    // Reconcile resting phases with an observed profile list.
    observe(profiles) {
      for (const p of profiles || []) {
        const entry = get(p.name);
        if (inFlight.has(p.name) || TRANSITIONAL.has(entry.phase)) continue;
        if (p.running && entry.phase !== 'running') {
          set(p.name, { phase: 'running', action: entry.action, error: '', detail: '' });
        } else if (!p.running && entry.phase === 'running') {
          set(p.name, { phase: 'stopped', action: entry.action });
        }
      }
    }
  };
}

module.exports = { createGatewayLifecycle, TRANSITIONAL };
