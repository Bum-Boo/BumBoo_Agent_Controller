const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS_DEFAULTS, normalizeSettings, applySettingsPatch } = require('../electron/app-settings.cjs');

test('normalizeSettings clamps and fills defaults', () => {
  assert.deepEqual(normalizeSettings(null), SETTINGS_DEFAULTS);
  const n = normalizeSettings({ language: 'xx', idleThresholdMinutes: 9999, serverCpuMax: 1, autoRestartMax: 'abc' });
  assert.equal(n.language, 'ko');
  assert.equal(n.idleThresholdMinutes, 240);
  assert.equal(n.serverCpuMax, 20);
  assert.equal(n.autoRestartMax, 3);
});

test('applySettingsPatch persists the gateway auto-restart settings (regression)', () => {
  // The Settings tab sends these two fields; they used to be dropped, so the
  // toggle snapped back and the watchdog never auto-restarted.
  const next = applySettingsPatch(SETTINGS_DEFAULTS, { autoRestartEnabled: true });
  assert.equal(next.autoRestartEnabled, true);
  assert.equal(applySettingsPatch(next, { autoRestartMax: 7 }).autoRestartMax, 7);
  assert.equal(applySettingsPatch(next, { autoRestartEnabled: false }).autoRestartEnabled, false);
});

test('applySettingsPatch ignores unknown and mistyped fields', () => {
  const next = applySettingsPatch(SETTINGS_DEFAULTS, { autoRestartEnabled: 'yes', serverPlanGuid: 'evil', bogus: 1 });
  assert.deepEqual(next, SETTINGS_DEFAULTS);
});
