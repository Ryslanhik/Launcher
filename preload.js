'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  getState: () => invoke('app:getState'),
  saveSettings: patch => invoke('settings:save', patch),

  addAccount: data => invoke('accounts:add', data),
  elyLogin: data => invoke('accounts:elyLogin', data),
  refreshEly: id => invoke('accounts:refreshEly', id),
  removeAccount: id => invoke('accounts:remove', id),
  selectAccount: id => invoke('accounts:select', id),

  createInstance: data => invoke('instances:create', data),
  updateInstance: data => invoke('instances:update', data),
  deleteInstance: id => invoke('instances:delete', id),

  getGameVersions: () => invoke('versions:gameVersions'),
  getLoaderVersions: (loader, gameVersion) => invoke('versions:loaders', loader, gameVersion),

  installInstance: id => invoke('instance:install', id),
  launch: (instanceId, accountId) => invoke('instance:launch', instanceId, accountId),
  kill: () => invoke('instance:kill'),

  getCatalogCategories: () => invoke('catalog:categories'),
  getModProject: params => invoke('mods:project', params),
  searchMods: params => invoke('mods:search', params),
  getModVersions: params => invoke('mods:versions', params),
  installMod: params => invoke('mods:install', params),
  installedMods: id => invoke('mods:installed', id),
  removeMod: (id, name) => invoke('mods:remove', id, name),
  toggleMod: (id, name) => invoke('mods:toggle', id, name),

  openFolder: p => invoke('fs:open', p),
  pickFolder: () => invoke('fs:pickFolder'),
  pickJava: () => invoke('fs:pickJava'),
  pickImage: () => invoke('fs:pickImage'),
  relaunch: () => invoke('app:relaunch'),

  windowMin: () => ipcRenderer.send('window:min'),
  windowMax: () => ipcRenderer.send('window:max'),
  windowClose: () => ipcRenderer.send('window:close'),

  on: (channel, cb) => {
    const allowed = ['log', 'status', 'progress'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
