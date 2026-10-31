// Controller app settings (userData/settings.json): defaults, normalization
// and how a renderer patch is applied.

const SETTINGS_DEFAULTS = {
  language: 'ko',
  // Power / server-mode settings
  autoServerEnabled: true,
  idleThresholdMinutes: 20,
  serverCpuMax: 70,
  turnOffDisplayOnServer: true,
  serverPlanGuid: '',
  // Gateway watchdog
  autoRestartEnabled: false,
  autoRestartMax: 3
};
const SUPPORTED_LANGUAGES = new Set(['ko', 'zh', 'ja', 'en']);

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeSettings(raw) {
  const base = { ...SETTINGS_DEFAULTS, ...(raw || {}) };
  return {
    language: SUPPORTED_LANGUAGES.has(base.language) ? base.language : SETTINGS_DEFAULTS.language,
    autoServerEnabled: base.autoServerEnabled !== false,
    idleThresholdMinutes: clampInt(base.idleThresholdMinutes, 1, 240, SETTINGS_DEFAULTS.idleThresholdMinutes),
    serverCpuMax: clampInt(base.serverCpuMax, 20, 100, SETTINGS_DEFAULTS.serverCpuMax),
    turnOffDisplayOnServer: base.turnOffDisplayOnServer !== false,
    serverPlanGuid: typeof base.serverPlanGuid === 'string' ? base.serverPlanGuid : '',
    autoRestartEnabled: base.autoRestartEnabled === true,
    autoRestartMax: clampInt(base.autoRestartMax, 1, 10, SETTINGS_DEFAULTS.autoRestartMax)
  };
}

// Only whitelisted, correctly typed fields from the renderer are applied.
function applySettingsPatch(before, patch = {}) {
  const next = { ...before };
  if (typeof patch.language === 'string') next.language = patch.language;
  if (typeof patch.autoServerEnabled === 'boolean') next.autoServerEnabled = patch.autoServerEnabled;
  if (typeof patch.turnOffDisplayOnServer === 'boolean') next.turnOffDisplayOnServer = patch.turnOffDisplayOnServer;
  if (patch.idleThresholdMinutes !== undefined) next.idleThresholdMinutes = patch.idleThresholdMinutes;
  if (patch.serverCpuMax !== undefined) next.serverCpuMax = patch.serverCpuMax;
  if (typeof patch.autoRestartEnabled === 'boolean') next.autoRestartEnabled = patch.autoRestartEnabled;
  if (patch.autoRestartMax !== undefined) next.autoRestartMax = patch.autoRestartMax;
  return normalizeSettings(next);
}

module.exports = { SETTINGS_DEFAULTS, SUPPORTED_LANGUAGES, clampInt, normalizeSettings, applySettingsPatch };
