const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadControllerConfig, saveControllerConfig, publicConfig } = require('../electron/runtime-config.cjs');

test('save/load round trip normalizes paths and derives labUnc', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
  saveControllerConfig(dir, { distro: 'Ubuntu-22.04', hermesHome: '/home/test/.hermes/', labRoot: '/home/test/lab' });
  const cfg = loadControllerConfig(dir);
  assert.equal(cfg.hermesHome, '/home/test/.hermes');
  assert.equal(cfg.labUnc, '\\\\wsl.localhost\\Ubuntu-22.04\\home\\test\\lab');
  assert.equal(publicConfig(cfg).configured, true);
});

test('a corrupt controller-config.json falls back to the previous good copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
  saveControllerConfig(dir, { distro: 'Debian', hermesHome: '/home/test/.hermes' });
  saveControllerConfig(dir, { distro: 'Ubuntu' });
  fs.writeFileSync(path.join(dir, 'controller-config.json'), '{"distro": "Ubu');
  assert.equal(loadControllerConfig(dir).distro, 'Debian');
});
