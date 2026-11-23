'use strict';

/**
 * Обёртки над публичными API: Mojang, Fabric, Quilt, Forge, NeoForge,
 * Modrinth и CurseForge.
 */

const ENDPOINTS = {
  mojangManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  fabric: 'https://meta.fabricmc.net/v2/versions',
  quilt: 'https://meta.quiltmc.org/v3/versions',
  forgeMeta: 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json',
  neoforgeMeta: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
  modrinth: 'https://api.modrinth.com/v2',
  curseforge: 'https://api.curseforge.com/v1'
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'NovaLauncher/1.0',
        'Accept': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch (_) {}
      throw new ApiError(`HTTP ${res.status} ${res.statusText}${detail ? ': ' + detail : ''}`, res.status);
    }
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError('Превышено время ожидания запроса', 0);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function encArray(arr) {
  // URLSearchParams сам кодирует значение — передаём чистый JSON
  return JSON.stringify(arr);
}

/* ------------------------------ Mojang ------------------------------ */

async function getVersionManifest() {
  return request(ENDPOINTS.mojangManifest);
}

async function getVersionJson(url) {
  return request(url);
}

/* ------------------------------ Fabric / Quilt ------------------------------ */

async function getFabricLoaders(gameVersion) {
  const all = await request(`${ENDPOINTS.fabric}/loader/${encodeURIComponent(gameVersion)}`);
  return (all || []).map(v => v.version || (v.loader && v.loader.version)).filter(Boolean).slice(0, 40);
}

async function getFabricProfile(gameVersion, loaderVersion) {
  return request(
    `${ENDPOINTS.fabric}/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  );
}

async function getQuiltLoaders(gameVersion) {
  const all = await request(`${ENDPOINTS.quilt}/loader/${encodeURIComponent(gameVersion)}`, {}, 25000);
  return (all || []).map(v => v.version || (v.loader && v.loader.version)).filter(Boolean).slice(0, 40);
}

async function getQuiltProfile(gameVersion, loaderVersion) {
  return request(
    `${ENDPOINTS.quilt}/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  );
}

/* ------------------------------ Forge / NeoForge ------------------------------ */

function stripMcPrefix(gameVersion, version) {
  const p = gameVersion + '-';
  return version.startsWith(p) ? version.slice(p.length) : version;
}

async function getForgeVersions(gameVersion) {
  const meta = await request(ENDPOINTS.forgeMeta);
  const list = (meta && meta[gameVersion]) || [];
  // Метаданные возвращают значения вида "1.20.1-47.4.29" или "47.4.29"
  return [...new Set(list.map(v => stripMcPrefix(gameVersion, String(v).replace(/-recommended$/, ''))))]
    .reverse().slice(0, 60);
}

function forgeInstallerUrl(gameVersion, forgeVersion) {
  const v = `${gameVersion}-${stripMcPrefix(gameVersion, forgeVersion)}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`;
}

async function getNeoForgeVersions(gameVersion) {
  const xml = await request(ENDPOINTS.neoforgeMeta);
  const versions = [...String(xml || '').matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
  // 1.20.4 -> 20.4.*, 1.21.0 -> 21.0.*, 1.21.1 -> 21.1.*
  const withoutOne = gameVersion.replace(/^1\./, '');
  const parts = withoutOne.split('.');
  const prefix = parts.length >= 2
    ? `${parts[0]}.${parts[1]}.`
    : `${parts[0]}.`;
  return versions.filter(v => v.startsWith(prefix)).reverse().slice(0, 60);
}

function neoforgeInstallerUrl(version) {
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
}

/* ------------------------------ Modrinth ------------------------------ */

async function modrinthCategories() {
  const all = await request(`${ENDPOINTS.modrinth}/tag/category`);
  return (all || [])
    .filter(c => c.project_type === 'mod')
    .map(c => ({ name: c.name, icon: c.icon, header: c.header }))
    .slice(0, 48);
}

async function modrinthSearch(query, options = {}) {
  const params = new URLSearchParams({
    query: query || '',
    limit: String(options.limit || 20),
    offset: String(options.offset || 0),
    index: options.index || 'relevance'
  });
  const facets = [];
  if (options.loader && options.loader !== 'vanilla') facets.push(['categories:' + options.loader]);
  if (options.category) facets.push(['categories:' + options.category]);
  if (options.gameVersion) facets.push(['versions:' + options.gameVersion]);
  if (facets.length) params.set('facets', encArray(facets));
  const data = await request(`${ENDPOINTS.modrinth}/search?${params.toString()}`);
  return (data.hits || []).map(h => ({
    source: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    icon: h.icon_url,
    downloads: h.downloads || 0,
    categories: h.categories || [],
    loaders: h.categories || [],
    gameVersions: h.versions || []
  }));
}

async function modrinthProject(projectId) {
  const p = await request(`${ENDPOINTS.modrinth}/project/${encodeURIComponent(projectId)}`);
  return {
    source: 'modrinth',
    id: p.id,
    title: p.title,
    description: p.description,
    icon: p.icon_url,
    downloads: p.downloads || 0
  };
}

async function modrinthVersions(projectId, loader, gameVersion) {
  const params = new URLSearchParams();
  if (loader) params.set('loaders', encArray([loader]));
  if (gameVersion) params.set('game_versions', encArray([gameVersion]));
  params.set('limit', '25');
  const list = await request(`${ENDPOINTS.modrinth}/project/${encodeURIComponent(projectId)}/version?${params}`);
  return (list || []).map(v => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    loaders: v.loaders || [],
    gameVersions: v.game_versions || [],
    primaryFile: (v.files || []).find(f => f.primary) || (v.files || [])[0],
    files: v.files || [],
    date: v.date_published
  }));
}

async function modrinthLatestFile(projectId, loader, gameVersion) {
  const versions = await modrinthVersions(projectId, loader, gameVersion);
  if (!versions.length) return null;
  const v = versions[0];
  if (!v.primaryFile) return null;
  return {
    url: v.primaryFile.url,
    name: v.primaryFile.filename,
    size: v.primaryFile.size,
    version: v.versionNumber,
    loader: v.loaders[0],
    gameVersion: v.gameVersions[0]
  };
}

/* ------------------------------ CurseForge ------------------------------ */

const CF_LOADER_ID = { forge: 1, cauldron: 2, liteloader: 3, fabric: 4, quilt: 5, neoforge: 6 };

function cfHeaders(apiKey) {
  if (!apiKey) throw new ApiError('В настройках не указан CurseForge API-ключ', 401);
  return { 'x-api-key': apiKey };
}

async function curseforgeCategories(apiKey) {
  const data = await request(`${ENDPOINTS.curseforge}/categories?gameId=432`, {
    headers: cfHeaders(apiKey)
  });
  return (data.data || [])
    .filter(c => c.classId === 6 || (!c.isClass && c.id))
    .map(c => ({ id: c.id, name: c.name, icon: c.iconUrl }))
    .slice(0, 48);
}

async function curseforgeSearch(query, apiKey, options = {}) {
  const params = new URLSearchParams({
    gameId: '432',
    classId: '6',
    searchFilter: query || '',
    pageSize: String(options.limit || 20),
    pageIndex: String(options.page || 0),
    sortField: String(options.sortField || 2),
    sortOrder: 'desc'
  });
  if (options.categoryId) params.set('categoryId', String(options.categoryId));
  if (options.loader && CF_LOADER_ID[options.loader]) {
    params.set('modLoaderType', String(CF_LOADER_ID[options.loader]));
  }
  if (options.gameVersion) params.set('gameVersion', options.gameVersion);
  const data = await request(`${ENDPOINTS.curseforge}/mods/search?${params}`, { headers: cfHeaders(apiKey) });
  return (data.data || []).map(m => ({
    source: 'curseforge',
    id: String(m.id),
    title: m.name,
    description: m.summary,
    icon: m.logo && m.logo.thumbnailUrl,
    downloads: m.downloadCount || 0,
    slug: m.slug,
    categories: (m.categories || []).map(c => c.name),
    gameVersions: m.gameVersions || []
  }));
}

async function curseforgeFiles(projectId, apiKey) {
  const data = await request(`${ENDPOINTS.curseforge}/mods/${encodeURIComponent(projectId)}/files`, {
    headers: cfHeaders(apiKey)
  });
  return (data.data || []).map(f => ({
    id: String(f.id),
    name: f.displayName,
    fileName: f.fileName,
    gameVersions: f.gameVersions || [],
    loaderId: f.modLoaderType || 0,
    releaseType: f.releaseType,
    date: f.fileDate
  }));
}

async function curseforgeDownloadUrl(projectId, fileId, apiKey) {
  const data = await request(
    `${ENDPOINTS.curseforge}/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download-url`,
    { headers: cfHeaders(apiKey) }
  );
  return data && data.data;
}

/* ------------------------------ Ely.by ------------------------------ */

const ELY_AUTH = 'https://authserver.ely.by';

function elyError(data, fallback) {
  const err = new Error(data.errorMessage || data.error || fallback || 'Ошибка авторизации Ely.by');
  err.elyError = data.error;
  throw err;
}

/**
 * Вход через Ely.by (протокол Yggdrasil).
 * Возвращает accessToken и выбранный профиль.
 */
async function elyAuthenticate(username, password, clientToken, totp) {
  const payload = {
    username,
    password: totp ? `${password}:${totp}` : password,
    clientToken,
    requestUser: true
  };
  const res = await fetch(`${ELY_AUTH}/auth/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && /two.?factor|2fa|totp/i.test(data.errorMessage || '')) {
      const err = new Error('На аккаунте включена двухфакторная аутентификация');
      err.code = 'TOTP_REQUIRED';
      throw err;
    }
    elyError(data, `Ely.by: HTTP ${res.status}`);
  }
  return data;
}

async function elyRefresh(accessToken, clientToken) {
  const res = await fetch(`${ELY_AUTH}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ accessToken, clientToken, requestUser: true })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) elyError(data, `Ely.by refresh: HTTP ${res.status}`);
  return data;
}

async function elyValidate(accessToken) {
  try {
    const res = await fetch(`${ELY_AUTH}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken })
    });
    return res.ok;
  } catch (_) { return false; }
}

/** Ссылка на последний authlib-injector (нужен, чтобы игра ходила на серверы Ely.by) */
async function getAuthlibInjector() {
  const rel = await request('https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest', {}, 20000);
  const asset = (rel.assets || []).find(a =>
    /authlib-injector.*\.jar$/i.test(a.name) && !/sources|javadoc|all\.jar/i.test(a.name)
  ) || (rel.assets || []).find(a => /\.jar$/i.test(a.name) && !/sources|javadoc/i.test(a.name));
  if (!asset) throw new Error('Не найден authlib-injector в последнем релизе GitHub');
  return { url: asset.browser_download_url, name: asset.name };
}

module.exports = {
  ENDPOINTS,
  elyAuthenticate,
  elyRefresh,
  elyValidate,
  getAuthlibInjector,
  modrinthCategories,
  curseforgeCategories,
  ApiError,
  request,
  getVersionManifest,
  getVersionJson,
  getFabricLoaders,
  getFabricProfile,
  getQuiltLoaders,
  getQuiltProfile,
  getForgeVersions,
  forgeInstallerUrl,
  getNeoForgeVersions,
  neoforgeInstallerUrl,
  modrinthSearch,
  modrinthProject,
  modrinthVersions,
  modrinthLatestFile,
  curseforgeSearch,
  curseforgeFiles,
  curseforgeDownloadUrl
};
