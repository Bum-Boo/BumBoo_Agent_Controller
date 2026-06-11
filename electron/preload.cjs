const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hermes', {
  // Status / lifecycle
  getStatus: () => ipcRenderer.invoke('hermes:getStatus'),
  start: () => ipcRenderer.invoke('hermes:start'),
  stop: () => ipcRenderer.invoke('hermes:stop'),
  shutdownWsl: () => ipcRenderer.invoke('hermes:shutdownWsl'),
  openDashboard: () => ipcRenderer.invoke('hermes:openDashboard'),
  openLabFolder: () => ipcRenderer.invoke('hermes:openLabFolder'),

  // Settings
  getSettings: () => ipcRenderer.invoke('hermes:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('hermes:updateSettings', patch),
  getControllerConfig: () => ipcRenderer.invoke('hermes:getControllerConfig'),
  detectControllerEnvironment: () => ipcRenderer.invoke('hermes:detectControllerEnvironment'),
  testControllerConfig: (patch) => ipcRenderer.invoke('hermes:testControllerConfig', patch),
  updateControllerConfig: (patch) => ipcRenderer.invoke('hermes:updateControllerConfig', patch),

  // Power / mode
  getMode: () => ipcRenderer.invoke('hermes:getMode'),
  enterServerMode: () => ipcRenderer.invoke('hermes:enterServerMode'),
  exitServerMode: () => ipcRenderer.invoke('hermes:exitServerMode'),
  getModeHistory: () => ipcRenderer.invoke('hermes:getModeHistory'),

  // Profiles (with per-profile gateway control)
  getProfiles: () => ipcRenderer.invoke('hermes:getProfiles'),
  getModelOptions: () => ipcRenderer.invoke('hermes:getModelOptions'),
  setProfileModelSettings: (name, patch) => ipcRenderer.invoke('hermes:setProfileModelSettings', name, patch),
  getProfileOpsState: () => ipcRenderer.invoke('hermes:getProfileOpsState'),
  getProfileBackups: (name) => ipcRenderer.invoke('hermes:getProfileBackups', name),
  restoreProfileBackup: (name, backupId) => ipcRenderer.invoke('hermes:restoreProfileBackup', name, backupId),
  getProfileLogSummary: (name) => ipcRenderer.invoke('hermes:getProfileLogSummary', name),
  useProfile: (name) => ipcRenderer.invoke('hermes:useProfile', name),
  gatewayStart: (name) => ipcRenderer.invoke('hermes:gatewayStart', name),
  gatewayStop: (name) => ipcRenderer.invoke('hermes:gatewayStop', name),

  // Diagnostics
  getDiagnostics: () => ipcRenderer.invoke('hermes:getDiagnostics'),
  getRequestsElevated: () => ipcRenderer.invoke('hermes:getRequestsElevated'),

  // Profile labels (user-assigned display names)
  getProfileLabels: () => ipcRenderer.invoke('hermes:getProfileLabels'),
  setProfileLabel: (name, label, desc) => ipcRenderer.invoke('hermes:setProfileLabel', name, label, desc),

  // WSL memory allocation (.wslconfig)
  getWslMemory: () => ipcRenderer.invoke('hermes:getWslMemory'),
  setWslMemory: (gb, applyNow) => ipcRenderer.invoke('hermes:setWslMemory', gb, applyNow),

  // Gateway log streaming
  logStart: (name) => ipcRenderer.invoke('hermes:logStart', name),
  logStop: () => ipcRenderer.invoke('hermes:logStop'),
  onLogLine: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('hermes:logLine', listener);
    return () => ipcRenderer.removeListener('hermes:logLine', listener);
  },
  onLogEnd: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('hermes:logEnd', listener);
    return () => ipcRenderer.removeListener('hermes:logEnd', listener);
  },

  // Subscriptions
  onStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('hermes:statusChanged', listener);
    return () => ipcRenderer.removeListener('hermes:statusChanged', listener);
  },
  onModeChanged: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('hermes:modeChanged', listener);
    return () => ipcRenderer.removeListener('hermes:modeChanged', listener);
  },
  onSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('hermes:settingsChanged', listener);
    return () => ipcRenderer.removeListener('hermes:settingsChanged', listener);
  },
  onProfilesUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('hermes:profilesUpdated', listener);
    return () => ipcRenderer.removeListener('hermes:profilesUpdated', listener);
  },
  onGatewayEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('hermes:gatewayEvent', listener);
    return () => ipcRenderer.removeListener('hermes:gatewayEvent', listener);
  }
});
