'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  win: {
    minimize: () => invoke('win:minimize'),
    maximize: () => invoke('win:maximize'),
    close: () => invoke('win:close'),
  },
  shell: {
    open: (url) => invoke('shell:open', url),
    openPath: (p) => invoke('shell:openPath', p),
  },
  config: {
    get: () => invoke('config:get'),
    set: (patch) => invoke('config:set', patch),
    paths: () => invoke('paths:get'),
  },
  discord: {
    status: () => invoke('discord:status'),
    apply: () => invoke('discord:apply'),
    select: (inst) => invoke('discord:select', inst),
  },
  update: {
    check: () => invoke('update:check'),
    download: (opts) => invoke('update:download', opts),
    install: () => invoke('update:install'),
    version: () => invoke('app:version'),
  },
  storage: {
    info: () => invoke('storage:info'),
    choose: () => invoke('storage:choose'),
    apply: (opts) => invoke('storage:apply', opts),
  },
  versions: {
    all: () => invoke('versions:all'),
    installed: () => invoke('versions:installed'),
    loaders: (loader, mc) => invoke('loaders:list', loader, mc),
    install: (opts) => invoke('install:version', opts),
  },
  java: {
    list: (force) => invoke('java:list', force),
    install: (opts) => invoke('java:install', opts),
    browse: () => invoke('java:browse'),
  },
  auth: {
    login: (opts) => invoke('auth:login', opts),
    cancel: () => invoke('auth:cancel'),
    offline: (name) => invoke('auth:offline', name),
    select: (uuid) => invoke('auth:select', uuid),
    remove: (uuid) => invoke('auth:remove', uuid),
  },
  instances: {
    list: () => invoke('instances:list'),
    create: (data) => invoke('instances:create', data),
    update: (id, patch) => invoke('instances:update', id, patch),
    remove: (id, withFiles) => invoke('instances:delete', id, withFiles),
    folder: (id) => invoke('instances:folder', id),
  },
  mods: {
    search: (opts) => invoke('mods:search', opts),
    versions: (source, projectId, mc, loader) => invoke('mods:versions', source, projectId, mc, loader),
    info: (source, projectId) => invoke('mods:info', source, projectId),
    install: (opts) => invoke('mods:install', opts),
    installed: (instance, kind) => invoke('mods:installed', instance, kind),
    toggle: (instance, file, kind) => invoke('mods:toggle', instance, file, kind),
    remove: (instance, file, kind) => invoke('mods:remove', instance, file, kind),
    folder: (instance, kind) => invoke('mods:folder', instance, kind),
    checkApi: (instanceId) => invoke('mods:checkApi', instanceId),
    installApi: (opts) => invoke('mods:installApi', opts),
  },
  skins: {
    list: () => invoke('skins:list'),
    add: () => invoke('skins:add'),
    remove: (file) => invoke('skins:remove', file),
    upload: (opts) => invoke('skins:upload', opts),
    reset: () => invoke('skins:reset'),
    profile: () => invoke('skins:profile'),
    cape: (capeId) => invoke('skins:cape', capeId),
    applyLocal: (opts) => invoke('skins:applyLocal', opts),
    installMod: (opts) => invoke('skins:installMod', opts),
  },
  ai: {
    available: () => invoke('ai:available'),
    explain: () => invoke('ai:explain'),
    chat: (opts) => invoke('ai:chat', opts),
    openAgent: () => invoke('ai:openAgent'),
  },
  game: {
    launch: (opts) => invoke('game:launch', opts),
    kill: () => invoke('game:kill'),
    running: () => invoke('game:running'),
  },
  on: (channel, cb) => {
    const allowed = ['progress', 'auth:code', 'game:log', 'game:exit', 'game:crash', 'discord:status'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
