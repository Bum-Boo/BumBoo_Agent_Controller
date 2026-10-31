// Durable storage for the controller's own settings files in userData, with
// backup/restore that falls back to the previous settings on any failure.
//
//   settings.json            app settings (language, power, watchdog)
//   controller-config.json   WSL/Hermes connection settings
//   profile-labels.json      user display names for profiles
//
// - Writes are atomic (temp file + rename) and keep the previous good file as
//   <name>.bak; a corrupt or unreadable file is read from .bak instead of
//   silently falling back to defaults.
// - Backups are JSON bundles in userData/settings-backups/<id>.json.
// - restoreBackup() validates the bundle, snapshots the current files, writes
//   the bundle, re-reads and validates the result, and on any error writes the
//   snapshot back so the app is left exactly on the previous settings.

const nodeFs = require('node:fs');
const path = require('node:path');

const FILES = {
  settings: 'settings.json',
  controllerConfig: 'controller-config.json',
  profileLabels: 'profile-labels.json'
};
const BUNDLE_KIND = 'bumboo-agent-controller-settings';
const BUNDLE_VERSION = 1;
const MAX_BACKUPS = 30;
const BACKUP_ID = /^[0-9A-Za-z_-]{1,120}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function writeJsonAtomic(file, value, fs = nodeFs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const data = JSON.stringify(value, null, 2);
  try {
    fs.writeFileSync(tmp, data);
    // Keep the last good version as .bak before replacing it.
    if (fs.existsSync(file)) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.copyFileSync(file, `${file}.bak`);
      } catch { /* current file is corrupt: keep the older .bak */ }
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* not created */ }
    throw error;
  }
}

// Returns { value, source } where source is 'file' | 'backup' | 'default'.
function readJsonWithFallback(file, fallback, fs = nodeFs) {
  for (const [candidate, source] of [[file, 'file'], [`${file}.bak`, 'backup']]) {
    try {
      return { value: JSON.parse(fs.readFileSync(candidate, 'utf8')), source };
    } catch { /* try next */ }
  }
  return { value: fallback, source: 'default' };
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function createSettingsStore(deps) {
  const {
    dir, // userData
    validators = {}, // { settings(v) => normalized | throws, ... }
    fs = nodeFs,
    now = () => new Date()
  } = deps;
  const backupDir = path.join(dir, 'settings-backups');

  function fileFor(key) {
    if (!FILES[key]) throw new Error(`unknown settings file: ${key}`);
    return path.join(dir, FILES[key]);
  }

  function read(key, fallback) {
    return readJsonWithFallback(fileFor(key), fallback, fs);
  }

  function write(key, value) {
    writeJsonAtomic(fileFor(key), value, fs);
    return value;
  }

  // Raw current contents (null when the file does not exist / is unreadable).
  function snapshot() {
    const out = {};
    for (const key of Object.keys(FILES)) {
      const { value, source } = read(key, null);
      out[key] = source === 'default' ? null : value;
    }
    return out;
  }

  function validateBundle(bundle) {
    if (!isPlainObject(bundle) || bundle.kind !== BUNDLE_KIND) throw new Error('not a controller settings backup');
    if (bundle.version !== BUNDLE_VERSION) throw new Error(`unsupported backup version: ${bundle.version}`);
    if (!isPlainObject(bundle.files)) throw new Error('backup has no files');
    const files = {};
    for (const key of Object.keys(FILES)) {
      const value = bundle.files[key];
      if (value === undefined || value === null) { files[key] = null; continue; }
      if (!isPlainObject(value)) throw new Error(`${key}: expected an object`);
      files[key] = validators[key] ? validators[key](value) : value;
    }
    return files;
  }

  function writeFiles(files) {
    for (const key of Object.keys(FILES)) {
      const file = fileFor(key);
      if (files[key] === null || files[key] === undefined) {
        // "Did not exist" in the bundle: remove the file and its .bak so the
        // reader falls back to defaults (the pre-restore bundle keeps both).
        for (const f of [file, `${file}.bak`]) if (fs.existsSync(f)) fs.unlinkSync(f);
      } else {
        writeJsonAtomic(file, files[key], fs);
      }
    }
  }

  function prune() {
    const items = listBackups();
    for (const item of items.slice(MAX_BACKUPS)) {
      try { fs.unlinkSync(path.join(backupDir, `${item.id}.json`)); } catch { /* ignore */ }
    }
  }

  function createBackup(reason = 'manual') {
    const at = now();
    const safeReason = String(reason).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 40) || 'manual';
    let id = `${stamp(at)}-${safeReason}`;
    for (let n = 2; fs.existsSync(path.join(backupDir, `${id}.json`)); n += 1) id = `${stamp(at)}-${safeReason}-${n}`;
    const bundle = { kind: BUNDLE_KIND, version: BUNDLE_VERSION, createdAt: at.toISOString(), reason: safeReason, files: snapshot() };
    writeJsonAtomic(path.join(backupDir, `${id}.json`), bundle, fs);
    prune();
    return { ok: true, id, createdAt: bundle.createdAt, reason: safeReason };
  }

  function listBackups() {
    let names = [];
    try { names = fs.readdirSync(backupDir).filter((n) => n.endsWith('.json')); } catch { return []; }
    const items = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!BACKUP_ID.test(id)) continue;
      try {
        const bundle = JSON.parse(fs.readFileSync(path.join(backupDir, name), 'utf8'));
        let valid = true;
        try { validateBundle(bundle); } catch { valid = false; }
        items.push({ id, createdAt: bundle.createdAt || '', reason: bundle.reason || '', valid });
      } catch {
        items.push({ id, createdAt: '', reason: '', valid: false });
      }
    }
    return items.sort((a, b) => (b.createdAt || b.id).localeCompare(a.createdAt || a.id));
  }

  function restoreBackup(id) {
    if (!BACKUP_ID.test(String(id || ''))) return { ok: false, error: 'invalid backup id' };
    let files;
    try {
      files = validateBundle(JSON.parse(fs.readFileSync(path.join(backupDir, `${id}.json`), 'utf8')));
    } catch (error) {
      return { ok: false, error: `backup rejected: ${error.message}`, rolledBack: false };
    }
    const previous = snapshot();
    let preRestore = null;
    try { preRestore = createBackup('pre-restore'); } catch { /* the in-memory snapshot still protects us */ }
    try {
      writeFiles(files);
      // Verify what is on disk now matches what we meant to write.
      const after = snapshot();
      for (const key of Object.keys(FILES)) {
        if (JSON.stringify(after[key]) !== JSON.stringify(files[key])) throw new Error(`${key}: verification failed`);
      }
      return { ok: true, id, preRestoreId: preRestore && preRestore.id };
    } catch (error) {
      try {
        writeFiles(previous);
        return { ok: false, error: `restore failed: ${error.message}`, rolledBack: true, preRestoreId: preRestore && preRestore.id };
      } catch (rollbackError) {
        return {
          ok: false,
          error: `restore failed: ${error.message}; rollback failed: ${rollbackError.message}`,
          rolledBack: false,
          preRestoreId: preRestore && preRestore.id
        };
      }
    }
  }

  // Run `mutate()` (which writes settings files); on throw put the previous
  // contents back and rethrow.
  function transaction(mutate) {
    const previous = snapshot();
    try {
      return mutate();
    } catch (error) {
      try { writeFiles(previous); } catch { /* best effort; original error wins */ }
      throw error;
    }
  }

  return { FILES, read, write, snapshot, createBackup, listBackups, restoreBackup, transaction, backupDir };
}

module.exports = { createSettingsStore, writeJsonAtomic, readJsonWithFallback, FILES, BUNDLE_KIND, BUNDLE_VERSION };
