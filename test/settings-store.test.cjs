const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettingsStore, BUNDLE_KIND } = require('../electron/settings-store.cjs');
const { normalizeSettings } = require('../electron/app-settings.cjs');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'controller-settings-')); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

let tick = 0;
function makeStore(dir, extra = {}) {
  return createSettingsStore({
    dir,
    validators: { settings: (v) => normalizeSettings(v) },
    now: () => new Date(Date.UTC(2026, 9, 31, 12, 0, tick++)),
    ...extra
  });
}

test('atomic write keeps the previous version as .bak and reads fall back to it when the file is corrupt', () => {
  const dir = tmpDir();
  const store = makeStore(dir);
  store.write('settings', { language: 'en' });
  store.write('settings', { language: 'ja' });
  assert.equal(readJson(path.join(dir, 'settings.json.bak')).language, 'en');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ half written');
  const { value, source } = store.read('settings', null);
  assert.equal(source, 'backup');
  assert.equal(value.language, 'en');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});

test('backup -> change -> restore brings every settings file back', () => {
  const dir = tmpDir();
  const store = makeStore(dir);
  store.write('settings', normalizeSettings({ language: 'en', autoRestartEnabled: true }));
  store.write('controllerConfig', { distro: 'Ubuntu', hermesHome: '/home/test/.hermes' });
  store.write('profileLabels', { alpha: { label: 'Alpha', desc: '' } });
  const backup = store.createBackup('manual');
  assert.equal(backup.ok, true);

  store.write('settings', normalizeSettings({ language: 'ja' }));
  store.write('controllerConfig', { distro: 'Debian', hermesHome: '/elsewhere' });
  fs.rmSync(path.join(dir, 'profile-labels.json'));

  const res = store.restoreBackup(backup.id);
  assert.equal(res.ok, true, res.error);
  assert.ok(res.preRestoreId, 'a pre-restore snapshot was taken');
  assert.equal(readJson(path.join(dir, 'settings.json')).language, 'en');
  assert.equal(readJson(path.join(dir, 'settings.json')).autoRestartEnabled, true);
  assert.equal(readJson(path.join(dir, 'controller-config.json')).distro, 'Ubuntu');
  assert.equal(readJson(path.join(dir, 'profile-labels.json')).alpha.label, 'Alpha');

  // The pre-restore snapshot can undo the restore.
  assert.equal(store.restoreBackup(res.preRestoreId).ok, true);
  assert.equal(readJson(path.join(dir, 'controller-config.json')).distro, 'Debian');
  assert.ok(store.listBackups().length >= 3);
});

test('a write failure mid-restore rolls back to the previous settings', () => {
  const dir = tmpDir();
  let failOn = null;
  const flaky = {
    ...fs,
    renameSync(from, to) {
      if (failOn && to.endsWith(failOn)) { failOn = null; throw new Error('EIO: simulated disk error'); }
      return fs.renameSync(from, to);
    }
  };
  const store = makeStore(dir, { fs: flaky });
  store.write('settings', normalizeSettings({ language: 'en' }));
  store.write('controllerConfig', { distro: 'Ubuntu' });
  const backup = store.createBackup('good');
  store.write('settings', normalizeSettings({ language: 'ja' }));
  store.write('controllerConfig', { distro: 'Debian' });

  failOn = 'controller-config.json'; // settings.json is written first, then this fails
  const res = store.restoreBackup(backup.id);
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);
  assert.match(res.error, /simulated disk error/);
  assert.equal(readJson(path.join(dir, 'settings.json')).language, 'ja', 'already-written file was rolled back');
  assert.equal(readJson(path.join(dir, 'controller-config.json')).distro, 'Debian');
});

test('invalid, foreign or traversal backups are rejected without touching settings', () => {
  const dir = tmpDir();
  const store = makeStore(dir);
  store.write('settings', normalizeSettings({ language: 'ja' }));
  fs.mkdirSync(store.backupDir, { recursive: true });
  fs.writeFileSync(path.join(store.backupDir, 'bad-json.json'), '{');
  fs.writeFileSync(path.join(store.backupDir, 'foreign.json'), JSON.stringify({ kind: 'other', version: 1, files: {} }));
  fs.writeFileSync(path.join(store.backupDir, 'wrongtype.json'), JSON.stringify({ kind: BUNDLE_KIND, version: 1, files: { settings: [1, 2] } }));
  for (const id of ['bad-json', 'foreign', 'wrongtype', '../settings', 'nope']) {
    const res = store.restoreBackup(id);
    assert.equal(res.ok, false, id);
  }
  assert.equal(readJson(path.join(dir, 'settings.json')).language, 'ja');
  assert.deepEqual(store.listBackups().filter((b) => b.valid).length, 0);
});

test('restored settings are normalized by the validator', () => {
  const dir = tmpDir();
  const store = makeStore(dir);
  fs.mkdirSync(store.backupDir, { recursive: true });
  fs.writeFileSync(path.join(store.backupDir, 'odd.json'), JSON.stringify({ kind: BUNDLE_KIND, version: 1, files: { settings: { language: 'xx', serverCpuMax: 5000 } } }));
  assert.equal(store.restoreBackup('odd').ok, true);
  const saved = readJson(path.join(dir, 'settings.json'));
  assert.equal(saved.language, 'ko');
  assert.equal(saved.serverCpuMax, 100);
});

test('transaction() restores previous files when the mutation throws', () => {
  const dir = tmpDir();
  const store = makeStore(dir);
  store.write('controllerConfig', { distro: 'Ubuntu' });
  assert.throws(() => store.transaction(() => {
    store.write('controllerConfig', { distro: 'Broken' });
    throw new Error('apply failed');
  }), /apply failed/);
  assert.equal(readJson(path.join(dir, 'controller-config.json')).distro, 'Ubuntu');
});

test('backups are pruned to the most recent 30', () => {
  const dir = tmpDir();
  const store = makeStore(dir);
  for (let i = 0; i < 35; i += 1) store.createBackup('bulk');
  assert.equal(store.listBackups().length, 30);
});
