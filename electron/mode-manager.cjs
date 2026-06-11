// Mode state machine: USER <-> SERVER, with manual vs auto distinction.
//
//   user                          server (manual)            server (auto)
//    | manual toggle on   ------->  |                          |
//    | 20min idle (auto)  --------------------------------->   |
//    |                              | manual toggle off ----+  |
//    | <--------------- input detected (auto only) -------- | -+
//
// Key rule: a MANUAL server session is intentional and never auto-returns on
// input. Only an AUTO (idle-triggered) session returns to user mode when the
// user touches the machine again.

const POLL_MS = 30000; // idle poll cadence
const AUTO_RETURN_IDLE_SEC = 25; // below this => fresh input happened this cycle
const HISTORY_CAP = 200;

const fs = require('node:fs');

function now() {
  return Date.now();
}

function createModeManager(deps) {
  const {
    powerMonitor,
    powerSaveBlocker,
    power,
    getConfig, // () => { idleThresholdMinutes, serverCpuMax, autoServerEnabled, turnOffDisplayOnServer, serverPlanGuid }
    persistServerPlanGuid, // (guid) => void
    onChange, // (state) => void
    notify, // ({ title, body }) => void
    historyFile
  } = deps;

  let mode = 'user'; // 'user' | 'server'
  let trigger = null; // 'manual' | 'auto' | null
  let transitioning = false;
  let since = now();
  let idleSeconds = 0;
  let lastTickAt = now();
  let blockerId = null;
  let previousPlan = null; // { guid, name } captured before entering server mode
  let planName = '';
  let pollTimer = null;
  let history = loadHistory();

  function loadHistory() {
    try {
      const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      return Array.isArray(parsed) ? parsed.slice(-HISTORY_CAP) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      fs.writeFileSync(historyFile, JSON.stringify(history.slice(-HISTORY_CAP), null, 2));
    } catch {
      /* non-fatal */
    }
  }

  function logHistory(entry) {
    history.push({ at: new Date().toISOString(), ...entry });
    if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
    saveHistory();
  }

  function snapshot() {
    const cfg = getConfig();
    return {
      mode,
      trigger,
      transitioning,
      since,
      idleSeconds,
      lastTickAt,
      thresholdSeconds: Math.max(60, (cfg.idleThresholdMinutes || 20) * 60),
      autoServerEnabled: cfg.autoServerEnabled !== false,
      planName,
      serverCpuMax: cfg.serverCpuMax || 70,
      blocking: blockerId !== null && powerSaveBlocker.isStarted(blockerId)
    };
  }

  function emit() {
    if (typeof onChange === 'function') onChange(snapshot());
  }

  function startBlocker() {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return;
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
  }

  function stopBlocker() {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
    }
    blockerId = null;
  }

  // --- transitions -----------------------------------------------------------

  async function enterServer(nextTrigger) {
    if (transitioning) return snapshot();
    if (mode === 'server') {
      // Already in server mode; just reconcile the trigger (manual outranks auto).
      if (nextTrigger === 'manual') trigger = 'manual';
      emit();
      return snapshot();
    }
    transitioning = true;
    emit();
    try {
      const cfg = getConfig();
      previousPlan = await power.getActivePlan();

      const ensured = await power.ensureServerPlan(cfg.serverPlanGuid, cfg.serverCpuMax || 70);
      if (ensured.created || ensured.guid !== cfg.serverPlanGuid) {
        persistServerPlanGuid(ensured.guid);
      }
      await power.activatePlan(ensured.guid);
      planName = power.SERVER_PLAN_NAME;

      startBlocker();

      if (cfg.turnOffDisplayOnServer !== false) {
        await power.turnOffDisplay();
      }

      mode = 'server';
      trigger = nextTrigger;
      since = now();
      logHistory({ event: 'enter', mode: 'server', trigger: nextTrigger, fromPlan: previousPlan ? previousPlan.name : null });
      notify({
        title: nextTrigger === 'auto' ? 'Server mode (auto)' : 'Server mode',
        body: nextTrigger === 'auto'
          ? `No input for a while. Switched to low-power server mode (CPU ≤ ${ensured.cap.maxPercent}%).`
          : `Low-power server mode is on (CPU ≤ ${ensured.cap.maxPercent}%).`
      });
    } catch (error) {
      // Roll back partial state on failure.
      stopBlocker();
      notify({ title: 'Server mode failed', body: String(error && error.message ? error.message : error) });
    } finally {
      transitioning = false;
      emit();
    }
    return snapshot();
  }

  async function exitToUser(reason) {
    if (transitioning) return snapshot();
    if (mode === 'user') {
      emit();
      return snapshot();
    }
    transitioning = true;
    emit();
    try {
      stopBlocker();
      if (previousPlan && previousPlan.guid) {
        await power.activatePlan(previousPlan.guid);
      }
      planName = previousPlan ? previousPlan.name : '';
      const fromTrigger = trigger;
      mode = 'user';
      trigger = null;
      since = now();
      logHistory({ event: 'exit', mode: 'user', reason: reason || 'manual', restoredPlan: previousPlan ? previousPlan.name : null, wasTrigger: fromTrigger });
      previousPlan = null;
      notify({ title: 'User mode', body: 'Restored normal power and resumed user mode.' });
    } catch (error) {
      notify({ title: 'Return to user mode failed', body: String(error && error.message ? error.message : error) });
    } finally {
      transitioning = false;
      emit();
    }
    return snapshot();
  }

  // --- polling ---------------------------------------------------------------

  function tick() {
    if (transitioning) return;
    const cfg = getConfig();
    idleSeconds = Number(powerMonitor.getSystemIdleTime()) || 0;
    lastTickAt = now();
    const thresholdSeconds = Math.max(60, (cfg.idleThresholdMinutes || 20) * 60);

    if (mode === 'user') {
      if (cfg.autoServerEnabled !== false && idleSeconds >= thresholdSeconds) {
        enterServer('auto');
        return;
      }
    } else if (mode === 'server' && trigger === 'auto') {
      // Fresh input this cycle -> return to the user.
      if (idleSeconds < AUTO_RETURN_IDLE_SEC) {
        exitToUser('input-detected');
        return;
      }
    }
    emit();
  }

  function start() {
    if (pollTimer) return;
    tick();
    pollTimer = setInterval(tick, POLL_MS);
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // --- public API ------------------------------------------------------------

  return {
    start,
    stop,
    getState: snapshot,
    getHistory: () => history.slice().reverse(),
    setManualServer: (on) => (on ? enterServer('manual') : exitToUser('manual')),
    enterServerMode: () => enterServer('manual'),
    exitServerMode: () => exitToUser('manual'),
    // Called when the user changes CPU cap / threshold so a live server plan re-applies.
    refreshConfig: async () => {
      const cfg = getConfig();
      if (cfg.serverPlanGuid) {
        try {
          await power.setCpuCap(cfg.serverPlanGuid, cfg.serverCpuMax || 70);
          if (mode === 'server') await power.activatePlan(cfg.serverPlanGuid);
        } catch {
          /* non-fatal */
        }
      }
      emit();
    }
  };
}

module.exports = { createModeManager };
