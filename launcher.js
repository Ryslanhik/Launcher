'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const api = require('./api');

const LAUNCHER_NAME = 'NovaLauncher';
const LAUNCHER_VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Вспомогательные функции                                             */
/* ------------------------------------------------------------------ */

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function libraryPathFromName(name) {
  // group:artifact:version[:classifier]
  const parts = name.split(':');
  const group = (parts[0] || '').replace(/\./g, '/');
  const artifact = parts[1] || '';
  const version = parts[2] || '';
  const classifier = parts[3] ? '-' + parts[3] : '';
  return `${group}/${artifact}/${version}/${artifact}-${version}${classifier}.jar`;
}

function ruleAllowed(rules) {
  if (!rules || !rules.length) return true;
  let result = false;
  for (const rule of rules) {
    const os = rule.os;
    let ok = true;
    if (os) {
      if (os.name && os.name !== 'windows') ok = false;
      if (os.arch && !['x64', 'x86_64', 'amd64'].includes(os.arch)) ok = false;
    }
    if (ok) result = rule.action === 'allow';
  }
  return result;
}

function substitute(str, vars) {
  return String(str).replace(/\$\{([^}]+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m
  );
}

function flattenArgs(args, vars) {
  const out = [];
  for (const arg of args || []) {
    if (typeof arg === 'string') {
      out.push(substitute(arg, vars));
      continue;
    }
    if (arg.rules && !ruleAllowed(arg.rules)) continue;
    const values = Array.isArray(arg.value) ? arg.value : [arg.value];
    for (const v of values) {
      if (v == null) continue;
      out.push(substitute(v, vars));
    }
  }
  return out;
}

function mergeVersions(child, parent) {
  if (!parent) return { ...child, _clientVersion: child.downloads && child.downloads.client ? child.id : child.inheritsFrom || child.id };
  const hasOwnArgs = !!(child.arguments && (child.arguments.game || child.arguments.jvm));
  return {
    ...parent,
    ...child,
    id: child.id,
    mainClass: child.mainClass || parent.mainClass,
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    type: child.type || parent.type,
    libraries: [...(parent.libraries || []), ...(child.libraries || [])],
    arguments: hasOwnArgs ? {
      game: [...(parent.arguments && parent.arguments.game || []), ...(child.arguments.game || [])],
      jvm: [...(parent.arguments && parent.arguments.jvm || []), ...(child.arguments.jvm || [])]
    } : (parent.arguments || child.arguments),
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
    downloads: child.downloads || parent.downloads,
    _clientVersion: child.downloads && child.downloads.client
      ? child.id
      : parent._clientVersion || parent.inheritsFrom || parent.id
  };
}

/* ------------------------------------------------------------------ */
/* Лаунчер                                                             */
/* ------------------------------------------------------------------ */

class Launcher {
  constructor(options = {}) {
    this.gameDir = options.gameDir;
    this.javaPath = options.javaPath || 'java';
    this.log = options.onLog || (() => {});
    this.progress = options.onProgress || (() => {});
    this._cancelled = false;
  }

  cancel() { this._cancelled = true; }
  resetCancel() { this._cancelled = false; }

  get versionsDir() { return path.join(this.gameDir, 'versions'); }
  get librariesDir() { return path.join(this.gameDir, 'libraries'); }
  get assetsDir() { return path.join(this.gameDir, 'assets'); }

  versionDir(id) { return path.join(this.versionsDir, id); }
  versionJsonPath(id) { return path.join(this.versionDir(id), `${id}.json`); }
  versionJarPath(id) { return path.join(this.versionDir(id), `${id}.jar`); }

  async _download(url, dest, expectedSha1, label) {
    if (this._cancelled) throw new Error('Отменено');
    if (expectedSha1 && await fs.pathExists(dest)) {
      try {
        const buf = await fs.readFile(dest);
        if (sha1(buf) === expectedSha1) return false;
      } catch (_) {}
    } else if (!expectedSha1 && await fs.pathExists(dest)) {
      return false;
    }
    await fs.ensureDir(path.dirname(dest));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Не удалось скачать ${label || url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (expectedSha1 && sha1(buf) !== expectedSha1) {
      throw new Error(`Контрольная сумма не совпала: ${label || url}`);
    }
    await fs.writeFile(dest, buf);
    return true;
  }

  async _readJson(id) {
    const p = this.versionJsonPath(id);
    if (await fs.pathExists(p)) {
      try { return await fs.readJson(p); } catch (_) {}
    }
    return null;
  }

  async _downloadVersionJson(id) {
    const manifest = await api.getVersionManifest();
    const entry = (manifest.versions || []).find(v => v.id === id);
    if (!entry) throw new Error(`Версия ${id} не найдена в манифесте Mojang`);
    return api.getVersionJson(entry.url);
  }

  async resolveVersion(id, json, cache = new Map()) {
    if (cache.has(id)) return cache.get(id);
    let parent = null;
    if (json && json.inheritsFrom) {
      const pid = json.inheritsFrom;
      let parentJson = await this._readJson(pid);
      if (!parentJson) parentJson = await this._downloadVersionJson(pid);
      parent = await this.resolveVersion(pid, parentJson, cache);
    }
    const merged = mergeVersions(json || {}, parent);
    cache.set(id, merged);
    return merged;
  }

  /**
   * Скачивает всё необходимое для версии (jar, библиотеки, нативы, ассеты).
   */
  async ensureVersion(id, rawJson, onStep) {
    this.resetCancel();
    const step = onStep || (() => {});
    step('Подготовка версии...');
    const merged = await this.resolveVersion(id, rawJson);
    await fs.ensureDir(this.versionDir(id));
    // Сохраняем уже собранную версию, чтобы не мержить родителя при каждом запуске
    const toSave = { ...merged };
    delete toSave.inheritsFrom;
    await fs.writeJson(this.versionJsonPath(id), toSave, { spaces: 2 });

    // 1. JAR клиента
    step('Загрузка Minecraft JAR...');
    let clientVersion = merged._clientVersion || id;
    let clientJson = merged;
    if (!(merged.downloads && merged.downloads.client)) {
      // поднимаемся к родителю, у которого есть client
      let cur = merged;
      while (cur && cur.inheritsFrom && !(cur.downloads && cur.downloads.client)) {
        const pid = cur.inheritsFrom;
        cur = await this.resolveVersion(pid, await this._readJson(pid) || await this._downloadVersionJson(pid));
      }
      clientJson = cur;
      clientVersion = cur.id;
    }
    if (clientJson.downloads && clientJson.downloads.client) {
      const c = clientJson.downloads.client;
      await this._download(c.url, this.versionJarPath(clientVersion), c.sha1, `Minecraft ${clientVersion}`);
    }

    // 2. Библиотеки и нативы
    const libs = (merged.libraries || []).filter(l => ruleAllowed(l.rules));
    let nativeCount = 0;
    for (const lib of libs) {
      if (this._cancelled) throw new Error('Отменено');
      const art = lib.downloads && lib.downloads.artifact;
      if (art && art.url) {
        const dest = path.join(this.librariesDir, art.path || libraryPathFromName(lib.name));
        await this._download(art.url, dest, art.sha1, lib.name || art.path);
      } else if (lib.name && !lib.natives) {
        // старый формат без downloads
        const url = (lib.url || 'https://libraries.minecraft.net/') + libraryPathFromName(lib.name);
        const dest = path.join(this.librariesDir, libraryPathFromName(lib.name));
        await this._download(url, dest, null, lib.name);
      }

      const classifiers = lib.downloads && lib.downloads.classifiers;
      if (classifiers) {
        let classifier = classifiers['natives-windows'] ||
          classifiers[`natives-windows-${process.arch === 'ia32' ? 'x86' : 'x64'}`];
        if (!classifier) {
          const key = Object.keys(classifiers).find(k => k.startsWith('natives-windows'));
          if (key) classifier = classifiers[key];
        }
        if (classifier && classifier.url) {
          const tmp = path.join(this.versionDir(id), '_natives', path.basename(classifier.path || 'native.jar'));
          await this._download(classifier.url, tmp, classifier.sha1, lib.name + ' natives');
          try {
            const zip = new AdmZip(tmp);
            zip.extractAllTo(path.join(this.versionDir(id), 'natives'), true);
            nativeCount++;
          } catch (e) {
            this.log(`[WARN] Не удалось распаковать натив: ${e.message}`);
          } finally {
            await fs.remove(tmp).catch(() => {});
          }
        }
      }
    }
    step(`Библиотеки готовы (нативов: ${nativeCount})`);

    // 3. Ассеты
    if (merged.assetIndex && merged.assetIndex.url) {
      const ai = merged.assetIndex;
      const indexPath = path.join(this.assetsDir, 'indexes', `${ai.id}.json`);
      let index = null;
      if (await fs.pathExists(indexPath)) {
        try { index = await fs.readJson(indexPath); } catch (_) {}
      }
      if (!index) {
        const text = await api.request(ai.url);
        index = text;
        await fs.ensureDir(path.dirname(indexPath));
        await fs.writeJson(indexPath, index);
      }
      const objects = Object.entries((index && index.objects) || {});
      step(`Загрузка ассетов: 0 / ${objects.length}`);
      let done = 0;
      for (const [name, obj] of objects) {
        if (this._cancelled) throw new Error('Отменено');
        const hash = obj.hash;
        const dest = path.join(this.assetsDir, 'objects', hash.slice(0, 2), hash);
        if (!await fs.pathExists(dest) || (await fs.stat(dest)).size !== obj.size) {
          const url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
          await this._download(url, dest, hash, name);
        }
        done++;
        if (done % 50 === 0 || done === objects.length) {
          step(`Загрузка ассетов: ${done} / ${objects.length}`);
          this.progress({ done, total: objects.length, label: 'Ассеты' });
        }
      }
      if (index.map_to_resources) {
        const virtual = path.join(this.assetsDir, 'virtual', ai.id);
        for (const [name, obj] of objects) {
          const hash = obj.hash;
          const src = path.join(this.assetsDir, 'objects', hash.slice(0, 2), hash);
          const dest = path.join(virtual, name);
          if (!await fs.pathExists(dest)) {
            await fs.ensureDir(path.dirname(dest));
            await fs.copy(src, dest).catch(() => {});
          }
        }
      }
    }
    step('Версия установлена');
    return merged;
  }

  async ensureVanilla(gameVersion, onStep) {
    const manifest = await api.getVersionManifest();
    const entry = (manifest.versions || []).find(v => v.id === gameVersion);
    if (!entry) throw new Error(`Версия ${gameVersion} не найдена`);
    const json = await api.getVersionJson(entry.url);
    return this.ensureVersion(gameVersion, json, onStep);
  }

  async ensureFabric(gameVersion, loaderVersion, onStep) {
    const profile = await api.getFabricProfile(gameVersion, loaderVersion);
    return this.ensureVersion(profile.id, profile, onStep);
  }

  async ensureQuilt(gameVersion, loaderVersion, onStep) {
    const profile = await api.getQuiltProfile(gameVersion, loaderVersion);
    return this.ensureVersion(profile.id, profile, onStep);
  }

  /**
   * Forge/NeoForge ставятся официальным установщиком в безGUI-режиме.
   */
  async ensureInstallerBased(kind, gameVersion, loaderVersion, javaPath, onStep) {
    const isForge = kind === 'forge';
    const url = isForge
      ? api.forgeInstallerUrl(gameVersion, loaderVersion)
      : api.neoforgeInstallerUrl(loaderVersion);
    const tmpDir = path.join(this.gameDir, '.installers');
    await fs.ensureDir(tmpDir);
    const file = path.join(tmpDir, path.basename(new URL(url).pathname));

    onStep(`Скачивание установщика ${isForge ? 'Forge' : 'NeoForge'}...`);
    await this._download(url, file, null, 'Установщик');

    onStep('Установка загрузчика (это может занять 1-3 минуты)...');
    return new Promise((resolve, reject) => {
      const args = ['-jar', file, '--installClient', this.gameDir];
      const child = spawn(javaPath, args, { cwd: tmpDir });
      let buffer = '';
      child.stdout.on('data', d => { buffer += d.toString(); this.log('[INSTALL] ' + d.toString().trim()); });
      child.stderr.on('data', d => { buffer += d.toString(); this.log('[INSTALL] ' + d.toString().trim()); });
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) {
          onStep('Установщик завершён');
          resolve();
        } else {
          reject(new Error(`Установщик завершился с кодом ${code}. Попробуйте другую версию загрузчика.\n${buffer.slice(-800)}`));
        }
      });
    });
  }

  /** Список версий, реально установленных в папке games */
  async installedVersions() {
    await fs.ensureDir(this.versionsDir);
    const dirs = await fs.readdir(this.versionsDir, { withFileTypes: true });
    const out = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const jsonPath = this.versionJsonPath(d.name);
      if (await fs.pathExists(jsonPath)) {
        try {
          const j = await fs.readJson(jsonPath);
          out.push({ id: d.name, type: j.type || 'release', inheritsFrom: j.inheritsFrom || null });
        } catch (_) {}
      }
    }
    return out;
  }

  /**
   * Запуск Minecraft.
   */
  async launch(instance, account, onLog) {
    const log = onLog || this.log;
    const versionId = instance.versionId;
    const json = await this._readJson(versionId);
    if (!json) throw new Error(`Версия ${versionId} не установлена. Сначала нажмите «Установить».`);

    const merged = await this.resolveVersion(versionId, json);
    const clientVersion = merged._clientVersion || versionId;
    const jar = this.versionJarPath(clientVersion);
    if (!await fs.pathExists(jar)) {
      throw new Error(`JAR клиента не найден: ${jar}. Переустановите версию.`);
    }

    const libs = (merged.libraries || []).filter(l => ruleAllowed(l.rules));
    const classpathParts = libs.map(l => {
      const art = l.downloads && l.downloads.artifact;
      const rel = art && art.path ? art.path : libraryPathFromName(l.name);
      return path.join(this.librariesDir, rel);
    });
    classpathParts.push(jar);
    const classpath = classpathParts.filter(p => fs.pathExistsSync(p)).join(path.delimiter);

    const natives = path.join(this.versionDir(versionId), 'natives');
    await fs.ensureDir(natives);

    const gameDir = instance.gameDir || this.gameDir;
    await fs.ensureDir(gameDir);
    await fs.ensureDir(path.join(gameDir, 'mods'));

    const uuid = account.uuid || crypto.createHash('md5').update(account.name || 'Player').digest('hex');
    const vars = {
      natives_directory: natives,
      launcher_name: LAUNCHER_NAME,
      launcher_version: LAUNCHER_VERSION,
      classpath,
      auth_player_name: account.name || 'Player',
      auth_uuid: uuid,
      auth_access_token: account.token || '00000000000000000000000000000000',
      auth_xuid: account.xuid || '0000000000000000',
      user_type: account.userType || 'mojang',
      version_name: versionId,
      game_directory: gameDir,
      assets_root: this.assetsDir,
      assets_index_name: (merged.assetIndex && merged.assetIndex.id) || merged.assets || '1.17',
      version_type: merged.type || 'release',
      client_version: clientVersion,
      game_assets: path.join(this.assetsDir, 'virtual', (merged.assetIndex && merged.assetIndex.id) || 'legacy')
    };

    let jvmArgs = ['-Djava.library.path=' + natives, '-Dminecraft.client.jar=' + jar];
    if (merged.arguments && merged.arguments.jvm) {
      jvmArgs = jvmArgs.concat(flattenArgs(merged.arguments.jvm, vars));
    } else {
      jvmArgs.push('-cp', classpath);
    }

    let gameArgs;
    if (merged.arguments && merged.arguments.game) {
      gameArgs = flattenArgs(merged.arguments.game, vars);
    } else if (merged.minecraftArguments) {
      gameArgs = substitute(merged.minecraftArguments, vars).split(/\s+/).filter(Boolean);
    } else {
      gameArgs = [];
    }

    // Гарантируем базовые аргументы для старых версий
    const mustHave = {
      '--username': account.name || 'Player',
      '--version': versionId,
      '--gameDir': gameDir,
      '--assetsDir': this.assetsDir,
      '--assetIndex': vars.assets_index_name,
      '--uuid': uuid,
      '--accessToken': vars.auth_access_token,
      '--userType': vars.user_type,
      '--versionType': vars.version_type
    };
    for (const [flag, value] of Object.entries(mustHave)) {
      const i = gameArgs.indexOf(flag);
      if (i === -1) gameArgs.push(flag, value);
      else if (i + 1 >= gameArgs.length || gameArgs[i + 1].startsWith('--')) gameArgs.splice(i + 1, 0, value);
    }

    if (instance.memory && instance.memory > 0) {
      jvmArgs.unshift(`-Xmx${instance.memory}M`, `-Xms${Math.min(instance.memory, 512)}M`);
    }
    if (instance.jvmArgs) jvmArgs.unshift(...instance.jvmArgs.split(/\s+/).filter(Boolean));

    // Ely.by: подменяем серверы авторизации/сессий через authlib-injector
    if (account.type === 'ely' && account.authlibPath) {
      jvmArgs.unshift(`-javaagent:${account.authlibPath}=ely.by`);
      log('[ELY] Используется authlib-injector: ' + account.authlibPath);
    }

    const java = instance.javaPath || this.javaPath;
    const allArgs = [...jvmArgs, merged.mainClass || 'net.minecraft.client.main.Main', ...gameArgs];

    log(`▶ Запуск: ${java} ${allArgs.slice(0, 6).join(' ')} ...`);
    return new Promise((resolve, reject) => {
      const child = spawn(java, allArgs, { cwd: gameDir, windowsHide: false });
      child.stdout.on('data', d => log(d.toString().replace(/\s+$/, '')));
      child.stderr.on('data', d => log('[ERR] ' + d.toString().replace(/\s+$/, '')));
      child.on('error', err => {
        log(`✖ Ошибка запуска Java: ${err.message}`);
        reject(err);
      });
      child.on('close', code => {
        log(`■ Процесс завершён (код ${code})`);
        resolve({ code });
      });
      global.__novaMinecraftProcess = child;
    });
  }

  kill() {
    const p = global.__novaMinecraftProcess;
    if (p && !p.killed) {
      p.kill();
      global.__novaMinecraftProcess = null;
      return true;
    }
    return false;
  }
}

module.exports = { Launcher, ruleAllowed, libraryPathFromName, sha1 };
