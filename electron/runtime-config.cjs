const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic, readJsonWithFallback } = require('./settings-store.cjs');

const DEFAULTS = {
  distro: process.env.HERMES_CONTROLLER_DISTRO || 'Ubuntu',
  dashboardUrl: process.env.HERMES_CONTROLLER_DASHBOARD_URL || 'http://127.0.0.1:9119',
  dashboardTaskName: process.env.HERMES_CONTROLLER_DASHBOARD_TASK || 'Hermes Dashboard 9119',
  labRoot: process.env.HERMES_LAB_ROOT || '',
  hermesHome: process.env.HERMES_HOME || '',
  hermesCommand: process.env.HERMES_COMMAND || 'hermes',
  pollMs: Number(process.env.HERMES_CONTROLLER_POLL_MS || 15000) || 15000
};

function configPath(userData) {
  return path.join(userData, 'controller-config.json');
}

function wslPathToUnc(distro, linuxPath) {
  if (!distro || !linuxPath || !linuxPath.startsWith('/')) return '';
  return `\\\\wsl.localhost\\${distro}${linuxPath.replaceAll('/', '\\')}`;
}

function normalizeConfig(input = {}) {
  const cfg = { ...DEFAULTS, ...(input || {}) };
  cfg.distro = String(cfg.distro || DEFAULTS.distro).trim();
  cfg.dashboardUrl = String(cfg.dashboardUrl || DEFAULTS.dashboardUrl).trim();
  cfg.dashboardTaskName = String(cfg.dashboardTaskName || DEFAULTS.dashboardTaskName).trim();
  cfg.labRoot = String(cfg.labRoot || '').trim().replace(/\/$/, '');
  cfg.hermesHome = String(cfg.hermesHome || '').trim().replace(/\/$/, '');
  cfg.hermesCommand = String(cfg.hermesCommand || 'hermes').trim() || 'hermes';
  cfg.pollMs = Math.max(3000, Number(cfg.pollMs) || DEFAULTS.pollMs);
  cfg.labUnc = wslPathToUnc(cfg.distro, cfg.labRoot);
  return cfg;
}

function publicConfig(cfg) {
  const normalized = normalizeConfig(cfg);
  return {
    distro: normalized.distro,
    dashboardUrl: normalized.dashboardUrl,
    dashboardTaskName: normalized.dashboardTaskName,
    labRoot: normalized.labRoot,
    hermesHome: normalized.hermesHome,
    hermesCommand: normalized.hermesCommand,
    pollMs: normalized.pollMs,
    labUnc: normalized.labUnc,
    configured: Boolean(normalized.distro && normalized.labRoot && normalized.hermesHome && normalized.hermesCommand)
  };
}

function loadControllerConfig(userData) {
  // A corrupt file falls back to the last good copy (.bak), then defaults.
  const { value } = readJsonWithFallback(configPath(userData), {});
  return normalizeConfig(value && typeof value === 'object' ? value : {});
}

function saveControllerConfig(userData, patch, fsImpl = fs) {
  const file = configPath(userData);
  const current = loadControllerConfig(userData);
  const next = normalizeConfig({ ...current, ...(patch || {}) });
  const toSave = {
    distro: next.distro,
    dashboardUrl: next.dashboardUrl,
    dashboardTaskName: next.dashboardTaskName,
    labRoot: next.labRoot,
    hermesHome: next.hermesHome,
    hermesCommand: next.hermesCommand,
    pollMs: next.pollMs
  };
  writeJsonAtomic(file, toSave, fsImpl);
  return next;
}

module.exports = {
  DEFAULTS,
  configPath,
  loadControllerConfig,
  saveControllerConfig,
  normalizeConfig,
  publicConfig,
  wslPathToUnc
};
