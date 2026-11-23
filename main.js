'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const Store = require('./core/store');
const api = require('./core/api');
const { Launcher } = require('./core/launcher');

let win = null;
let settings, accountsStore, instancesStore;

const uid = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

const DEFAULT_SETTINGS = {
  gameDir: '',
  javaPath: '',
  memory: 2048,
  theme: 'midnight',
  accent: '#6c8cff',
  background: '',
  density: 'comfortable',
  fontSize: 14,
  radius: 12,
  curseforgeKey: '',
  language: 'ru',
  showConsole: true,
  closeOnLaunch: false,
  autoInstall: true
};

function initStores() {
  const dir = app.getPath('userData');
  settings = new Store(path.join(dir, 'settings.json'), DEFAULT_SETTINGS);
  accountsStore = new Store(path.join(dir, 'accounts.json'), { list: [] });
  instancesStore = new Store(path.join(dir, 'instances.json'), { list: [] });

  if (!settings.get('gameDir')) {
    settings.set('gameDir', path.join(dir, 'game'));
  }
  fs.ensureDirSync(settings.get('gameDir'));
}

function currentGameDir() { return settings.get('gameDir'); }

function makeLauncher(instance) {
  return new Launcher({
    gameDir: currentGameDir(),
    javaPath: resolveJava(instance),
    onLog: line => send('log', String(line)),
    onProgress: p => send('progress', p)
  });
}

function send(channel, payload) {
  if (win && win.webContents) win.webContents.send(channel, payload);
}

function detectJava() {
  const candidates = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files (x86)\\Java',
    'C:\\Program Files (x86)\\Common Files\\Oracle\\Java\\javapath'
  ];
  for (const root of candidates) {
    try {
      if (!fs.existsSync(root)) continue;
      if (fs.existsSync(path.join(root, 'java.exe'))) return path.join(root, 'java.exe');
      const entries = fs.readdirSync(root);
      for (const e of entries) {
        const p1 = path.join(root, e, 'bin', 'java.exe');
        if (fs.existsSync(p1)) return p1;
      }
    } catch (_) {}
  }
  return 'java';
}

function resolveJava(instance) {
  if (instance && instance.javaPath && fs.existsSync(instance.javaPath)) return instance.javaPath;
  const configured = settings.get('javaPath');
  if (configured && configured !== 'auto' && fs.existsSync(configured)) return configured;
  return detectJava();
}

async function ensureAuthlibInjector() {
  const dir = path.join(currentGameDir(), '.nova');
  const file = path.join(dir, 'authlib-injector.jar');
  if (await fs.pathExists(file) && (await fs.stat(file)).size > 10000) return file;
  const info = await api.getAuthlibInjector();
  const res = await fetch(info.url);
  if (!res.ok) throw new Error(`Не удалось скачать authlib-injector: HTTP ${res.status}`);
  await fs.ensureDir(dir);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function instanceById(id) {
  return (instancesStore.get('list', []) || []).find(i => i.id === id);
}

function accountById(id) {
  return (accountsStore.get('list', []) || []).find(a => a.id === id);
}

function computeVersionId(instance) {
  switch (instance.loader) {
    case 'fabric': return `fabric-loader-${instance.loaderVersion}-${instance.gameVersion}`;
    case 'quilt': return `quilt-loader-${instance.loaderVersion}-${instance.gameVersion}`;
    case 'forge': return `${instance.gameVersion}-forge-${instance.loaderVersion}`;
    case 'neoforge': return `${instance.gameVersion}-neoforge-${instance.loaderVersion}`;
    default: return instance.gameVersion;
  }
}

async function findInstalledLoaderVersion(kind, gameVersion) {
  const launcher = new Launcher({ gameDir: currentGameDir(), javaPath: resolveJava() });
  const list = await launcher.installedVersions();
  const needle = kind === 'forge' ? 'forge' : 'neoforge';
  const found = list.filter(v => (v.id || '').toLowerCase().includes(needle) && (v.id || '').includes(gameVersion));
  if (!found.length) throw new Error('Не удалось определить установленную версию загрузчика. Попробуйте selects другую версию.');
  return found[found.length - 1].id;
}

/* ------------------------------- IPC ------------------------------- */

function registerIpc() {
  ipcMain.on('window:min', () => { if (win) win.minimize(); });
  ipcMain.on('window:max', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on('window:close', () => { if (win) win.close(); });

  ipcMain.handle('app:getState', () => ({
    settings: { ...settings.all(), detectedJava: detectJava() },
    accounts: accountsStore.get('list', []),
    instances: instancesStore.get('list', []),
    userData: app.getPath('userData'),
    detectedJava: detectJava(),
    isPackaged: app.isPackaged
  }));

  ipcMain.handle('settings:save', (e, patch) => {
    settings.setBulk(patch || {});
    if (patch.gameDir) fs.ensureDirSync(patch.gameDir);
    return settings.all();
  });

  ipcMain.handle('accounts:add', (e, data) => {
    const list = accountsStore.get('list', []);
    const acc = {
      id: uid(),
      name: data.name || 'Player',
      type: 'offline',
      uuid: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      token: crypto.randomBytes(16).toString('hex'),
      userType: 'mojang',
      createdAt: Date.now()
    };
    list.push(acc);
    accountsStore.set('list', list);
    return acc;
  });

  ipcMain.handle('accounts:elyLogin', async (e, data) => {
    let clientToken = settings.get('elyClientToken');
    if (!clientToken) {
      clientToken = uid();
      settings.set('elyClientToken', clientToken);
    }
    const auth = await api.elyAuthenticate(data.username, data.password, clientToken, data.totp);
    const profile = auth.selectedProfile || {};
    const acc = {
      id: uid(),
      name: profile.name || data.username,
      type: 'ely',
      uuid: String(profile.id || '').replace(/-/g, ''),
      token: auth.accessToken,
      clientToken: auth.clientToken || clientToken,
      userType: 'mojang',
      createdAt: Date.now()
    };
    const list = accountsStore.get('list', []);
    list.push(acc);
    accountsStore.set('list', list);
    return acc;
  });

  ipcMain.handle('accounts:refreshEly', async (e, id) => {
    const list = accountsStore.get('list', []);
    const acc = list.find(a => a.id === id);
    if (!acc || acc.type !== 'ely') return null;
    const auth = await api.elyRefresh(acc.token, acc.clientToken || settings.get('elyClientToken'));
    acc.token = auth.accessToken;
    const profile = auth.selectedProfile || {};
    if (profile.name) acc.name = profile.name;
    if (profile.id) acc.uuid = String(profile.id).replace(/-/g, '');
    accountsStore.set('list', list);
    return acc;
  });

  ipcMain.handle('accounts:remove', (e, id) => {
    accountsStore.set('list', (accountsStore.get('list', []) || []).filter(a => a.id !== id));
    return true;
  });

  ipcMain.handle('accounts:select', (e, id) => {
    settings.set('activeAccount', id);
    return true;
  });

  ipcMain.handle('instances:create', (e, data) => {
    const list = instancesStore.get('list', []);
    const id = 'inst_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const inst = {
      id,
      name: data.name || 'Новый профиль',
      gameVersion: data.gameVersion,
      loader: data.loader || 'vanilla',
      loaderVersion: data.loaderVersion || '',
      versionId: '',
      gameDir: path.join(currentGameDir(), 'instances', id),
      icon: data.icon || '🧊',
      memory: data.memory || settings.get('memory', 2048),
      javaPath: data.javaPath || '',
      jvmArgs: data.jvmArgs || '',
      installed: false,
      createdAt: Date.now()
    };
    inst.versionId = computeVersionId(inst);
    list.push(inst);
    instancesStore.set('list', list);
    fs.ensureDirSync(path.join(inst.gameDir, 'mods'));
    return inst;
  });

  ipcMain.handle('instances:update', (e, data) => {
    const list = instancesStore.get('list', []);
    const idx = list.findIndex(i => i.id === data.id);
    if (idx < 0) return null;
    const updated = { ...list[idx], ...data };
    updated.versionId = computeVersionId(updated);
    list[idx] = updated;
    instancesStore.set('list', list);
    return updated;
  });

  ipcMain.handle('instances:delete', (e, id) => {
    const list = (instancesStore.get('list', []) || []).filter(i => i.id !== id);
    instancesStore.set('list', list);
    return true;
  });

  ipcMain.handle('versions:gameVersions', async () => {
    const manifest = await api.getVersionManifest();
    return (manifest.versions || [])
      .filter(v => v.type === 'release')
      .slice(0, 60)
      .map(v => ({ id: v.id, type: v.type, released: v.releaseTime }));
  });

  ipcMain.handle('versions:loaders', async (e, loader, gameVersion) => {
    try {
      switch (loader) {
        case 'fabric': return await api.getFabricLoaders(gameVersion);
        case 'quilt': return await api.getQuiltLoaders(gameVersion);
        case 'forge': return await api.getForgeVersions(gameVersion);
        case 'neoforge': return await api.getNeoForgeVersions(gameVersion);
        default: return [];
      }
    } catch (err) {
      send('log', '[WARN] Не удалось получить список загрузчиков: ' + err.message);
      return [];
    }
  });

  ipcMain.handle('instance:install', async (e, instanceId) => {
    const inst = instanceById(instanceId);
    if (!inst) throw new Error('Профиль не найден');
    const launcher = makeLauncher(inst);
    const step = label => send('status', label);

    try {
      switch (inst.loader) {
        case 'fabric':
          await launcher.ensureFabric(inst.gameVersion, inst.loaderVersion, step);
          break;
        case 'quilt':
          await launcher.ensureQuilt(inst.gameVersion, inst.loaderVersion, step);
          break;
        case 'forge':
        case 'neoforge': {
          await launcher.ensureInstallerBased(
            inst.loader, inst.gameVersion, inst.loaderVersion, resolveJava(inst), step
          );
          const detected = await findInstalledLoaderVersion(inst.loader, inst.gameVersion);
          // Установщик ставит только загрузчик — дотягиваем ванильные ассеты и библиотеки
          const installedJson = await launcher._readJson(detected) || await launcher._downloadVersionJson(detected);
          await launcher.ensureVersion(detected, installedJson, step);
          inst.versionId = detected;
          break;
        }
        default:
          await launcher.ensureVanilla(inst.gameVersion, step);
      }
      inst.installed = true;
      const list = instancesStore.get('list', []);
      const i = list.findIndex(x => x.id === inst.id);
      if (i >= 0) list[i] = inst;
      instancesStore.set('list', list);
      send('status', 'Готово! Можно запускать.');
      return inst;
    } catch (err) {
      send('status', 'Ошибка: ' + err.message);
      throw err;
    }
  });

  ipcMain.handle('instance:launch', async (e, instanceId, accountId) => {
    const inst = instanceById(instanceId);
    const acc = accountById(accountId) || (accountsStore.get('list', []) || [])[0];
    if (!inst) throw new Error('Профиль не найден');
    if (!acc) throw new Error('Создайте офлайн-аккаунт на вкладке «Аккаунты»');
    if (acc.type === 'ely') {
      try {
        const fresh = await api.elyRefresh(acc.token, acc.clientToken || settings.get('elyClientToken'));
        acc.token = fresh.accessToken;
        const list = accountsStore.get('list', []);
        const idx = list.findIndex(a => a.id === acc.id);
        if (idx >= 0) { list[idx] = acc; accountsStore.set('list', list); }
        send('log', '[ELY] Токен обновлён');
      } catch (err) {
        send('log', '[ELY] Не удалось обновить токен: ' + err.message + ' (пробуем текущий)');
      }
      try {
        acc.authlibPath = await ensureAuthlibInjector();
        send('log', '[ELY] authlib-injector подключён');
      } catch (err) {
        send('log', '[ELY] Ошибка authlib-injector: ' + err.message);
      }
    }
    send('status', 'Запуск Minecraft...');
    const launcher = makeLauncher(inst);
    const result = await launcher.launch(inst, acc, line => send('log', String(line)));
    send('status', 'Minecraft закрыт');
    return result;
  });

  ipcMain.handle('instance:kill', () => {
    const l = new Launcher({ gameDir: currentGameDir(), javaPath: detectJava(), onLog: x => send('log', x) });
    return l.kill();
  });

  ipcMain.handle('catalog:categories', async () => {
    const result = { modrinth: [], curseforge: [] };
    try { result.modrinth = await api.modrinthCategories(); } catch (_) {}
    try { result.curseforge = await api.curseforgeCategories(settings.get('curseforgeKey')); } catch (_) {}
    return result;
  });

  ipcMain.handle('mods:search', async (e, params) => {
    const { source, query, loader, gameVersion, page, index, category, categoryId } = params || {};
    const sortField = index === 'updated' ? 3 : index === 'name' ? 4 : 2;

    if (source === 'curseforge') {
      return api.curseforgeSearch(query, settings.get('curseforgeKey'), {
        loader, gameVersion, page: page || 0, limit: 24, categoryId, sortField
      });
    }
    if (source === 'modrinth') {
      return api.modrinthSearch(query, {
        loader, category, gameVersion, limit: 24,
        offset: (page || 0) * 24, index: index || 'relevance'
      });
    }

    // «Все источники» — параллельный запрос; без ключа CurseForge просто пропускаем
    const [mr, cf] = await Promise.allSettled([
      api.modrinthSearch(query, {
        loader, category, gameVersion, limit: 24,
        offset: (page || 0) * 24, index: index || 'relevance'
      }),
      api.curseforgeSearch(query, settings.get('curseforgeKey'), {
        loader, gameVersion, page: page || 0, limit: 24, categoryId, sortField
      })
    ]);
    const items = [];
    if (mr.status === 'fulfilled') items.push(...mr.value);
    if (cf.status === 'fulfilled') items.push(...cf.value);
    return items.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  });

  ipcMain.handle('mods:project', async (e, params) => {
    if (params.source === 'curseforge') return null;
    return api.modrinthProject(params.projectId);
  });

  ipcMain.handle('mods:versions', async (e, params) => {
    const { source, projectId, gameVersion } = params || {};
    const loader = params.loader && params.loader !== 'vanilla' ? params.loader : null;
    if (source === 'curseforge') {
      const files = await api.curseforgeFiles(projectId, settings.get('curseforgeKey'));
      return files
        .filter(f => !gameVersion || f.gameVersions.includes(gameVersion))
        .slice(0, 30)
        .map(f => ({ id: f.id, name: f.displayName || f.name, fileName: f.fileName, date: f.date }));
    }
    const versions = await api.modrinthVersions(projectId, loader, gameVersion);
    return versions.map(v => ({
      id: v.id,
      name: `${v.name} · ${v.versionNumber}`,
      fileName: v.primaryFile && v.primaryFile.filename,
      date: v.date
    }));
  });

  ipcMain.handle('mods:install', async (e, params) => {
    const { instanceId, source, projectId, fileId, gameVersion, url, fileName } = params || {};
    const loader = params.loader && params.loader !== 'vanilla' ? params.loader : null;
    const inst = instanceById(instanceId);
    if (!inst) throw new Error('Профиль не найден');
    const modsDir = path.join(inst.gameDir, 'mods');
    await fs.ensureDir(modsDir);

    let downloadUrl = url;
    let name = fileName;
    if (!downloadUrl) {
      if (source === 'modrinth') {
        const f = await api.modrinthLatestFile(projectId, loader, gameVersion);
        if (!f) throw new Error('Совместимая версия мода не найдена');
        downloadUrl = f.url;
        name = f.name;
      } else {
        const key = settings.get('curseforgeKey');
        const files = await api.curseforgeFiles(projectId, key);
        const compatible = files.filter(f => !gameVersion || f.gameVersions.includes(gameVersion));
        const chosen = (fileId && files.find(f => f.id === fileId)) || compatible[0] || files[0];
        if (!chosen) throw new Error('Совместимая версия мода не найдена');
        downloadUrl = await api.curseforgeDownloadUrl(projectId, chosen.id, key);
        name = fileName || chosen.fileName;
      }
    }
    if (!downloadUrl) throw new Error('Не удалось получить ссылку на скачивание');
    const dest = path.join(modsDir, name || path.basename(new URL(downloadUrl).pathname));
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Скачивание мода не удалось: HTTP ${res.status}`);
    await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    send('status', `Мод установлен: ${path.basename(dest)}`);
    return path.basename(dest);
  });

  ipcMain.handle('mods:installed', async (e, instanceId) => {
    const inst = instanceById(instanceId);
    if (!inst) return [];
    const dir = path.join(inst.gameDir, 'mods');
    await fs.ensureDir(dir);
    const files = await fs.readdir(dir);
    return files.filter(f => /\.(jar|zip|disabled)$/i.test(f)).map(f => ({ name: f, path: path.join(dir, f) }));
  });

  ipcMain.handle('mods:remove', async (e, instanceId, name) => {
    const inst = instanceById(instanceId);
    if (!inst) return false;
    const p = path.join(inst.gameDir, 'mods', path.basename(name));
    if (await fs.pathExists(p)) { await fs.remove(p); return true; }
    return false;
  });

  ipcMain.handle('mods:toggle', async (e, instanceId, name) => {
    const inst = instanceById(instanceId);
    if (!inst) return null;
    const dir = path.join(inst.gameDir, 'mods');
    const base = path.basename(name);
    if (base.endsWith('.disabled')) {
      const next = base.replace(/\.disabled$/, '');
      await fs.move(path.join(dir, base), path.join(dir, next), { overwrite: true });
      return next;
    }
    const next = base + '.disabled';
    await fs.move(path.join(dir, base), path.join(dir, next), { overwrite: true });
    return next;
  });

  ipcMain.handle('fs:open', (e, target) => shell.openPath(target));
  ipcMain.handle('fs:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('fs:pickJava', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Java', extensions: ['exe', ''] }]
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('fs:pickImage', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (r.canceled) return null;
    const destDir = path.join(app.getPath('userData'), 'backgrounds');
    await fs.ensureDir(destDir);
    const dest = path.join(destDir, 'bg' + path.extname(r.filePaths[0]));
    await fs.copy(r.filePaths[0], dest, { overwrite: true });
    return dest;
  });

  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });
}

/* --------------------------- Окно приложения --------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    transparent: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.setMenuBarVisibility(false);

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  initStores();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
