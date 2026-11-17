// Waktool — module main
import { st } from './state.js?v=f108e1bb';
import { $, changed, esc, icon, jget, listeners, sj, store } from './util.js?v=f108e1bb';
import { ALL, CRAFTS, HARVEST, PRICES, allItems, bg, bjob, getJob, levelOf, lvlKey, pins, price, setPins, setPrices } from './model.js?v=f108e1bb';
import { renderSide } from './side.js?v=f108e1bb';
import { only, renderJobCard, renderMetiers } from './metiers.js?v=f108e1bb';
import { renderProfit } from './profit.js?v=f108e1bb';
import { renderSession, sess } from './session.js?v=f108e1bb';
// ================================================================ thème + PWA
const THEMES = { auto: ['◐', 'Thème : automatique (système)'], light: ['☀', 'Thème : clair'], dark: ['☾', 'Thème : sombre'] };
const themeBtn = $('#theme-btn');
function applyTheme(t) {
  if (!THEMES[t]) t = 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  themeBtn.textContent = THEMES[t][0];
  themeBtn.title = THEMES[t][1] + ' — cliquer pour changer';
  themeBtn.setAttribute('aria-label', THEMES[t][1]);
}
const curTheme = () => store.get('theme') || 'auto';
applyTheme(curTheme());
themeBtn.addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  const t = order[(order.indexOf(curTheme()) + 1) % 3];
  store.set('theme', t); applyTheme(t); changed();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
let installEvt = null;
const installBtn = $('#install-btn');
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; installBtn.hidden = false; });
window.addEventListener('appinstalled', () => { installBtn.hidden = true; installEvt = null; });
installBtn.addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null; installBtn.hidden = true;
});

// ================================================================ état / navigation
const PAGES = ['metiers', 'rentabilite', 'session'];
st.cur = store.get('job') || HARVEST[0].key;
{
  const h = location.hash.slice(1);
  if (PAGES.includes(h)) st.page = h; else if (getJob(h)) st.cur = h;
}
if (!getJob(st.cur)) st.cur = HARVEST[0].key;
const job = () => getJob(st.cur);
const subOf = j => {
  const s = store.get('sub.' + j.key) || (store.get('view.' + j.key) === 'rec' ? 'rec' : null);
  const allowed = j.type === 'craft' ? ['rec', 'plan'] : ['res', 'rec', 'plan', 'prices', 'equip'];
  return allowed.includes(s) ? s : allowed[0];
};

function go(p, k) {
  if (k && getJob(k)) { st.cur = k; store.set('job', k); }
  if (p) st.page = p;
  history.replaceState(null, '', '#' + (st.page === 'metiers' ? st.cur : st.page));
  renderAll();
}

$('#mainnav').addEventListener('click', e => {
  const b = e.target.closest('[data-page]');
  if (b) go(b.dataset.page);
});

// ---------------------------------------------------------------- onglets métiers + artisanat
const tabs = $('#tabs'), ddBtn = $('#dd-btn'), ddMenu = $('#dd-menu');
tabs.addEventListener('click', e => {
  const pin = e.target.closest('[data-unpin]');
  if (pin) { e.stopPropagation(); togglePin(pin.dataset.unpin); return; }
  const b = e.target.closest('.tab');
  if (b) go(st.page === 'rentabilite' ? 'metiers' : null, b.dataset.k);
});
function togglePin(k) {
  const p = pins();
  setPins(p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  renderTabs(); changed();
}
function renderTabs() {
  const p = pins();
  const harvestOnly = st.page === 'session';
  const shown = ALL.filter(j => j.type === 'harvest' || (!harvestOnly && (p.includes(j.key) || j.key === st.cur)));
  const idx = Object.fromEntries(ALL.map((j, i) => [j.key, i]));
  const lv = k => levelOf(k) ?? -1;
  shown.sort((a, b) => lv(b.key) - lv(a.key) || idx[a.key] - idx[b.key]);
  tabs.innerHTML = shown.map(j => {
    const v = levelOf(j.key);
    const tmp = j.type === 'craft' && !p.includes(j.key);
    return `<button class="tab ${j.type === 'craft' ? 'craft' : ''} ${tmp ? 'tmp' : ''}" role="tab" data-k="${j.key}" style="--c:${j.color}" aria-selected="${j.key === st.cur}">
      <img src="${j.icon}" alt="">${esc(j.label)}${v !== null ? `<span class="tlvl">${v}</span>` : ''}
      ${j.type === 'craft' ? `<span class="pinx" data-unpin="${j.key}" title="${tmp ? 'Épingler en onglet' : 'Retirer des onglets'}">${tmp ? '📌' : '×'}</span>` : ''}
    </button>`;
  }).join('');
  $('#crafts-dd').hidden = harvestOnly;
  ddMenu.innerHTML = CRAFTS.map(c => {
    const v = levelOf(c.key);
    return `<div class="dd-item ${c.key === st.cur ? 'on' : ''}" data-k="${c.key}" style="--c:${c.color}">
      <img src="${c.icon}" alt=""><span>${esc(c.label)}</span>${v !== null ? `<span class="tlvl">${v}</span>` : ''}
      <button type="button" class="pinb ${p.includes(c.key) ? 'on' : ''}" data-pin="${c.key}" title="${p.includes(c.key) ? 'Retirer des onglets' : 'Épingler en onglet'}">📌</button>
    </div>`;
  }).join('');
}
ddBtn.addEventListener('click', e => { e.stopPropagation(); ddMenu.hidden = !ddMenu.hidden; ddBtn.setAttribute('aria-expanded', !ddMenu.hidden); });
ddMenu.addEventListener('click', e => {
  e.stopPropagation();
  const pb = e.target.closest('[data-pin]');
  if (pb) { togglePin(pb.dataset.pin); return; }
  const it = e.target.closest('.dd-item');
  if (it) { ddMenu.hidden = true; go('metiers', it.dataset.k); }
});
document.addEventListener('click', () => { ddMenu.hidden = true; });

// ================================================================ rendu global
function renderAll() {
  const j = job();
  document.documentElement.style.setProperty('--c', st.page === 'metiers' || st.page === 'session' ? j.color : '#e6b84a');
  $('#mainnav').querySelectorAll('[data-page]').forEach(b => b.setAttribute('aria-current', b.dataset.page === st.page ? 'page' : 'false'));
  PAGES.forEach(p => { $('#page-' + p).hidden = p !== st.page; });
  $('#jobbar').hidden = st.page === 'rentabilite';
  if (st.page === 'session' && j.type !== 'harvest') { st.cur = HARVEST.slice().sort((a, b) => (levelOf(b.key) ?? -1) - (levelOf(a.key) ?? -1))[0].key; }
  renderTabs();
  renderPage();
}
function renderPage() {
  if (st.page === 'metiers') renderMetiers();
  else if (st.page === 'rentabilite') renderProfit();
  else renderSession();
  renderSide();
}

// ================================================================ API (auth.js, import.js)
window.waktool = {
  getState() {
    const levels = {}, progress = {};
    ALL.forEach(j => {
      const v = levelOf(j.key);
      if (v !== null) levels[j.key] = v;
      const xp = store.get('xp.' + j.key), tg = store.get('target.' + j.key), o = {};
      if (xp !== null && xp !== '') o.xp = +xp;
      if (tg !== null && tg !== '') o.target = +tg;
      if (j.type === 'harvest' && store.get('bonus.' + j.key)) o.bonus = bjob(j.key);
      if (Object.keys(o).length) progress[j.key] = o;
    });
    return { levels, progress, prices: PRICES(),
      prefs: { only: only.checked, bonuses: bg(), theme: curTheme(), pins: pins(), sessions: jget('sessions', []) || [] } };
  },
  applyState(s) {
    if (s.prices && typeof s.prices === 'object') {
      const all = PRICES();
      for (const [id, v] of Object.entries(s.prices)) if (Array.isArray(v) && (!all[id] || v[1] > all[id][1])) all[id] = v;
      store.set('prices', JSON.stringify(all));
    }
    const pf = s.prefs || {};
    if (Array.isArray(pf.pins)) setPins(pf.pins.filter(k => CRAFTS.some(c => c.key === k)));
    if (Array.isArray(pf.sessions)) {
      const mine = jget('sessions', []) || [], seen = new Set(mine.map(h => h.t));
      store.set('sessions', JSON.stringify([...mine, ...pf.sessions.filter(h => !seen.has(h.t))].sort((a, b) => a.t - b.t).slice(-100)));
    }
    ALL.forEach(j => {
      const v = s.levels && s.levels[j.key];
      if (v !== undefined && v !== null) store.set(lvlKey(j.key), String(v));
    });
    if (typeof pf.only === 'boolean') { only.checked = pf.only; store.set('only', pf.only ? '1' : '0'); }
    if (THEMES[pf.theme]) { store.set('theme', pf.theme); applyTheme(pf.theme); }
    if (pf.bonuses && typeof pf.bonuses === 'object') sj.set('bonus.global', { ...G_DEF, ...pf.bonuses });
    Object.entries(s.progress || {}).forEach(([k, o]) => {
      if (o && typeof o.xp === 'number') store.set('xp.' + k, String(o.xp));
      if (o && typeof o.target === 'number') store.set('target.' + k, String(o.target));
      if (o && o.bonus && typeof o.bonus === 'object') sj.set('bonus.' + k, { ...J_DEF, ...o.bonus });
    });
    renderAll();
  },
  setLevels(levels) { this.applyState({ levels }); changed(); },
  onChange(f) { listeners.push(f); },
  jobs: () => ALL.map(j => ({ key: j.key, label: j.label, icon: j.icon, type: j.type })),
  setPrices(map) { setPrices(map); renderPage(); if (st.page === 'metiers') renderJobCard(job()); changed(); },
  price,
  allItems,
};

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (PAGES.includes(h) && h !== st.page) go(h);
  else if (getJob(h) && (h !== st.cur || st.page !== 'metiers')) go('metiers', h);
});
renderAll();
if (sess().start) $('#live-dot').hidden = false;

export { THEMES, themeBtn, applyTheme, curTheme, installEvt, installBtn, PAGES, job, subOf, go, tabs, ddBtn, ddMenu, togglePin, renderTabs, renderAll, renderPage };
