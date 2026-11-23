'use strict';

/* ===================================================================
   NOVA LAUNCHER — логика интерфейса
   =================================================================== */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const S = {
  settings: {}, accounts: [], instances: [],
  activeInstance: null, activeAccount: null,
  catalog: {
    source: 'all', sort: 'relevance', category: '', categoryId: '',
    query: '', page: 0, items: [],
    categories: { modrinth: [], curseforge: [] }, featured: []
  },
  logLines: []
};

const THEMES = [
  { id:'graphite', name:'Графит',   c:['#141619','#0f1114','#1a1d21','#c8783c'] },
  { id:'coal',     name:'Уголь',    c:['#0e0f11','#08090a','#15171a','#c8a05a'] },
  { id:'slate',    name:'Сланец',   c:['#1b2026','#12161a','#232a31','#7fa8c8'] },
  { id:'asphalt',  name:'Асфальт',  c:['#191a1d','#111214','#202125','#b9a67c'] },
  { id:'terminal', name:'Терминал', c:['#080d09','#040704','#0d150e','#6fbf7a'] },
  { id:'paper',    name:'Бумага',   c:['#eceae5','#e0ded7','#f7f6f3','#9a6334'] },
  { id:'sepia',    name:'Сепия',    c:['#1e1813','#14100d','#262019','#c48b52'] },
  { id:'indigo',   name:'Индиго',   c:['#12141d','#0b0d13','#1a1d29','#8f93c9'] },
  { id:'marine',   name:'Море',     c:['#101a20','#091116','#17242b','#5fa8bd'] },
  { id:'wine',     name:'Вино',     c:['#1c1215','#120c0e','#251a1e','#c06b78'] }
];

const BG_PRESETS = [
  { name:'Нет', value:'' },
  { name:'Сетка', value:'linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)' },
  { name:'Штриховка', value:'repeating-linear-gradient(135deg, rgba(200,120,60,.10) 0 1px, transparent 1px 14px)' },
  { name:'Точки', value:'radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px)' },
  { name:'Туман', value:'radial-gradient(circle at 70% 10%, rgba(120,150,190,.18), transparent 55%)' }
];

const FEATURED_IDS = ['AANobbMI', 'YL57xq9U', 'P7dR8mSH']; // Sodium, Iris, Fabric API

const COLLECTIONS = [
  { id:'perf',   label:'Производительность', icon:'i-bolt',   query:'optimization', category:'optimization' },
  { id:'gui',    label:'Интерфейс',          icon:'i-sliders', query:'gui',         category:'gui' },
  { id:'surv',   label:'Выживание',          icon:'i-shield',  query:'survival',    category:'survival' },
  { id:'shader', label:'Шейдеры и свет',     icon:'i-globe',   query:'shader',      category:'' },
  { id:'world',  label:'Генерация мира',     icon:'i-cube',    query:'worldgen',    category:'worldgen' }
];

/* ------------------------------ Утилиты ------------------------------ */

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function icon(id, cls = '') { return `<svg class="${cls}"><use href="#${id}"/></svg>`; }

function toast(msg, type = '') {
  const item = document.createElement('div');
  item.className = 'toast-item ' + type;
  item.textContent = msg;
  $('#toast').appendChild(item);
  setTimeout(() => item.remove(), 4300);
}
function setStatus(text) {
  $('#statusText').textContent = (text || 'ГОТОВО').toUpperCase();
  $('#progressStatus').textContent = text || '';
}
function logLine(text) {
  S.logLines.push(String(text));
  if (S.logLines.length > 600) S.logLines.shift();
  $('#console').innerHTML = S.logLines.map(l => {
    const cls = /^\[ERR\]|ошибка|error/i.test(l) ? 'err' : /готово|успешно|^■/i.test(l) ? 'ok' : '';
    return `<span class="${cls}">${esc(l)}</span>`;
  }).join('\n');
  $('#console').scrollTop = $('#console').scrollHeight;
}
function showProgress(title) { $('#progressTitle').textContent = title || 'Установка'; $('#progressOverlay').classList.remove('hidden'); }
function hideProgress() { $('#progressOverlay').classList.add('hidden'); }

function openModal(title, bodyHtml, buttons = []) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  const foot = $('#modalFoot');
  foot.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.primary ? 'btn-primary' : 'btn-ghost');
    btn.textContent = b.label;
    btn.onclick = async () => {
      const r = b.onClick ? await b.onClick() : true;
      if (r !== false) closeModal();
    };
    foot.appendChild(btn);
  });
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return `rgba(200,120,60,${a})`;
  return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
}

/* ------------------------------ Оформление ------------------------------ */

function applyAppearance(patch = {}) {
  const s = { ...S.settings, ...patch };
  if (s.theme) document.documentElement.setAttribute('data-theme', s.theme);
  if (s.accent) {
    document.body.style.setProperty('--accent', s.accent);
    document.body.style.setProperty('--accent-soft', hexToRgba(s.accent, .14));
  }
  if (s.density) document.body.setAttribute('data-density', s.density);
  if (s.fontSize) document.body.style.setProperty('--font-size', s.fontSize + 'px');
  if (s.radius != null) document.body.style.setProperty('--radius', s.radius + 'px');
  if (s.background) {
    document.body.classList.add('has-bg');
    document.body.style.setProperty('--bg-image', `url("${s.background.replace(/\\/g,'/')}")`);
  } else {
    document.body.classList.remove('has-bg');
    document.body.style.removeProperty('--bg-image');
  }
}

function renderThemes() {
  $('#themeGrid').innerHTML = THEMES.map(t => `
    <div class="theme-card ${S.settings.theme === t.id ? 'active' : ''}" data-theme-id="${t.id}">
      <div class="tp-preview" style="background:${t.c[0]}">
        <div class="tp-s" style="background:${t.c[1]}"></div>
        <div class="tp-m">
          <div class="tp-bar" style="background:${t.c[1]}"></div>
          <div class="tp-box" style="background:${t.c[2]};border-color:${t.c[3]}"></div>
        </div>
      </div>
      <div class="tp-name">${t.name}</div>
    </div>`).join('');
  $$('.theme-card').forEach(card => card.onclick = () => {
    $$('.theme-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    S.settings.theme = card.dataset.themeId;
    applyAppearance({ theme: S.settings.theme });
  });

  $('#bgPresets').innerHTML = BG_PRESETS.map((b, i) => `
    <div class="bg-swatch ${!S.settings.background && !i ? 'active' : ''}" data-bg="${i}"
         title="${esc(b.name)}" style="background:${b.value || 'var(--bg-2)'}"></div>`).join('');
  $$('.bg-swatch').forEach(sw => sw.onclick = () => {
    const b = BG_PRESETS[+sw.dataset.bg];
    S.settings.background = b.value || '';
    applyAppearance({ background: S.settings.background });
    $('#bgPath').textContent = b.name;
    $$('.bg-swatch').forEach(x => x.classList.remove('active'));
    sw.classList.add('active');
  });
}

/* ------------------------------ Профили ------------------------------ */

function renderInstances() {
  $('#instanceCount').textContent = S.instances.length;
  $('#instanceList').innerHTML = S.instances.map(i => `
    <div class="instance-item ${S.activeInstance && S.activeInstance.id === i.id ? 'active' : ''}" data-id="${i.id}">
      <div class="instance-icon">${icon('i-layers')}</div>
      <div class="instance-meta">
        <b>${esc(i.name)}</b>
        <small>MC ${esc(i.gameVersion)} · ${i.memory || 2048} МБ</small>
      </div>
      <span class="loader-tag ${esc(i.loader)}">${esc(i.loader)}</span>
    </div>`).join('') || `<div class="empty-hero" style="min-height:90px">Профилей пока нет</div>`;

  $$('.instance-item').forEach(el => el.onclick = () => {
    S.activeInstance = S.instances.find(x => x.id === el.dataset.id);
    renderInstances(); syncModInstance();
  });
  renderHero();
}

function renderHero() {
  const i = S.activeInstance;
  const body = $('#heroBody');
  if (!i) {
    body.innerHTML = `<div class="empty-hero">Создайте профиль, чтобы собрать и запустить клиент</div>`;
    return;
  }
  body.innerHTML = `
    <h2 class="hero-title">${esc(i.name)}</h2>
    <div class="hero-sub">Minecraft ${esc(i.gameVersion)} · загрузчик ${esc(i.loader)}${i.loaderVersion ? ' ' + esc(i.loaderVersion) : ''}</div>
    <dl class="spec">
      <div><dt>Состояние</dt><dd class="${i.installed ? 'ok' : 'no'}">${i.installed ? 'УСТАНОВЛЕН' : 'НЕ УСТАНОВЛЕН'}</dd></div>
      <div><dt>Память</dt><dd>${i.memory || 2048} MB</dd></div>
      <div><dt>Версия</dt><dd>${esc((i.versionId || '—').slice(0, 22))}</dd></div>
    </dl>
    <div class="hero-actions">
      <button class="btn btn-primary" id="heroLaunch" ${i.installed ? '' : 'disabled'}>${icon('i-play')}Запустить</button>
      <button class="btn" id="heroInstall">${icon('i-download')}${i.installed ? 'Переустановить' : 'Установить'}</button>
      <button class="btn btn-ghost" id="heroEdit">${icon('i-pencil')}Настроить</button>
      <button class="btn btn-ghost" id="heroFolder">${icon('i-folder')}Папка модов</button>
      <button class="btn btn-ghost" id="heroDelete">${icon('i-trash')}Удалить</button>
    </div>`;

  $('#heroLaunch').onclick = doLaunch;
  $('#heroInstall').onclick = doInstall;
  $('#heroEdit').onclick = () => openInstanceModal(i);
  $('#heroFolder').onclick = () => window.api.openFolder(joinPath(i.gameDir, 'mods'));
  $('#heroDelete').onclick = () => openModal('Удалить профиль', `
    <p class="form-hint">«${esc(i.name)}» будет удалён из списка. Файлы на диске останутся.</p>`, [
      { label:'Отмена' },
      { label:'Удалить', primary:true, onClick: async () => {
        await window.api.deleteInstance(i.id);
        S.instances = S.instances.filter(x => x.id !== i.id);
        S.activeInstance = S.instances[0] || null;
        renderInstances(); syncModInstance();
        toast('Профиль удалён', 'success');
      } }
    ]);
}

function joinPath(a, b) {
  return (a || '') + (/\\/.test(a || '') ? '\\' : '/') + b;
}

async function doInstall() {
  const i = S.activeInstance;
  if (!i) return;
  if (!i.loaderVersion && ['fabric','quilt','forge','neoforge'].includes(i.loader)) {
    toast('Выберите версию загрузчика', 'error'); openInstanceModal(i); return;
  }
  showProgress('Установка · ' + i.name);
  setStatus('Подготовка');
  try {
    const updated = await window.api.installInstance(i.id);
    Object.assign(i, updated);
    S.instances = S.instances.map(x => x.id === i.id ? i : x);
    renderInstances();
    toast('Клиент установлен', 'success');
  } catch (e) {
    toast('Ошибка установки: ' + e.message, 'error');
    logLine('[ERR] ' + e.message);
  } finally { hideProgress(); setStatus(''); }
}

async function doLaunch() {
  const i = S.activeInstance, acc = S.activeAccount;
  if (!i || !acc) { toast('Нужны профиль и аккаунт', 'error'); return; }
  if (!i.installed) { toast('Сначала установите профиль', 'error'); return; }
  $('#console').textContent = ''; S.logLines = [];
  setStatus('Запуск Minecraft');
  try { await window.api.launch(i.id, acc.id); }
  catch (e) { toast('Запуск не удался: ' + e.message, 'error'); logLine('[ERR] ' + e.message); }
  finally { setStatus(''); }
}

async function openInstanceModal(existing) {
  const gameVersions = await window.api.getGameVersions();
  const d = existing || {};
  const loaders = ['vanilla','fabric','quilt','forge','neoforge'];
  openModal(existing ? 'Настройка профиля' : 'Новый профиль', `
    <div class="modal-field"><label>Название</label><input id="mName" class="input" value="${esc(d.name || 'Мой Minecraft')}" /></div>
    <div class="modal-field"><label>Метка (1–2 символа)</label><input id="mIcon" class="input" value="${esc(d.icon || 'MC')}" maxlength="3" /></div>
    <div class="modal-field"><label>Версия Minecraft</label><select id="mVersion" class="input">
      ${gameVersions.map(v => `<option value="${esc(v.id)}" ${d.gameVersion === v.id ? 'selected' : ''}>${esc(v.id)}</option>`).join('')}
    </select></div>
    <div class="modal-field"><label>Загрузчик</label><select id="mLoader" class="input">
      ${loaders.map(l => `<option value="${l}" ${d.loader === l ? 'selected' : ''}>${l}</option>`).join('')}
    </select></div>
    <div class="modal-field"><label>Версия загрузчика</label><select id="mLoaderVersion" class="input"><option value="">—</option></select></div>
    <div class="modal-field"><label>Память, МБ</label><input id="mMemory" class="input" type="number" min="512" max="16384" step="512" value="${d.memory || 2048}" /></div>
    <div class="modal-field"><label>Доп. аргументы JVM</label><input id="mJvm" class="input" value="${esc(d.jvmArgs || '')}" placeholder="-XX:+UseG1GC" /></div>
  `, [
    { label:'Отмена' },
    { label: existing ? 'Сохранить' : 'Создать', primary:true, onClick: async () => {
      const payload = {
        name: $('#mName').value.trim() || 'Minecraft',
        icon: $('#mIcon').value.trim() || 'MC',
        gameVersion: $('#mVersion').value,
        loader: $('#mLoader').value,
        loaderVersion: $('#mLoaderVersion').value,
        memory: Number($('#mMemory').value) || 2048,
        jvmArgs: $('#mJvm').value.trim()
      };
      if (existing) {
        const upd = await window.api.updateInstance({ id: existing.id, ...payload });
        Object.assign(existing, upd);
        S.instances = S.instances.map(x => x.id === existing.id ? existing : x);
        toast('Профиль обновлён', 'success');
      } else {
        const created = await window.api.createInstance(payload);
        S.instances.push(created); S.activeInstance = created;
        toast('Профиль создан', 'success');
      }
      renderInstances(); syncModInstance();
    } }
  ]);

  const refreshLoaderVersions = async () => {
    const loader = $('#mLoader').value, gv = $('#mVersion').value, sel = $('#mLoaderVersion');
    sel.innerHTML = '<option value="">—</option>';
    if (loader === 'vanilla') { sel.disabled = true; return; }
    sel.disabled = true;
    try {
      const versions = await window.api.getLoaderVersions(loader, gv);
      sel.innerHTML = '<option value="">— выберите —</option>' +
        versions.map(v => `<option value="${esc(v)}" ${d.loaderVersion === v ? 'selected' : ''}>${esc(v)}</option>`).join('');
      if (!d.loaderVersion && versions.length) sel.value = versions[0];
      else if (d.loaderVersion) sel.value = d.loaderVersion;
    } catch (e) { toast('Список загрузчиков недоступен', 'error'); }
    finally { sel.disabled = false; }
  };
  $('#mLoader').onchange = refreshLoaderVersions;
  $('#mVersion').onchange = refreshLoaderVersions;
  await refreshLoaderVersions();
}

/* ------------------------------ Аккаунты ------------------------------ */

function renderAccounts() {
  $('#accountList').innerHTML = S.accounts.map(a => `
    <div class="account-card ${S.activeAccount && S.activeAccount.id === a.id ? 'active' : ''}">
      <div class="avatar">${esc((a.name || 'P')[0].toUpperCase())}</div>
      <div class="acc-meta">
        <b>${esc(a.name)}</b>
        <small>${a.type === 'ely' ? 'Ely.by' : 'Локальный'} · ${esc((a.uuid || '').slice(0, 14))}…</small>
      </div>
      <span class="type-tag ${a.type === 'ely' ? 'ely' : ''}">${a.type === 'ely' ? 'ELY.BY' : 'ОФЛАЙН'}</span>
      ${a.type === 'ely' ? `<button class="text-btn" data-refresh="${a.id}" title="Обновить токен">${icon('i-refresh')}</button>` : ''}
      <button class="text-btn" data-use="${a.id}">${S.activeAccount && S.activeAccount.id === a.id ? 'АКТИВЕН' : 'ВЫБРАТЬ'}</button>
      <button class="text-btn danger" data-del="${a.id}">${icon('i-x')}</button>
    </div>`).join('') || `<div class="empty-hero">Аккаунтов пока нет</div>`;

  $$('[data-use]').forEach(b => b.onclick = async () => {
    await window.api.selectAccount(b.dataset.use);
    S.activeAccount = S.accounts.find(a => a.id === b.dataset.use);
    renderAccounts(); renderMiniAccount(); toast('Аккаунт выбран', 'success');
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    await window.api.removeAccount(b.dataset.del);
    S.accounts = S.accounts.filter(a => a.id !== b.dataset.del);
    if (S.activeAccount && S.activeAccount.id === b.dataset.del) S.activeAccount = S.accounts[0] || null;
    renderAccounts(); renderMiniAccount();
  });
  $$('[data-refresh]').forEach(b => b.onclick = async () => {
    try { await window.api.refreshEly(b.dataset.refresh); toast('Токен Ely.by обновлён', 'success'); }
    catch (e) { toast('Не удалось обновить: ' + e.message, 'error'); }
  });
}

function renderMiniAccount() {
  const a = S.activeAccount;
  $('#miniName').textContent = a ? a.name : 'Player';
  $('#miniAvatar').textContent = a ? (a.name || 'P')[0].toUpperCase() : 'P';
  $('#miniType').textContent = a && a.type === 'ely' ? 'ELY.BY' : 'ОФЛАЙН';
}

function openAccountModal() {
  openModal('Добавить аккаунт', `
    <div class="tabs" id="accTabs">
      <button class="active" data-tab="offline">ОФЛАЙН-ПРОФИЛЬ</button>
      <button data-tab="ely">ELY.BY</button>
    </div>
    <div id="accTab-offline">
      <div class="modal-field"><label>Имя игрока</label><input id="accName" class="input" value="Player" maxlength="16" /></div>
      <p class="form-hint">Создаётся локальный профиль со случайным UUID. Пароль и вход в Microsoft не нужны.</p>
    </div>
    <div id="accTab-ely" class="hidden">
      <div class="modal-field"><label>Ник или E-mail Ely.by</label><input id="elyUser" class="input" autocomplete="username" /></div>
      <div class="modal-field"><label>Пароль</label><input id="elyPass" class="input" type="password" autocomplete="current-password" /></div>
      <p class="form-hint">Данные отправляются напрямую на authserver.ely.by и не сохраняются — хранится только токен доступа. Для двухфакторной защиты лаунчер запросит код.</p>
    </div>
  `, [
    { label:'Отмена' },
    { label:'Продолжить', primary:true, onClick: async () => {
      const tab = $('#accTabs .active').dataset.tab;
      if (tab === 'offline') {
        const acc = await window.api.addAccount({ name: $('#accName').value.trim() || 'Player' });
        S.accounts.push(acc); S.activeAccount = acc;
        renderAccounts(); renderMiniAccount(); toast('Профиль создан', 'success');
        return true;
      }
      const username = $('#elyUser').value.trim();
      const password = $('#elyPass').value;
      if (!username || !password) { toast('Введите логин и пароль', 'error'); return false; }
      try {
        const acc = await window.api.elyLogin({ username, password });
        S.accounts.push(acc); S.activeAccount = acc;
        renderAccounts(); renderMiniAccount(); toast('Вход через Ely.by выполнен', 'success');
        return true;
      } catch (e) {
        if (e.code === 'TOTP_REQUIRED') { openTotpModal(username, password); return false; }
        toast('Ely.by: ' + e.message, 'error'); return false;
      }
    } }
  ]);

  $$('#accTabs button').forEach(b => b.onclick = () => {
    $$('#accTabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#accTab-offline').classList.toggle('hidden', b.dataset.tab !== 'offline');
    $('#accTab-ely').classList.toggle('hidden', b.dataset.tab !== 'ely');
  });
}

function openTotpModal(username, password) {
  openModal('Код двухфакторной защиты', `
    <div class="modal-field"><label>Код из приложения (6 цифр)</label><input id="elyTotp" class="input" inputmode="numeric" maxlength="6" /></div>
    <p class="form-hint">Повторный вход для ${esc(username)} с кодом, прикреплённым к паролю.</p>
  `, [
    { label:'Отмена' },
    { label:'Войти', primary:true, onClick: async () => {
      const totp = $('#elyTotp').value.trim();
      if (!totp) return false;
      try {
        const acc = await window.api.elyLogin({ username, password, totp });
        S.accounts.push(acc); S.activeAccount = acc;
        renderAccounts(); renderMiniAccount(); toast('Вход через Ely.by выполнен', 'success');
        return true;
      } catch (e) { toast('Ely.by: ' + e.message, 'error'); return false; }
    } }
  ]);
  setTimeout(() => $('#elyTotp') && $('#elyTotp').focus(), 30);
}

/* ------------------------------ Каталог модов ------------------------------ */

function syncModInstance() {
  const sel = $('#modInstance'), prev = sel.value;
  sel.innerHTML = S.instances.map(i => `<option value="${i.id}">${esc(i.name)} · MC ${esc(i.gameVersion)}</option>`).join('');
  if (prev && S.instances.some(i => i.id === prev)) sel.value = prev;
  else if (S.activeInstance) sel.value = S.activeInstance.id;
  updateFilterInfo(); refreshInstalled();
}

function currentModInstance() {
  return S.instances.find(i => i.id === $('#modInstance').value) || S.activeInstance;
}

function updateFilterInfo() {
  const i = currentModInstance(), c = S.catalog;
  const label = c.source === 'all' ? 'все источники' : c.source === 'modrinth' ? 'Modrinth' : 'CurseForge';
  $('#modFilterInfo').textContent =
    `MC ${i ? esc(i.gameVersion) : '—'} · ${i ? esc(i.loader) : '—'} · ${label}` +
    (c.category ? ` · ${esc(c.category)}` : '') + (c.query ? ` · «${esc(c.query)}»` : '');
}

async function loadFeatured() {
  const results = await Promise.allSettled(
    FEATURED_IDS.map(id => window.api.getModProject({ source:'modrinth', projectId:id }))
  );
  S.catalog.featured = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  renderFeatured();
}

function renderFeatured() {
  $('#catalogFeatured').innerHTML = S.catalog.featured.map(m => `
    <div class="ch-item">
      ${m.icon ? `<img src="${esc(m.icon)}" alt="" />` : '<div class="mod-icon"></div>'}
      <div class="ch-name"><b>${esc(m.title)}</b><small>${(m.downloads || 0).toLocaleString('ru')} загрузок</small></div>
      <button class="btn btn-primary" data-source="${m.source}" data-id="${esc(m.id)}">Установить</button>
    </div>`).join('') || `<div class="empty-hero">Подборка недоступна</div>`;
  $$('.ch-item .btn').forEach(b => b.onclick = () => quickInstall(b.dataset.id, b.dataset.source, b));
}

function renderCollections() {
  $('#catalogCollections').innerHTML = COLLECTIONS.map(c => `
    <button class="collection" data-collection="${c.id}">${icon(c.icon)}${c.label}</button>`).join('');
  $$('[data-collection]').forEach(b => b.onclick = () => {
    const c = COLLECTIONS.find(x => x.id === b.dataset.collection);
    if (!c) return;
    S.catalog.query = c.query;
    S.catalog.category = c.category || '';
    S.catalog.categoryId = '';
    S.catalog.page = 0;
    $('#modSearch').value = c.query;
    searchMods();
  });
}

async function loadCategories() {
  S.catalog.categories = await window.api.getCatalogCategories();
  renderCategories();
}

function renderCategories() {
  const c = S.catalog;
  const list = c.source === 'curseforge' ? c.categories.curseforge : c.categories.modrinth;
  const items = (list || []).slice(0, 20);
  $('#catalogCategories').innerHTML =
    `<button class="cat-chip ${!c.category ? 'active' : ''}" data-cat="">ВСЕ</button>` +
    items.map(x => {
      const value = c.source === 'curseforge' ? x.id : x.name;
      const label = x.header || x.name;
      return `<button class="cat-chip ${c.category === value ? 'active' : ''}" data-cat="${esc(value)}">${esc(label)}</button>`;
    }).join('');
  $$('.cat-chip').forEach(b => b.onclick = () => {
    c.category = b.dataset.cat;
    c.categoryId = c.source === 'curseforge' ? b.dataset.cat : '';
    c.page = 0;
    renderCategories(); searchMods();
  });
}

async function searchMods() {
  const c = S.catalog;
  c.query = $('#modSearch').value.trim();
  c.page = Math.max(0, c.page);
  const btn = $('#btnModSearch'); btn.disabled = true;
  setStatus('Поиск в каталоге');
  try {
    const inst = currentModInstance();
    c.items = await window.api.searchMods({
      source: c.source,
      query: c.query,
      loader: inst ? inst.loader : null,
      gameVersion: inst ? inst.gameVersion : null,
      index: c.sort,
      category: c.category,
      categoryId: c.categoryId,
      page: c.page
    });
    renderMods();
  } catch (e) {
    toast('Ошибка каталога: ' + e.message, 'error');
  } finally { btn.disabled = false; setStatus(''); }
}

function renderMods() {
  $('#catalogCount').textContent = S.catalog.items.length ? `${S.catalog.items.length} НАЙДЕНО` : '';
  $('#modPage').textContent = String(S.catalog.page + 1).padStart(2, '0');
  $('#modPrev').disabled = S.catalog.page === 0;
  updateFilterInfo();

  $('#modResults').innerHTML = S.catalog.items.map(m => `
    <div class="mod-card">
      ${m.icon ? `<img class="mod-icon" src="${esc(m.icon)}" alt="" onerror="this.style.visibility='hidden'" />` : '<div class="mod-icon"></div>'}
      <div class="mod-info">
        <h4 title="${esc(m.title)}">${esc(m.title)}</h4>
        <p>${esc(m.description || '')}</p>
        <div class="mod-foot">
          <span class="mod-source ${m.source}">${m.source === 'modrinth' ? 'MODRINTH' : 'CURSEFORGE'} · ${(m.downloads || 0).toLocaleString('ru')}</span>
          <span>
            <button class="btn btn-ghost mod-versions" data-id="${esc(m.id)}" data-source="${m.source}" title="Выбрать версию">⋮</button>
            <button class="btn btn-primary mod-install" data-id="${esc(m.id)}" data-source="${m.source}">В 1 клик</button>
          </span>
        </div>
      </div>
    </div>`).join('') || `<div class="empty-hero" style="grid-column:1/-1">Ничего не найдено — попробуйте другой запрос или категорию</div>`;

  $$('.mod-install').forEach(b => b.onclick = () => quickInstall(b.dataset.id, b.dataset.source, b));
  $$('.mod-versions').forEach(b => b.onclick = () => openModVersions(b.dataset.id, b.dataset.source));
}

async function quickInstall(projectId, source, btn) {
  const inst = currentModInstance();
  if (!inst) { toast('Сначала создайте профиль', 'error'); return; }
  btn.disabled = true;
  try {
    await window.api.installMod({
      instanceId: inst.id, source, projectId,
      loader: inst.loader, gameVersion: inst.gameVersion
    });
    toast('Мод установлен в ' + inst.name, 'success');
    await refreshInstalled();
  } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function openModVersions(projectId, source) {
  const inst = currentModInstance();
  if (!inst) return;
  let versions = [];
  try {
    versions = await window.api.getModVersions({
      source, projectId, loader: inst.loader, gameVersion: inst.gameVersion
    });
  } catch (e) { toast('Не удалось загрузить версии: ' + e.message, 'error'); return; }
  openModal('Выберите версию', versions.length
    ? versions.map((v, idx) => `<label class="modal-option"><input type="radio" name="mv" value="${idx}" ${idx === 0 ? 'checked' : ''}/>${esc(v.name)}</label>`).join('')
    : '<p class="form-hint">Совместимых версий не найдено.</p>', [
      { label:'Отмена' },
      { label:'Установить', primary:true, onClick: async () => {
        const checked = $('input[name="mv"]:checked');
        if (!checked || !versions.length) return false;
        const v = versions[+checked.value];
        try {
          await window.api.installMod({
            instanceId: inst.id, source, projectId, fileId: v.id, fileName: v.fileName,
            loader: inst.loader, gameVersion: inst.gameVersion
          });
          toast('Мод установлен', 'success'); refreshInstalled();
        } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
      } }
    ]);
}

async function refreshInstalled() {
  const inst = currentModInstance();
  if (!inst) return;
  const files = await window.api.installedMods(inst.id);
  $('#installedCount').textContent = files.length;
  $('#installedMods').innerHTML = files.map(f => `
    <div class="mod-chip ${f.name.endsWith('.disabled') ? 'off' : ''}">
      <span>${esc(f.name)}</span>
      <button data-toggle="${esc(f.name)}" title="Вкл/Выкл">${icon('i-power')}</button>
      <button data-remove="${esc(f.name)}" title="Удалить">${icon('i-x')}</button>
    </div>`).join('') || `<span style="color:var(--muted);font-size:10px">Моды ещё не установлены</span>`;

  $$('[data-toggle]').forEach(b => b.onclick = async () => { await window.api.toggleMod(inst.id, b.dataset.toggle); refreshInstalled(); });
  $$('[data-remove]').forEach(b => b.onclick = async () => { await window.api.removeMod(inst.id, b.dataset.remove); refreshInstalled(); });
}

/* ------------------------------ Модпаки ------------------------------ */

function renderModpacks() {
  const packs = [
    { name:'Fabric Performance', desc:'Fabric API, Sodium, Iris, Lithium — максимум кадров.', loader:'fabric', gv:'1.21.1', icon:'i-bolt' },
    { name:'Survival Kit', desc:'Карты, JEI, подсказки и удобства для выживания.', loader:'fabric', gv:'1.20.1', icon:'i-shield' },
    { name:'Forge Classic', desc:'Классический набор Forge с JEI и улучшениями UI.', loader:'forge', gv:'1.20.1', icon:'i-box' },
    { name:'NeoForge Modern', desc:'Профиль под актуальные сборки NeoForge.', loader:'neoforge', gv:'1.21.0', icon:'i-cube' }
  ];
  $('#modpackList').innerHTML = packs.map(p => `
    <div class="modpack-card">
      <div class="mp-icon">${icon(p.icon)}</div>
      <h3>${p.name}</h3><p>${p.desc}</p>
      <button class="btn" data-pack="${packs.indexOf(p)}">Создать профиль</button>
    </div>`).join('');
  $$('[data-pack]').forEach(b => b.onclick = () => {
    const p = packs[+b.dataset.pack];
    openInstanceModal({ name:p.name, icon:p.name.slice(0,2).toUpperCase(), gameVersion:p.gv, loader:p.loader, memory:4096 });
  });
}

/* ------------------------------ Настройки ------------------------------ */

function fillSettings() {
  const s = S.settings;
  $('#setGameDir').value = s.gameDir || '';
  $('#setJava').value = s.javaPath && s.javaPath !== 'auto' ? s.javaPath : '';
  $('#setCfKey').value = s.curseforgeKey || '';
  $('#setMemory').value = s.memory || 2048;
  $('#memoryLabel').textContent = (s.memory || 2048) + ' МБ';
  $('#setShowConsole').checked = s.showConsole !== false;
  $('#setCloseOnLaunch').checked = !!s.closeOnLaunch;
  $('#setAutoInstall').checked = s.autoInstall !== false;
  $('#javaDetected').textContent = 'Обнаружена Java: ' + (s.detectedJava || 'java');
}
function collectSettings() {
  return {
    gameDir: $('#setGameDir').value.trim(),
    javaPath: $('#setJava').value.trim() || 'auto',
    curseforgeKey: $('#setCfKey').value.trim(),
    memory: Number($('#setMemory').value),
    showConsole: $('#setShowConsole').checked,
    closeOnLaunch: $('#setCloseOnLaunch').checked,
    autoInstall: $('#setAutoInstall').checked
  };
}
function fillAppearance() {
  const s = S.settings;
  $('#setAccent').value = s.accent || '#c8783c';
  $('#setDensity').value = s.density || 'comfortable';
  $('#setFont').value = s.fontSize || 13;
  $('#setRadius').value = s.radius == null ? 4 : s.radius;
  $('#fontLabel').textContent = (s.fontSize || 13) + ' px';
  $('#radiusLabel').textContent = (s.radius == null ? 4 : s.radius) + ' px';
  $('#bgPath').textContent = s.background || 'Нет';
  renderThemes();
}

/* ------------------------------ События ------------------------------ */

function bindEvents() {
  $$('.nav-item').forEach(b => b.onclick = () => setPage(b.dataset.page));
  $('#winMin').onclick = () => window.api.windowMin();
  $('#winMax').onclick = () => window.api.windowMax();
  $('#winClose').onclick = () => window.api.windowClose();
  $('#modalClose').onclick = closeModal;
  $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

  $('#btnNewInstance').onclick = () => openInstanceModal(null);
  $('#btnAddInstanceInline').onclick = () => openInstanceModal(null);
  $('#btnClearLog').onclick = () => { S.logLines = []; $('#console').textContent = ''; };
  $('#btnKill').onclick = () => window.api.kill();
  $('#accountMini').onclick = () => setPage('accounts');
  $('#btnAddAccount').onclick = openAccountModal;

  $('#btnModSearch').onclick = () => { S.catalog.page = 0; searchMods(); };
  $('#modSearch').onkeydown = e => { if (e.key === 'Enter') { S.catalog.page = 0; searchMods(); } };
  $('#catalogSort').onchange = e => { S.catalog.sort = e.target.value; S.catalog.page = 0; searchMods(); };
  $$('#catalogSource button').forEach(b => b.onclick = () => {
    $$('#catalogSource button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    S.catalog.source = b.dataset.source;
    S.catalog.category = ''; S.catalog.categoryId = ''; S.catalog.page = 0;
    renderCategories(); searchMods();
  });
  $('#modInstance').onchange = () => { updateFilterInfo(); refreshInstalled(); };
  $('#modPrev').onclick = () => { if (S.catalog.page > 0) { S.catalog.page--; searchMods(); } };
  $('#modNext').onclick = () => { S.catalog.page++; searchMods(); };

  $('#setMemory').oninput = e => $('#memoryLabel').textContent = e.target.value + ' МБ';
  $('#pickGameDir').onclick = async () => { const p = await window.api.pickFolder(); if (p) $('#setGameDir').value = p; };
  $('#pickJava').onclick = async () => { const p = await window.api.pickJava(); if (p) $('#setJava').value = p; };
  $('#btnSaveSettings').onclick = async () => {
    S.settings = { ...S.settings, ...await window.api.saveSettings(collectSettings()) };
    fillSettings(); toast('Настройки сохранены', 'success');
  };

  $('#setFont').oninput = e => { $('#fontLabel').textContent = e.target.value + ' px'; applyAppearance({ fontSize:+e.target.value }); };
  $('#setRadius').oninput = e => { $('#radiusLabel').textContent = e.target.value + ' px'; applyAppearance({ radius:+e.target.value }); };
  $('#setDensity').onchange = e => applyAppearance({ density:e.target.value });
  $('#setAccent').oninput = e => applyAppearance({ accent:e.target.value });
  $('#pickBg').onclick = async () => {
    const p = await window.api.pickImage();
    if (p) { S.settings.background = p; applyAppearance({ background:p }); $('#bgPath').textContent = p; }
  };
  $('#clearBg').onclick = () => { S.settings.background = ''; applyAppearance({ background:'' }); $('#bgPath').textContent = 'Нет'; };
  $('#btnSaveAppearance').onclick = async () => {
    const patch = {
      accent: $('#setAccent').value, density: $('#setDensity').value,
      fontSize: Number($('#setFont').value), radius: Number($('#setRadius').value)
    };
    S.settings = { ...S.settings, ...await window.api.saveSettings(patch) };
    applyAppearance(patch); toast('Оформление сохранено', 'success');
  };

  window.api.on('log', logLine);
  window.api.on('status', setStatus);
  window.api.on('progress', p => {
    if (!p) return;
    if (p.total && p.done != null) {
      $('#progressBar').style.width = Math.max(3, Math.round(p.done / p.total * 100)) + '%';
      $('#progressDetail').textContent = `${p.label || ''} ${p.done}/${p.total}`;
      $('#progressOverlay .progress-box').classList.remove('indeterminate');
    } else {
      $('#progressOverlay .progress-box').classList.add('indeterminate');
    }
  });
}

function setPage(page) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $('#page-' + page);
  if (el) el.classList.add('active');
  const nav = $(`.nav-item[data-page="${page}"] .label`);
  $('#crumb').textContent = nav ? nav.textContent : page;
  if (page === 'accounts') renderAccounts();
  if (page === 'mods') syncModInstance();
}

/* ------------------------------ Старт ------------------------------ */

(async function init() {
  bindEvents();
  try {
    const state = await window.api.getState();
    S.settings = state.settings || {};
    S.accounts = state.accounts || [];
    S.instances = state.instances || [];
    S.activeInstance = S.instances[0] || null;
    S.activeAccount = S.accounts.find(a => a.id === S.settings.activeAccount) || S.accounts[0] || null;

    applyAppearance(); fillSettings(); fillAppearance();
    renderInstances(); renderMiniAccount(); renderModpacks(); renderAccounts();
    syncModInstance(); renderCollections(); renderCategories();
    loadCategories(); loadFeatured();
    searchMods();

    logLine('NOVA LAUNCHER · готов');
    logLine('Создайте профиль → установите → запустите. Каталог модов доступен отдельной вкладкой.');
  } catch (e) {
    toast('Ошибка запуска интерфейса: ' + e.message, 'error');
    logLine('[ERR] ' + e.message);
  }
})();
