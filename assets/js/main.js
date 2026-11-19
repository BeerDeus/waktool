// Waktool — module main
import { st } from './state.js?v=30e09915';
import { $, changed, esc, icon, jget, listeners, sj, store } from './util.js?v=30e09915';
import { ALL, CRAFTS, G_DEF, HARVEST, J_DEF, PRICES, allItems, bg, bjob, getJob, levelOf, lvlKey, pins, price, progAt, setPins, setPrices, touchProg } from './model.js?v=30e09915';
import { renderSide } from './side.js?v=30e09915';
import { only, xponly, renderJobCard, renderMetiers } from './metiers.js?v=30e09915';
import { renderProfit } from './profit.js?v=30e09915';
import { renderZones } from './zones.js?v=30e09915';
import { goal, bag, renderObjectif, goalCtx, goalGuide } from './goal.js?v=30e09915';
import { feed as chatFeed } from './chatlog.js?v=30e09915';
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
const PAGES = ['metiers', 'rentabilite', 'zones', 'objectif'];
st.cur = store.get('job') || HARVEST[0].key;
{
  const h = location.hash.slice(1) === 'session' ? 'objectif' : location.hash.slice(1); // ancienne page Session
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
  const shown = ALL.filter(j => j.type === 'harvest' || p.includes(j.key) || j.key === st.cur);
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
  document.documentElement.style.setProperty('--c', st.page === 'metiers' ? j.color : '#e6b84a');
  $('#mainnav').querySelectorAll('[data-page]').forEach(b => b.setAttribute('aria-current', b.dataset.page === st.page ? 'page' : 'false'));
  PAGES.forEach(p => { $('#page-' + p).hidden = p !== st.page; });
  if (st.page !== 'objectif') document.body.classList.remove('obj-compact');
  $('#jobbar').hidden = st.page !== 'metiers';
  renderTabs();
  renderPage();
}
function renderPage() {
  if (st.page === 'metiers') renderMetiers();
  else if (st.page === 'rentabilite') renderProfit();
  else if (st.page === 'zones') renderZones();
  else renderObjectif();
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
      if (progAt(j.key)) o.at = progAt(j.key);
      if (j.type === 'harvest' && store.get('bonus.' + j.key)) o.bonus = bjob(j.key);
      if (Object.keys(o).length) progress[j.key] = o;
    });
    return { levels, progress, prices: PRICES(), phist: jget('phist', {}) || {},
      prefs: { only: only.checked, xponly: xponly.checked, bonuses: bg(), theme: curTheme(), pins: pins(), goal: goal(), stock: bag() } };
  },
  applyState(s) {
    if (s.phist && typeof s.phist === 'object') {
    // union des historiques par date
    const mine = jget('phist', {}) || {};
    for (const [id, h] of Object.entries(s.phist)) {
      if (!Array.isArray(h)) continue;
      const m = new Map();
      [mine[id] || [], h].forEach(a => { for (let i = 0; i + 1 < a.length; i += 2) m.set(a[i], a[i + 1]); });
      mine[id] = [...m.entries()].sort((x, y) => x[0] - y[0]).slice(-30).flat();
    }
    store.set('phist', JSON.stringify(mine));
  }
  if (s.prices && typeof s.prices === 'object') {
      const all = PRICES();
      for (const [id, v] of Object.entries(s.prices)) if (Array.isArray(v) && (!all[id] || v[1] > all[id][1])) all[id] = v;
      store.set('prices', JSON.stringify(all));
    }
    const pf = s.prefs || {};
    if (Array.isArray(pf.pins)) setPins(pf.pins.filter(k => CRAFTS.some(c => c.key === k)));
    // objectif et sac : le plus récent gagne (le sac change en direct pendant le jeu)
    if (pf.goal && typeof pf.goal === 'object' && (pf.goal.t || 0) > (goal().t || 0)) store.set('goal', JSON.stringify(pf.goal));
    if (pf.stock && pf.stock.items && typeof pf.stock.items === 'object' && (pf.stock.t || 0) > bag().t) store.set('stock', JSON.stringify(pf.stock));
    // progression venue d'un autre appareil : prise seulement si elle est au moins aussi récente que la nôtre
    // (sans date : seulement si on n'en a pas non plus) — évite qu'un vieux journal ou un vieux compte écrase un niveau plus récent
    const newer = {};
    ALL.forEach(j => { const r = ((s.progress || {})[j.key] || {}).at; newer[j.key] = r ? r >= progAt(j.key) : !progAt(j.key); });
    ALL.forEach(j => {
      const v = s.levels && s.levels[j.key];
      if (v !== undefined && v !== null && newer[j.key]) store.set(lvlKey(j.key), String(v));
    });
    if (typeof pf.only === 'boolean') { only.checked = pf.only; store.set('only', pf.only ? '1' : '0'); }
    if (typeof pf.xponly === 'boolean') { xponly.checked = pf.xponly; store.set('xponly', pf.xponly ? '1' : '0'); }
    if (THEMES[pf.theme]) { store.set('theme', pf.theme); applyTheme(pf.theme); }
    if (pf.bonuses && typeof pf.bonuses === 'object') sj.set('bonus.global', { ...G_DEF, ...pf.bonuses });
    Object.entries(s.progress || {}).forEach(([k, o]) => {
      if (o && typeof o.xp === 'number' && newer[k] !== false) store.set('xp.' + k, String(o.xp));
      if (o && typeof o.at === 'number' && o.at > progAt(k)) touchProg(k, o.at);
      if (o && typeof o.target === 'number') store.set('target.' + k, String(o.target));
      if (o && o.bonus && typeof o.bonus === 'object') sj.set('bonus.' + k, { ...J_DEF, ...o.bonus });
    });
    renderAll();
  },
  // niveaux saisis par l'utilisateur (import de capture) : l'XP actuelle repart de 0 pour chaque niveau qui change
  setLevels(levels) {
    for (const [k, v] of Object.entries(levels)) {
      if (levelOf(k) !== +v) store.set('xp.' + k, '0');
      store.set(lvlKey(k), String(v)); touchProg(k);
    }
    renderAll(); changed();
  },
  setXp(key, xp) { store.set('xp.' + key, String(xp)); touchProg(key); renderAll(); changed(); },
  onChange(f) { listeners.push(f); },
  jobs: () => ALL.map(j => ({ key: j.key, label: j.label, icon: j.icon, type: j.type })),
  setPrices(map) { setPrices(map); renderPage(); if (st.page === 'metiers') renderJobCard(job()); changed(); },
  price,
  allItems,
  // lignes du journal du chat (tests, ou collage manuel)
  // prochaine action de l'assistant d'objectif (tests)
  goalGuide() {
    const g = goalGuide(goalCtx());
    return { kind: g.kind, key: g.key, N: g.N, ready: g.ready, next: g.next && g.next.item.name,
      ing: (g.ing || []).map(o => ({ name: o.item.name, have: o.have, need: o.need, ok: o.ok })) };
  },
  chatFeed(lines, first = false, mod = Date.now()) { chatFeed(typeof lines === 'string' ? lines.split(/\r?\n/) : lines, first, mod); },
};

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (PAGES.includes(h) && h !== st.page) go(h);
  else if (getJob(h) && (h !== st.cur || st.page !== 'metiers')) go('metiers', h);
  else if (h === 'session') go('objectif');
});
renderAll();

export { THEMES, themeBtn, applyTheme, curTheme, installEvt, installBtn, PAGES, job, subOf, go, tabs, ddBtn, ddMenu, togglePin, renderTabs, renderAll, renderPage };
