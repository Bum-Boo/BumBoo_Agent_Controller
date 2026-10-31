const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, Notification, powerMonitor, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const power = require('./power.cjs');
const { wslPath, shellQuote, run, createWslRunner } = require('./shell.cjs');
const { createHermesAdapter } = require('./hermes-adapter.cjs');
const { createModeManager } = require('./mode-manager.cjs');
const { createGatewayWatchdog } = require('./gateway-watchdog.cjs');
const { createLogStreamer } = require('./log-streamer.cjs');
const { loadControllerConfig, saveControllerConfig, publicConfig, normalizeConfig } = require('./runtime-config.cjs');
const { SETTINGS_DEFAULTS, normalizeSettings, applySettingsPatch } = require('./app-settings.cjs');
const { createSettingsStore } = require('./settings-store.cjs');
const { createServiceControl } = require('./service-control.cjs');
const { createGatewayLifecycle } = require('./gateway-lifecycle.cjs');
const { validName } = require('./hermes-adapter.cjs');

app.disableHardwareAcceleration();

const ROOT = path.resolve(__dirname, '..');
const HELPER_PS1 = path.join(__dirname, 'powercfg-helper.ps1');
let CONFIG = null;

const STARTUP_SHORTCUT_NAME = 'Hermes Lab Controller.lnk';

let mainWindow = null;
let tray = null;
let lastReady = null;
let pollTimer = null;
let modeManager = null;
let adapter = null;
let watchdog = null;
let logStreamer = null;
let currentStatus = null;
let currentMode = null;
let lifecycle = null;
// Set while the user has stopped the whole stack: background polls stay out
// of WSL until the user starts something again.
let stackHold = false;
let settingsStore = null;

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function runPowerShell(command, timeoutMs = 10000) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], timeoutMs);
}

const runWsl = createWslRunner(() => CONFIG);

const service = createServiceControl({
  getConfig: () => CONFIG,
  run,
  runWsl,
  runPowerShell,
  wslPath
});

function psSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function store() {
  if (!settingsStore) {
    settingsStore = createSettingsStore({
      dir: app.getPath('userData'),
      validators: {
        settings: (value) => normalizeSettings(value),
        controllerConfig: (value) => {
          const cfg = normalizeConfig(value);
          return {
            distro: cfg.distro,
            dashboardUrl: cfg.dashboardUrl,
            dashboardTaskName: cfg.dashboardTaskName,
            labRoot: cfg.labRoot,
            hermesHome: cfg.hermesHome,
            hermesCommand: cfg.hermesCommand,
            pollMs: cfg.pollMs
          };
        }
      }
    });
  }
  return settingsStore;
}

function readSettings() {
  const { value, source } = store().read('settings', null);
  return source === 'default' ? { ...SETTINGS_DEFAULTS } : normalizeSettings(value);
}

function writeSettings(nextSettings) {
  return store().write('settings', normalizeSettings(nextSettings));
}

// Profile labels: user-assigned display names + descriptions per profile.
// Stored in userData/profile-labels.json as { [technicalName]: { label, desc } }.
function readProfileLabels() {
  const { value } = store().read('profileLabels', {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeProfileLabel(name, label, desc) {
  const labels = readProfileLabels();
  const trimLabel = (label || '').trim();
  const trimDesc = (desc || '').trim();
  if (!trimLabel && !trimDesc) {
    delete labels[name];
  } else {
    labels[name] = { label: trimLabel, desc: trimDesc };
  }
  return store().write('profileLabels', labels);
}


function profileRuntimePath() {
  return path.join(app.getPath('userData'), 'profile-runtime-state.json');
}

function profileHistoryPath() {
  return path.join(app.getPath('userData'), 'profile-change-history.json');
}

function readJsonObject(file, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : fallback;
  } catch { return fallback; }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readProfileRuntimeState() {
  return readJsonObject(profileRuntimePath(), {});
}

function writeProfileRuntimeState(state) {
  writeJsonFile(profileRuntimePath(), state || {});
  return state || {};
}

function markProfileRestartNeeded(name, reason, fields = []) {
  const state = readProfileRuntimeState();
  state[name] = {
    ...(state[name] || {}),
    restartNeeded: true,
    reason,
    fields,
    changedAt: new Date().toISOString()
  };
  return writeProfileRuntimeState(state);
}

function clearProfileRestartNeeded(name) {
  const state = readProfileRuntimeState();
  if (state[name]) {
    state[name] = { ...state[name], restartNeeded: false, clearedAt: new Date().toISOString() };
  }
  return writeProfileRuntimeState(state);
}

function readProfileChangeHistory() {
  const raw = readJsonObject(profileHistoryPath(), []);
  return Array.isArray(raw) ? raw : [];
}

function appendProfileChangeHistory(entry) {
  const history = readProfileChangeHistory();
  history.unshift({ at: new Date().toISOString(), ...entry });
  const trimmed = history.slice(0, 200);
  writeJsonFile(profileHistoryPath(), trimmed);
  return trimmed;
}

function getProfileOpsState() {
  return {
    runtime: readProfileRuntimeState(),
    history: readProfileChangeHistory().slice(0, 60),
    watchdog: {
      config: readSettings(),
      state: watchdog && typeof watchdog.getState === 'function' ? watchdog.getState() : null
    }
  };
}

async function setProfileModelSettings(name, patch) {
  if (!adapter) return { ok: false, error: 'adapter not ready' };
  const beforeList = await adapter.listProfiles();
  const before = beforeList && Array.isArray(beforeList.profiles)
    ? beforeList.profiles.find((p) => p.name === name)
    : null;
  const result = await adapter.setProfileModelSettings(name, patch || {});
  if (result && result.ok) {
    const fields = [];
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'model')) fields.push('model');
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'reasoning')) fields.push('reasoning');
    appendProfileChangeHistory({
      profile: name,
      action: 'settings.update',
      fields,
      patch,
      backup: result.output || '',
      requiresRestart: Boolean(before && before.running)
    });
    if (before && before.running && fields.length) {
      markProfileRestartNeeded(name, '모델/추론 설정 변경은 실행 중 gateway에 즉시 보장 적용되지 않음', fields);
    }
  }
  return result;
}

async function restoreProfileBackup(name, backupId) {
  if (!adapter) return { ok: false, error: 'adapter not ready' };
  const beforeList = await adapter.listProfiles();
  const before = beforeList && Array.isArray(beforeList.profiles)
    ? beforeList.profiles.find((p) => p.name === name)
    : null;
  const result = await adapter.restoreProfileBackup(name, backupId);
  if (result && result.ok) {
    appendProfileChangeHistory({
      profile: name,
      action: 'backup.restore',
      backupId,
      rollback: result.output || '',
      requiresRestart: Boolean(before && before.running)
    });
    if (before && before.running) {
      markProfileRestartNeeded(name, 'config 백업 복원은 실행 중 gateway 재시작 후 확실히 반영됨', ['restore']);
    }
  }
  return result;
}

function startupFolderPath() {
  const appData = process.env.APPDATA || app.getPath('appData');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function startupShortcutPath() {
  return path.join(startupFolderPath(), STARTUP_SHORTCUT_NAME);
}

function startupTargetPath() {
  return path.join(ROOT, 'Start-HermesControl-Minimized.cmd');
}

async function readShortcutTarget(shortcutPath) {
  if (!fs.existsSync(shortcutPath)) return '';
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut('${psSingleQuote(shortcutPath)}')`,
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Write-Output $shortcut.TargetPath'
  ].join('; ');
  const result = await runPowerShell(command, 5000);
  return result.stdout.trim();
}

async function getStartupState() {
  const shortcutPath = startupShortcutPath();
  const targetPath = await readShortcutTarget(shortcutPath);
  const normalizedTarget = targetPath.toLowerCase();
  const expectedTarget = startupTargetPath().toLowerCase();
  return {
    enabled: Boolean(targetPath && normalizedTarget === expectedTarget),
    managed: Boolean(targetPath && normalizedTarget.includes('\\hermescontrol')),
    shortcutPath,
    targetPath
  };
}

async function setStartupEnabled(enabled) {
  const shortcutPath = startupShortcutPath();
  if (enabled) {
    fs.mkdirSync(startupFolderPath(), { recursive: true });
    const iconPath = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const command = [
      '$ErrorActionPreference = "Stop"',
      '$shell = New-Object -ComObject WScript.Shell',
      `$shortcut = $shell.CreateShortcut('${psSingleQuote(shortcutPath)}')`,
      `$shortcut.TargetPath = '${psSingleQuote(startupTargetPath())}'`,
      `$shortcut.WorkingDirectory = '${psSingleQuote(ROOT)}'`,
      `$shortcut.IconLocation = '${psSingleQuote(`${iconPath},0`)}'`,
      "$shortcut.Description = 'Start Hermes Lab controller minimized'",
      '$shortcut.Save()'
    ].join('; ');
    await runPowerShell(command, 8000);
    return getStartupState();
  }

  const state = await getStartupState();
  if (fs.existsSync(shortcutPath) && (!state.targetPath || state.managed)) {
    fs.unlinkSync(shortcutPath);
  }
  return getStartupState();
}

async function getAppSettings() {
  const [settings, startup] = await Promise.all([readSettings(), getStartupState()]);
  return {
    ...settings,
    startupEnabled: startup.enabled,
    startupShortcutPath: startup.shortcutPath
  };
}

async function updateAppSettings(patch = {}) {
  const before = readSettings();
  writeSettings(applySettingsPatch(before, patch || {}));

  if (typeof patch.startupEnabled === 'boolean') {
    await setStartupEnabled(patch.startupEnabled);
  }

  // Re-apply CPU cap / threshold to a live server plan if those changed.
  const after = readSettings();
  if (modeManager && (after.serverCpuMax !== before.serverCpuMax || after.idleThresholdMinutes !== before.idleThresholdMinutes)) {
    await modeManager.refreshConfig();
  }

  const settings = await getAppSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hermes:settingsChanged', settings);
  }
  return settings;
}

async function publishStatus({ notify = false } = {}) {
  const status = await service.getStatus();
  currentStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hermes:statusChanged', status);
  }
  if (notify && lastReady !== null && lastReady !== status.ready) {
    new Notification({
      title: status.ready ? 'Hermes connected' : 'Hermes disconnected',
      body: status.ready ? 'Dashboard and Codex OAuth are online.' : 'Hermes is stopped or partially disconnected.'
    }).show();
  }
  lastReady = status.ready;
  applyTray();
  return status;
}

// A whole-stack stop takes every gateway down on purpose: forget them so the
// watchdog does not report them as crashed once WSL is back.
function forgetDesiredGateways() {
  stackHold = true;
  if (!watchdog) return;
  for (const name of watchdog.getState().desired) watchdog.setDesired(name, false);
}

async function startHermes() {
  stackHold = false;
  const status = await service.start({ publish: () => publishStatus({ notify: false }) });
  lastReady = status.ready;
  const body = status.outcome === 'running'
    ? 'Hermes is running.'
    : `Start did not complete (${status.outcome}): ${status.error}`;
  new Notification({ title: 'Hermes Lab', body }).show();
  return status;
}

async function stopHermes() {
  forgetDesiredGateways();
  const status = await service.stop({ publish: () => publishStatus({ notify: false }) });
  lastReady = status.ready;
  const body = status.outcome === 'stopped'
    ? 'Hermes and the WSL distro were stopped.'
    : `Stop did not complete: ${status.error}`;
  new Notification({ title: 'Hermes Lab', body }).show();
  return status;
}

// Full WSL shutdown: `wsl --shutdown` stops the entire WSL2 backend VM (every
// distro + the utility VM), releasing all of its RAM — heavier than stopHermes,
// which only terminates the configured distro.
async function shutdownWsl() {
  forgetDesiredGateways();
  const status = await service.shutdownWsl({ publish: () => publishStatus({ notify: false }) });
  new Notification({ title: 'WSL', body: status.outcome === 'stopped' ? 'WSL을 완전히 종료했습니다. 메모리가 해제됩니다.' : 'WSL 종료가 확인되지 않았습니다.' }).show();
  return status;
}

function makeTrayImage(color = '#6b7280') {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#111827"/>
      <circle cx="16" cy="16" r="8" fill="${color}"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

// Tray reflects BOTH power mode and Hermes status. Mode takes visual priority
// while in/transitioning to server mode.
function applyTray() {
  if (!tray) return;
  const status = currentStatus;
  const mode = currentMode;

  let color = '#6b7280';
  let tip = 'Hermes Lab';

  if (mode && mode.transitioning) {
    color = '#eab308';
    tip = 'Hermes Lab: switching mode…';
  } else if (mode && mode.mode === 'server') {
    color = mode.trigger === 'manual' ? '#3b82f6' : '#38bdf8';
    tip = mode.trigger === 'manual' ? 'Hermes Lab: server mode (manual)' : 'Hermes Lab: server mode (auto)';
  } else if (status) {
    color = status.ready ? '#22c55e' : status.wslRunning ? '#f59e0b' : '#ef4444';
    tip = status.ready ? 'Hermes Lab: connected' : status.wslRunning ? 'Hermes Lab: partial' : 'Hermes Lab: stopped';
  }

  tray.setImage(makeTrayImage(color));
  tray.setToolTip(tip);
  refreshTrayMenu();
}

function onModeChanged(state) {
  currentMode = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hermes:modeChanged', state);
  }
  applyTray();
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function buildTrayMenu() {
  const inServer = currentMode && currentMode.mode === 'server';
  return Menu.buildFromTemplate([
    { label: 'Open', click: showWindow },
    { type: 'separator' },
    { label: 'Start Hermes', click: () => startHermes() },
    { label: 'Stop Hermes', click: () => stopHermes() },
    { type: 'separator' },
    inServer
      ? { label: 'Return to user mode', click: () => modeManager && modeManager.exitServerMode() }
      : { label: 'Enter server mode', click: () => modeManager && modeManager.enterServerMode() },
    { type: 'separator' },
    { label: 'Open Dashboard', click: () => shell.openExternal(CONFIG.dashboardUrl) },
    { label: 'Open Lab Folder', click: () => shell.openPath(CONFIG.labUnc) },
    { type: 'separator' },
    { label: 'Quit Controller', click: () => app.quit() }
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(makeTrayImage());
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', showWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 820,
    minWidth: 860,
    minHeight: 720,
    title: 'Hermes Lab Controller',
    backgroundColor: '#111317',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--minimized')) {
      mainWindow.show();
    }
    publishStatus();
    if (watchdog) watchdog.refreshNow(); // push an initial profile snapshot to the freshly-loaded UI
    if (process.argv.includes('--capture')) {
      setTimeout(async () => {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(ROOT, 'preview.png'), image.toPNG());
        app.exit(0);
      }, 1600);
    }
  });
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}


function applyControllerConfig(next) {
  CONFIG = next;
  if (adapter) adapter = createHermesAdapter(runWsl, CONFIG);
  if (logStreamer) {
    logStreamer.stop();
    logStreamer = createLogStreamer({
      wslPath: wslPath(),
      distro: CONFIG.distro,
      hermesHome: CONFIG.hermesHome,
      onLine: (name, line) => sendToWindow('hermes:logLine', { name, line }),
      onEnd: (name) => sendToWindow('hermes:logEnd', { name })
    });
  }
}

// --- diagnostics aggregation -------------------------------------------------

async function getDiagnostics() {
  const [activePlan, plans, requests] = await Promise.all([
    power.getActivePlan(),
    power.listPlans(),
    power.getPowerRequests()
  ]);
  return {
    wslConfig: power.readWslConfig(),
    activePlan,
    plans,
    requests
  };
}

// --- IPC ---------------------------------------------------------------------

ipcMain.handle('hermes:getStatus', () => publishStatus());
ipcMain.handle('hermes:start', () => startHermes());
ipcMain.handle('hermes:stop', () => stopHermes());
ipcMain.handle('hermes:shutdownWsl', async () => {
  const opts = {
    type: 'warning',
    buttons: ['WSL 종료', '취소'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'WSL 완전 종료',
    message: 'WSL을 완전히 종료할까요?',
    detail: '실행 중인 모든 WSL 배포판과 게이트웨이가 즉시 중지되고 메모리가 해제됩니다. 다시 사용하려면 시작 버튼으로 재기동해야 합니다.'
  };
  const { response } = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, opts)
    : await dialog.showMessageBox(opts);
  if (response !== 0) return { cancelled: true, status: currentStatus };
  const status = await shutdownWsl();
  return { cancelled: false, status };
});
ipcMain.handle('hermes:openDashboard', () => shell.openExternal(CONFIG.dashboardUrl));
ipcMain.handle('hermes:openLabFolder', () => shell.openPath(CONFIG.labUnc));
ipcMain.handle('hermes:getSettings', () => getAppSettings());
ipcMain.handle('hermes:updateSettings', (_event, patch) => updateAppSettings(patch));
ipcMain.handle('hermes:getControllerConfig', () => publicConfig(CONFIG));
ipcMain.handle('hermes:detectControllerEnvironment', () => service.detectControllerEnvironment());
ipcMain.handle('hermes:testControllerConfig', (_event, patch) => service.testControllerConfig(patch));
ipcMain.handle('hermes:updateControllerConfig', async (_event, patch) => {
  const previous = CONFIG;
  try {
    // Save + apply as one step: if applying throws, the previous file and
    // the previous in-memory config are both put back.
    store().transaction(() => {
      const next = saveControllerConfig(app.getPath('userData'), patch || {});
      applyControllerConfig(next);
    });
  } catch (error) {
    applyControllerConfig(previous);
    return { ok: false, error: `설정 저장 실패, 이전 설정으로 복구함: ${error.message}`, config: publicConfig(CONFIG) };
  }
  const status = await publishStatus({ notify: false });
  return { ok: true, config: publicConfig(CONFIG), status };
});

// --- controller settings backup / restore -----------------------------------

ipcMain.handle('hermes:listSettingsBackups', () => store().listBackups());
ipcMain.handle('hermes:createSettingsBackup', () => {
  try { return store().createBackup('manual'); } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('hermes:restoreSettingsBackup', async (_event, id) => {
  const before = readSettings();
  const previousConfig = CONFIG;
  const res = store().restoreBackup(id);
  if (!res.ok) return res;
  try {
    applyControllerConfig(loadControllerConfig(app.getPath('userData')));
    const after = readSettings();
    if (modeManager && (after.serverCpuMax !== before.serverCpuMax || after.idleThresholdMinutes !== before.idleThresholdMinutes)) {
      await modeManager.refreshConfig();
    }
  } catch (error) {
    // Applying the restored settings failed: go back to what we had.
    if (res.preRestoreId) store().restoreBackup(res.preRestoreId);
    applyControllerConfig(previousConfig);
    return { ok: false, error: `복원한 설정 적용 실패, 이전 설정으로 복구함: ${error.message}`, rolledBack: true };
  }
  const settings = await getAppSettings();
  sendToWindow('hermes:settingsChanged', settings);
  return { ...res, settings, config: publicConfig(CONFIG), labels: readProfileLabels() };
});

ipcMain.handle('hermes:getMode', () => (modeManager ? modeManager.getState() : null));
ipcMain.handle('hermes:enterServerMode', () => (modeManager ? modeManager.enterServerMode() : null));
ipcMain.handle('hermes:exitServerMode', () => (modeManager ? modeManager.exitServerMode() : null));
ipcMain.handle('hermes:getModeHistory', () => (modeManager ? modeManager.getHistory() : []));

ipcMain.handle('hermes:getProfiles', async () => {
  if (!adapter) return { ok: false, profiles: [] };
  const res = await adapter.listProfiles();
  if (res && res.ok && lifecycle) lifecycle.observe(res.profiles);
  return res;
});
ipcMain.handle('hermes:getModelOptions', () => (adapter ? adapter.modelOptions() : { ok: false, models: [], reasoning: [] }));
ipcMain.handle('hermes:setProfileModelSettings', (_event, name, patch) => setProfileModelSettings(name, patch));
ipcMain.handle('hermes:getProfileOpsState', () => getProfileOpsState());
ipcMain.handle('hermes:getProfileBackups', (_event, name) => (adapter ? adapter.listProfileBackups(name) : { ok: false, backups: [] }));
ipcMain.handle('hermes:restoreProfileBackup', (_event, name, backupId) => restoreProfileBackup(name, backupId));
ipcMain.handle('hermes:getProfileLogSummary', (_event, name) => (adapter ? adapter.profileLogSummary(name) : { ok: false }));
ipcMain.handle('hermes:useProfile', (_event, name) => (adapter ? adapter.useProfile(name) : { ok: false }));

// Gateway start/stop/restart resolve only once the process state is confirmed
// (or failed); intermediate phases are pushed as hermes:gatewayPhase events.
async function runGatewayAction(action, name) {
  if (!adapter || !lifecycle) return { ok: false, phase: 'failed', error: 'adapter not ready' };
  if (!validName(name)) return { ok: false, phase: 'failed', error: 'invalid profile name' };
  if (action !== 'stop') stackHold = false; // the user wants WSL up again
  if (watchdog) watchdog.setDesired(name, action !== 'stop'); // mark intent before acting
  const result = await lifecycle[action](name);
  if (result.busy) return result;
  if (action !== 'stop') {
    if (result.ok) clearProfileRestartNeeded(name);
    // A start the user saw fail is not a gateway the watchdog should revive.
    else if (watchdog) watchdog.setDesired(name, false);
  }
  appendProfileChangeHistory({
    profile: name,
    action: `gateway.${action}`,
    outcome: result.phase,
    ...(result.ok ? {} : { error: result.error })
  });
  if (watchdog) watchdog.refreshNow();
  return result;
}

ipcMain.handle('hermes:gatewayStart', (_event, name) => runGatewayAction('start', name));
ipcMain.handle('hermes:gatewayStop', (_event, name) => runGatewayAction('stop', name));
ipcMain.handle('hermes:gatewayRestart', (_event, name) => runGatewayAction('restart', name));
ipcMain.handle('hermes:getGatewayPhases', () => (lifecycle ? lifecycle.snapshot() : {}));

ipcMain.handle('hermes:getDiagnostics', () => getDiagnostics());
ipcMain.handle('hermes:getRequestsElevated', () => power.getPowerRequestsElevated(HELPER_PS1));

ipcMain.handle('hermes:getProfileLabels', () => readProfileLabels());
ipcMain.handle('hermes:setProfileLabel', (_event, name, label, desc) => writeProfileLabel(name, label, desc));

ipcMain.handle('hermes:logStart', (_event, name) => (logStreamer ? logStreamer.start(name) : { ok: false }));
ipcMain.handle('hermes:logStop', () => { if (logStreamer) logStreamer.stop(); return { ok: true }; });

// WSL memory allocation lives in %USERPROFILE%\.wslconfig ([wsl2] memory=NGB).
ipcMain.handle('hermes:getWslMemory', () => {
  const cfg = power.readWslConfig();
  const totalGb = Math.round(os.totalmem() / (1024 ** 3));
  // Parse the current "NGB"/"NMB" value into integer GB, if present.
  let currentGb = null;
  if (cfg.memory) {
    const m = String(cfg.memory).match(/^(\d+(?:\.\d+)?)\s*(gb|mb|g|m)?/i);
    if (m) {
      const n = Number(m[1]);
      const unit = (m[2] || 'gb').toLowerCase();
      currentGb = unit.startsWith('m') ? Math.round(n / 1024) : Math.round(n);
    }
  }
  return { exists: cfg.exists, raw: cfg.memory, currentGb, totalGb, path: cfg.path };
});

ipcMain.handle('hermes:setWslMemory', async (_event, gb, applyNow) => {
  const n = Number(gb);
  const value = Number.isFinite(n) && n > 0 ? `${n}GB` : null; // null => clear (WSL auto-default)
  const res = power.setWslConfigValue('memory', value);
  let restarted = false;
  if (applyNow) {
    forgetDesiredGateways();
    await runPowerShell(`Stop-ScheduledTask -TaskName "${CONFIG.dashboardTaskName}"`, 10000).catch(() => {});
    await runWsl(`HERMES_HOME=${shellQuote(CONFIG.hermesHome)} ${shellQuote(CONFIG.hermesCommand)} gateway stop >/dev/null 2>&1 || true`, 12000).catch(() => {});
    await run(wslPath(), ['--shutdown'], 25000);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await publishStatus({ notify: false });
    restarted = true;
    new Notification({ title: 'WSL 메모리 설정', body: value ? `WSL 메모리를 ${value}로 적용했습니다 (WSL 재시작됨).` : 'WSL 메모리 제한을 해제했습니다 (WSL 재시작됨).' }).show();
  }
  return { ...res, restarted };
});

app.whenReady().then(() => {
  CONFIG = loadControllerConfig(app.getPath('userData'));
  adapter = createHermesAdapter(runWsl, CONFIG);

  modeManager = createModeManager({
    powerMonitor,
    powerSaveBlocker,
    power,
    getConfig: () => readSettings(),
    persistServerPlanGuid: (guid) => writeSettings({ ...readSettings(), serverPlanGuid: guid }),
    onChange: onModeChanged,
    notify: ({ title, body }) => new Notification({ title, body }).show(),
    historyFile: path.join(app.getPath('userData'), 'mode-history.json')
  });

  lifecycle = createGatewayLifecycle({
    startProfile: (name) => adapter.gatewayStartProfile(name),
    stopProfile: (name) => adapter.gatewayStopProfile(name),
    listProfiles: () => adapter.listProfiles(),
    probe: (name) => adapter.gatewayProcessStatus(name),
    onChange: (entry) => sendToWindow('hermes:gatewayPhase', entry)
  });

  watchdog = createGatewayWatchdog({
    // Background polls must not boot a stopped distro (`wsl -d` starts it),
    // which undid "Stop Hermes" and reported every gateway as crashed.
    listProfiles: async () => ((!stackHold && await service.isWslRunning())
      ? adapter.listProfiles()
      : { ok: false, profiles: [], error: 'WSL distro is not running' }),
    // Auto-restart goes through the lifecycle so "restarted" means running.
    startProfile: (name) => lifecycle.start(name),
    isBusy: (name) => lifecycle.isBusy(name),
    getConfig: () => readSettings(),
    onEvent: (event) => sendToWindow('hermes:gatewayEvent', event),
    onProfiles: (payload) => {
      lifecycle.observe(payload.profiles);
      sendToWindow('hermes:profilesUpdated', payload);
    },
    notify: ({ title, body }) => new Notification({ title, body }).show(),
    pollMs: Number(process.env.HERMES_CONTROLLER_WATCHDOG_POLL_MS) || undefined
  });

  logStreamer = createLogStreamer({
    wslPath: wslPath(),
    distro: CONFIG.distro,
    hermesHome: CONFIG.hermesHome,
    onLine: (name, line) => sendToWindow('hermes:logLine', { name, line }),
    onEnd: (name) => sendToWindow('hermes:logEnd', { name })
  });

  createTray();
  createWindow();
  modeManager.start();
  watchdog.start();

  pollTimer = setInterval(() => publishStatus({ notify: true }), CONFIG.pollMs);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
  if (modeManager) modeManager.stop();
  if (watchdog) watchdog.stop();
  if (logStreamer) logStreamer.stop();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
