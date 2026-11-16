(() => {
  const D = window.WAKFU_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem('waktool.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('waktool.' + k, v); } catch { /* ignore */ } },
  };
  const sj = {
    get(k, d) { try { return { ...d, ...(JSON.parse(store.get(k)) || {}) }; } catch { return { ...d }; } },
    set(k, v) { store.set(k, JSON.stringify(v)); },
  };
  const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v ?? d; } catch { return d; } };
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmt = n => Math.round(n).toLocaleString('fr-FR');
  const fmt1 = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const fmtDur = s => {
    if (!isFinite(s)) return '∞';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  };
  const clock = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const sec = d => (Math.round(d * 10 + 1e-6) / 10).toFixed(1).replace('.', ',');
  const fmtK = n => (Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' M'
    : Math.abs(n) >= 1e4 ? Math.round(n / 1e3).toLocaleString('fr-FR') + ' k' : fmt(n)) + ' ₭';
  const ago = ts => { const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? 'aujourd’hui' : d === 1 ? 'hier' : `il y a ${d} j`; };
  const icon = (it, cls = '') => it && it.icon
    ? `<img src="${it.icon}" alt="" loading="lazy" class="${cls}" title="${esc(it.name)}">`
    : `<span class="noimg ${cls}"></span>`;

  $('#ver').textContent = D.version ? `v${D.version}` : '';
  const listeners = [];
  const changed = () => listeners.forEach(f => f());

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

  // ================================================================ modèle XP
  // XP pour passer de n à n+1 : 150n + 75 (total pour atteindre t : 75t²).
  // XP de base d'une action : 150 (rare : ×10 Herboriste, ×4 Trappeur), quel que soit le niveau de la ressource.
  // Écart > 10 niveaux : courbe en cosinus arrondie à 2,5 % (97,5 / 90 / 80 / 65 / 50 / 35 / 20 / 10 / 2,5), 0 dès 20.
  // XP affichée = ⌈⌊base × baisse⌋ × (1 + bonus)⌉, bonus en float32 — vérifié sur 7 valeurs en jeu (bonus 30 %).
  const XP = {
    base: 150,
    confirmed: ['herboriste', 'trappeur'],
    rare: { herboriste: 10, trappeur: 4 },
    need: n => 150 * n + 75,
    total: t => 75 * t * t,
    mult(diff) {
      if (diff <= 10) return 1;
      if (diff >= 20) return 0;
      return Math.round((1 + Math.cos(Math.PI * (diff - 10) / 10)) / 2 * 40) / 40;
    },
    per(diff, bonus, base = 150) {
      return Math.ceil(Math.floor(base * this.mult(diff)) * (1 + Math.fround(bonus / 100)));
    },
    // durée d'une action : 3 s (6 s mineur/pêcheur) − 0,05 s (0,1 s) par niveau au-dessus, min 1,5 s (3 s)
    duration(job, diff) {
      const slow = job === 'mineur' || job === 'pecheur';
      return slow ? Math.max(3, 6 - 0.1 * diff) : Math.max(1.5, 3 - 0.05 * diff);
    },
  };

  // ================================================================ prix HDV (kamas / unité), par id d'objet
  const PRICES = () => jget('prices', {}) || {};
  const price = id => { const p = PRICES()[id]; return p ? p[0] : null; };
  function setPrices(map) {
    const all = PRICES(), now = Date.now();
    for (const [id, v] of Object.entries(map)) {
      if (v === null || v === '' || isNaN(+v) || +v <= 0) delete all[id]; else all[id] = [Math.round(+v), now];
    }
    store.set('prices', JSON.stringify(all));
  }
  const priceInput = (it, cls = '') => {
    const P = PRICES()[it.id];
    return `<span class="pin-price ${cls}"><input type="number" min="0" inputmode="numeric" data-price="${it.id}" value="${P ? P[0] : ''}" placeholder="prix"><i>₭</i></span>`;
  };

  // ================================================================ métiers
  D.jobs.forEach(j => { j.type = 'harvest'; });
  const CRAFTS = (window.WAKFU_CRAFTS || []).map(c => ({ ...c, type: 'craft' }));
  const ALL = [...D.jobs, ...CRAFTS];
  const HARVEST = D.jobs;
  const getJob = k => ALL.find(j => j.key === k);
  const lvlKey = k => 'lvl.' + k;
  const levelOf = k => { const v = store.get(lvlKey(k)); return v === null || v === '' || isNaN(+v) ? null : +v; };
  const xpOf = k => Math.max(0, +(store.get('xp.' + k) || 0));
  const pins = () => jget('pins', []) || [];
  const setPins = a => store.set('pins', JSON.stringify(a));

  // ================================================================ bonus
  const G_DEF = { region: null, temp: null, climMalus: 50, havre: false, stasis: 0, turbo: false, xpExtra: 0, speed: 0,
    sceau: false, potion: false, pacte: 0, mdc: 0, captchat: 0, qtyExtra: 0 };
  const J_DEF = { tool: 'auto', pet: '', petLvl: 50, conso: false, casque: false, sacs: 0, gateau: false };
  const REGION = [
    { v: -10, stars: 0, img: 'img/ui/region-0.png', label: 'Aucune volonté respectée' },
    { v: 10, stars: 1, img: 'img/ui/region-1.png', label: 'Volontés partiellement respectées' },
    { v: 30, stars: 2, img: 'img/ui/region-2.png', label: 'Toutes les volontés respectées' },
  ];
  const bg = () => sj.get('bonus.global', G_DEF);
  const bjob = k => sj.get('bonus.' + k, J_DEF);
  function bonusXp() {
    const g = bg();
    return (g.region ?? 0) + (g.havre ? 10 : 0) + (+g.stasis || 0) + (g.turbo ? 100 : 0) + (+g.xpExtra || 0);
  }
  const speedMult = () => 1 + (+bg().speed || 0) / 100;
  // météo : hors de la plage de température idéale de la plante, les actions sont ralenties
  // (Paysan / Forestier / Herboriste ; ampleur réglable, non publiée par Ankama)
  function climate(r) {
    const t = bg().temp;
    if (!r || !r.temp || t === null || t === '' || isNaN(+t)) return null;
    return +t < r.temp[0] ? 'cold' : +t > r.temp[1] ? 'hot' : 'ok';
  }
  const climK = r => (['hot', 'cold'].includes(climate(r)) ? 1 + (+bg().climMalus || 0) / 100 : 1);
  const dur = (job, diff, r) => XP.duration(job, diff) * climK(r) / speedMult();

  function activeTool(j, b, lv) {
    if (b.tool === 'none') return null;
    if (b.tool === 'auto') return lv === null ? null : j.tools.filter(t => t.level <= lv).pop() || null;
    return j.tools.find(t => t.name === b.tool) || null;
  }
  function qtyParts(j) {
    const g = bg(), b = bjob(j.key), parts = [];
    const t = activeTool(j, b, levelOf(j.key));
    if (t) parts.push([t.name, t.bonus]);
    const pl = Math.max(1, Math.min(50, +b.petLvl || 1));
    if (b.pet === 'job') parts.push([`${j.pet.name} niv. ${pl}`, +(10 + 0.8 * pl).toFixed(1)]);
    if (b.pet === 'noxine') parts.push([`Noxine niv. ${pl}`, +(5 + 0.4 * pl).toFixed(1)]);
    if (b.conso) parts.push([j.consumable.name, 15]);
    if (b.casque && j.key === 'mineur') parts.push(['Casque de la Mine', 25]);
    if (b.sacs && (j.key === 'mineur' || j.key === 'trappeur')) parts.push([`${j.key === 'mineur' ? 'Sac du Greuvard' : 'Sac à Pipi'} ×${b.sacs}`, 10 * b.sacs]);
    if (b.gateau && j.key === 'paysan') parts.push(['Gâteau de riz', 15]);
    if (g.sceau) parts.push(['Sceau des Compagnons', 50]);
    if (g.potion) parts.push(['Potion de récolte', 50]);
    if (+g.pacte) parts.push([+g.pacte === 25 ? 'Pacte prudent' : 'Pacte opportuniste', +g.pacte]);
    if (+g.qtyExtra) parts.push(['Autre', +g.qtyExtra]);
    if (+g.captchat) parts.push([`Malédiction Capt'chat ×${g.captchat}`, -33 * g.captchat]);
    return parts;
  }
  // quantité par récolte : jet 1–3 (1–4 si ressource en surplus vs volontés) × (1 + bonus)
  function qtyStats(j) {
    const pct = qtyParts(j).reduce((a, p) => a + p[1], 0);
    const k = Math.max(0, 1 + pct / 100);
    const maxRoll = +bg().mdc === 33 ? 4 : 3;
    return { pct, min: Math.floor(k), max: Math.ceil(maxRoll * k), avg: (1 + maxRoll) / 2 * k };
  }

  // meilleure ressource pour l'XP (pleine XP, puis action la plus rapide) au niveau L
  function bestAt(j, L) {
    const ok = j.resources.filter(r => r.level <= L);
    if (!ok.length) return null;
    return ok.reduce((b, r) => {
      const m = XP.mult(L - r.level), d = dur(j.key, L - r.level, r);
      return !b || m / d > b.rate ? { r, m, d, rate: m / d } : b;
    }, null);
  }
  // XP à gagner -> niveau atteint
  function addXp(level, xp, gain) {
    let L = level, x = xp + gain;
    while (x >= XP.need(L) && L < 250) { x -= XP.need(L); L++; }
    return { level: L, xp: Math.floor(x) };
  }

  // ================================================================ recettes (chargées à la demande)
  const RARITY = { 0: ['Commun', '#9aa5ad'], 1: ['Commun', '#9aa5ad'], 2: ['Rare', '#4fb36b'], 3: ['Mythique', '#e08a2c'],
    4: ['Légendaire', '#e6c229'], 5: ['Relique', '#a66be0'], 6: ['Souvenir', '#5fb3e6'], 7: ['Épique', '#e05fae'] };
  const RD = {}, RP = {};
  function loadRecipes(key) {
    RP[key] ||= fetch(`data/recipes/${key}.json?v=${window.WAKFU_RECIPES_V || ''}`).then(r => r.json()).then(d => {
      const items = {};
      for (const [id, a] of Object.entries(d.items)) items[id] = { id: +id, name: a[0], icon: a[1], level: a[2], rarity: a[3], src: a[4], prod: a[5] };
      const recipes = d.recipes.map(([id, level, xp, up, res, ing]) => ({
        id, level, xp, up: !!up, res: { item: items[res[0]], qty: res[1] }, ing: ing.map(([i, n]) => ({ item: items[i], qty: n })),
      }));
      return (RD[key] = { items, recipes });
    });
    return RP[key];
  }
  // renvoie les recettes si déjà chargées, sinon lance le chargement et re-rend la page à l'arrivée
  function needRecipes(key) {
    if (RD[key]) return RD[key];
    loadRecipes(key).then(() => renderPage());
    return null;
  }
  const srcLabel = src => { const [k, l] = src.split(':'); const j = getJob(k); return j ? `${j.label} ${l}` : src; };
  const prodLabel = prod => prod.map(k => (getJob(k) || { label: k }).label).join(', ');
  function resOfItem(j, id) {
    j._byItem ||= (() => {
      const m = {};
      j.resources.forEach(r => ['normal', 'rare', 'seed'].forEach(k => (r[k] || []).forEach(it => { if (it.id) m[it.id] ??= r; })));
      return m;
    })();
    return j._byItem[id] || null;
  }
  let allItemsP = null;
  function allItems() {
    allItemsP ||= Promise.all(ALL.map(j => loadRecipes(j.key))).then(list => {
      const m = new Map();
      HARVEST.forEach(j => j.resources.forEach(r => ['normal', 'rare', 'seed'].forEach(k => (r[k] || []).forEach(it => it.id && m.set(it.id, { id: it.id, name: it.name, icon: it.icon })))));
      list.forEach(d => Object.values(d.items).forEach(it => m.has(it.id) || m.set(it.id, { id: it.id, name: it.name, icon: it.icon })));
      return [...m.values()];
    });
    return allItemsP;
  }

  // ================================================================ calculs : plans, rentabilité
  const addTo = (map, key, n, extra) => { const o = map.get(key) || { n: 0, ...extra }; o.n += n; map.set(key, o); };

  // un cycle « récolter les ingrédients puis crafter » pour une recette d'un métier de récolte au niveau L
  function craftCycle(j, r, L, qAvg, bonus) {
    if (r.up || r.level > L || !r.ing.length) return null;
    const m = XP.mult(L - r.level);
    if (!m) return null;
    let cx = Math.floor(r.xp * m), ct = 0;
    const parts = [];
    for (const i of r.ing) {
      const rr = resOfItem(j, i.item.id);
      if (!rr || rr.level > L) return null;
      const a = i.qty / qAvg, d = dur(j.key, L - rr.level, rr);
      cx += a * XP.per(L - rr.level, bonus); ct += a * d;
      parts.push({ rr, a, item: i.item, qty: i.qty });
    }
    return ct ? { r, cx, ct, parts } : null;
  }

  // métier de récolte : récolte seule ou récolte + craft
  function harvestPlan(j, from, xp0, to, strat) {
    const data = strat === 'craft' ? RD[j.key] : null;
    const qAvg = qtyStats(j).avg || 1, bonus = bonusXp();
    const res = new Map(), crafts = new Map();
    let actions = 0, time = 0, xpTotal = 0;
    for (let L = from; L < to; L++) {
      const need = Math.max(0, XP.need(L) - (L === from ? xp0 : 0));
      xpTotal += need;
      const b = bestAt(j, L);
      if (!b || !b.m) return { actions: Infinity, time: Infinity, xp: XP.total(to) - XP.total(from) - xp0, res, crafts };
      let best = { rate: XP.per(L - b.r.level, bonus) / b.d, kind: 'h' };
      if (data) for (const r of data.recipes) {
        const c = craftCycle(j, r, L, qAvg, bonus);
        if (c && c.cx / c.ct > best.rate) best = { rate: c.cx / c.ct, kind: 'c', ...c };
      }
      if (best.kind === 'h') {
        const n = Math.ceil(need / XP.per(L - b.r.level, bonus));
        actions += n; time += n * b.d;
        addTo(res, b.r.name, n, { r: b.r, items: 0 });
        res.get(b.r.name).items += n * qAvg;
      } else {
        const cycles = need / best.cx;
        time += cycles * best.ct;
        addTo(crafts, best.r.id, cycles, { r: best.r });
        for (const pt of best.parts) {
          actions += cycles * pt.a;
          addTo(res, pt.rr.name, cycles * pt.a, { r: pt.rr, items: 0 });
          res.get(pt.rr.name).items += cycles * pt.qty;
        }
      }
    }
    return { actions: Math.ceil(actions), time, xp: xpTotal, res, crafts };
  }

  // métier d'artisanat : recette la plus intéressante à chaque niveau
  function craftPlan(j, from, xp0, to, metric, withUp) {
    const data = RD[j.key];
    const crafts = new Map(), ing = new Map();
    let n = 0, xpTotal = 0;
    for (let L = from; L < to; L++) {
      const need = Math.max(0, XP.need(L) - (L === from ? xp0 : 0));
      xpTotal += need;
      let best = null;
      for (const r of data.recipes) {
        if (r.level > L || (r.up && !withUp) || !r.ing.length) continue;
        const x = Math.floor(r.xp * XP.mult(L - r.level));
        if (!x) continue;
        let cost = 1;
        if (metric === 'ing') cost = r.ing.reduce((a, i) => a + i.qty, 0);
        if (metric === 'kamas') {
          cost = 0;
          for (const i of r.ing) { const p = price(i.item.id); if (!p) { cost = Infinity; break; } cost += p * i.qty; }
        }
        const score = x / cost;
        if (score > 0 && (!best || score > best.score || (score === best.score && x > best.x))) best = { r, x, score };
      }
      if (!best) return { crafts, ing, n: Infinity, xp: xpTotal };
      const c = Math.ceil(need / best.x);
      n += c;
      addTo(crafts, best.r.id, c, { r: best.r });
      best.r.ing.forEach(i => addTo(ing, i.item.id, c * i.qty, { item: i.item }));
    }
    return { crafts, ing, n, xp: xpTotal };
  }

  // rentabilité d'un métier de récolte : une ligne par (ressource, produit) + transformations
  function profitRows(j, opts) {
    const L = levelOf(j.key);
    if (L === null && opts.access) return [];
    const q = qtyStats(j).avg, bonus = bonusXp(), rows = [];
    for (const r of j.resources) {
      if (L !== null && r.level > L && opts.access) continue;
      const diff = L === null ? 0 : Math.max(0, L - r.level);
      const d = dur(j.key, diff, r), aph = 3600 / d;
      const xph = L === null || r.level > L ? 0 : aph * XP.per(diff, bonus);
      const prods = [...(r.normal || []).map(it => [it, 'récolte']), ...(r.seed || []).map(it => [it, j.key === 'forestier' ? 'bouture' : 'graine'])];
      for (const [it, kind] of prods) {
        if (!it || !it.id) continue;
        const p = price(it.id);
        rows.push({ j, r, it, kind, d, qph: aph * q, xph, p, kph: p ? aph * q * p : null, locked: L !== null && r.level > L });
      }
    }
    if (opts.craft && RD[j.key] && L !== null) {
      for (const rec of RD[j.key].recipes) {
        const c = craftCycle(j, rec, L, q, bonus);
        if (!c) continue;
        const p = price(rec.res.item.id);
        const cph = 3600 / c.ct; // crafts / heure
        rows.push({ j, r: c.parts[0].rr, it: rec.res.item, kind: 'transformé', rec, d: c.ct, qph: cph * rec.res.qty, xph: cph * c.cx, p,
          kph: p ? cph * rec.res.qty * p : null, parts: c.parts });
      }
    }
    return rows;
  }

  // ================================================================ état / navigation
  const PAGES = ['metiers', 'rentabilite', 'session'];
  let page = 'metiers';
  let cur = store.get('job') || HARVEST[0].key;
  {
    const h = location.hash.slice(1);
    if (PAGES.includes(h)) page = h; else if (getJob(h)) cur = h;
  }
  if (!getJob(cur)) cur = HARVEST[0].key;
  const job = () => getJob(cur);
  const subOf = j => {
    const s = store.get('sub.' + j.key) || (store.get('view.' + j.key) === 'rec' ? 'rec' : null);
    const allowed = j.type === 'craft' ? ['rec', 'plan'] : ['res', 'rec', 'plan', 'prices', 'equip'];
    return allowed.includes(s) ? s : allowed[0];
  };

  function go(p, k) {
    if (k && getJob(k)) { cur = k; store.set('job', k); }
    if (p) page = p;
    history.replaceState(null, '', '#' + (page === 'metiers' ? cur : page));
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
    if (b) go(page === 'rentabilite' ? 'metiers' : null, b.dataset.k);
  });
  function togglePin(k) {
    const p = pins();
    setPins(p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
    renderTabs(); changed();
  }
  function renderTabs() {
    const p = pins();
    const harvestOnly = page === 'session';
    const shown = ALL.filter(j => j.type === 'harvest' || (!harvestOnly && (p.includes(j.key) || j.key === cur)));
    const idx = Object.fromEntries(ALL.map((j, i) => [j.key, i]));
    const lv = k => levelOf(k) ?? -1;
    shown.sort((a, b) => lv(b.key) - lv(a.key) || idx[a.key] - idx[b.key]);
    tabs.innerHTML = shown.map(j => {
      const v = levelOf(j.key);
      const tmp = j.type === 'craft' && !p.includes(j.key);
      return `<button class="tab ${j.type === 'craft' ? 'craft' : ''} ${tmp ? 'tmp' : ''}" role="tab" data-k="${j.key}" style="--c:${j.color}" aria-selected="${j.key === cur}">
        <img src="${j.icon}" alt="">${esc(j.label)}${v !== null ? `<span class="tlvl">${v}</span>` : ''}
        ${j.type === 'craft' ? `<span class="pinx" data-unpin="${j.key}" title="${tmp ? 'Épingler en onglet' : 'Retirer des onglets'}">${tmp ? '📌' : '×'}</span>` : ''}
      </button>`;
    }).join('');
    $('#crafts-dd').hidden = harvestOnly;
    ddMenu.innerHTML = CRAFTS.map(c => {
      const v = levelOf(c.key);
      return `<div class="dd-item ${c.key === cur ? 'on' : ''}" data-k="${c.key}" style="--c:${c.color}">
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
    document.documentElement.style.setProperty('--c', page === 'metiers' || page === 'session' ? j.color : '#e6b84a');
    $('#mainnav').querySelectorAll('[data-page]').forEach(b => b.setAttribute('aria-current', b.dataset.page === page ? 'page' : 'false'));
    PAGES.forEach(p => { $('#page-' + p).hidden = p !== page; });
    $('#jobbar').hidden = page === 'rentabilite';
    if (page === 'session' && j.type !== 'harvest') { cur = HARVEST.slice().sort((a, b) => (levelOf(b.key) ?? -1) - (levelOf(a.key) ?? -1))[0].key; }
    renderTabs();
    renderPage();
  }
  function renderPage() {
    if (page === 'metiers') renderMetiers();
    else if (page === 'rentabilite') renderProfit();
    else renderSession();
    renderSide();
  }

  // ================================================================ page Métiers
  const q = $('#q'), only = $('#only');
  only.checked = store.get('only') === '1';
  q.addEventListener('input', () => renderContent());
  only.addEventListener('input', () => { store.set('only', only.checked ? '1' : '0'); renderContent(); changed(); });
  $('#rtype').value = store.get('rtype') || 'all';
  $('#rtype').addEventListener('change', () => { store.set('rtype', $('#rtype').value); recLimit = 120; renderContent(); });
  let recLimit = 120;

  function renderMetiers() {
    const j = job();
    renderJobCard(j);
    const sub = subOf(j);
    const SUBS = j.type === 'craft'
      ? [['rec', 'Recettes'], ['plan', 'Plan de montée']]
      : [['res', 'Ressources'], ['rec', 'Recettes'], ['plan', 'Plan de montée'], ['prices', 'Prix HDV'], ['equip', 'Équipement']];
    $('#subtabs').innerHTML = SUBS.map(([k, l]) => `<button type="button" role="tab" data-sub="${k}" aria-selected="${k === sub}">${l}</button>`).join('');
    const listy = sub === 'res' || sub === 'rec';
    $('#filters').hidden = !listy;
    $('#rtype').hidden = !(sub === 'rec' && j.type === 'craft');
    $('#only-lbl').textContent = sub === 'rec' ? 'Faisables seulement' : 'Accessibles seulement';
    q.placeholder = sub === 'rec' ? 'Rechercher une recette, un ingrédient…' : 'Rechercher une ressource, une zone, un objet…';
    renderContent();
  }
  $('#subtabs').addEventListener('click', e => {
    const b = e.target.closest('[data-sub]');
    if (!b) return;
    store.set('sub.' + cur, b.dataset.sub); recLimit = 120; renderMetiers();
  });

  // carte d'en-tête : niveau, XP, objectif, barre, chiffres clés
  function targetOf(j, L) { return +(store.get('target.' + j.key) || 0) || Math.min(200, (Math.floor((L ?? 0) / 10) + 1) * 10); }
  function renderJobCard(j) {
    const L = levelOf(j.key), p = pins();
    const info = j.type === 'craft'
      ? `${fmt(j.count)} recettes · niv. 0 → ${j.max} · artisanat`
      : `${j.resources.length} ${j.key === 'trappeur' ? 'familles de monstres' : 'ressources'} · niv. 0 → ${Math.max(...j.resources.map(r => r.level))}`;
    let stats = '';
    if (L !== null) {
      const need = XP.need(L), xp = Math.min(xpOf(j.key), need - 1), tg = targetOf(j, L);
      if (j.type === 'harvest') {
        const next = harvestPlan(j, L, xp, L + 1, 'harvest');
        const goal = tg > L ? harvestPlan(j, L, xp, tg, store.get('strat.' + j.key) === 'craft' && RD[j.key] ? 'craft' : 'harvest') : null;
        const b = bestAt(j, L);
        stats = `
          <div class="kpi"><span>Niveau ${L + 1}</span><b>${fmt(need - xp)} XP</b><small>${fmt(next.actions)} récoltes · ~${fmtDur(next.time)}</small></div>
          ${goal ? `<div class="kpi"><span>Objectif ${tg}</span><b>${fmt(goal.xp)} XP</b><small>${fmt(goal.actions)} récoltes · ~${fmtDur(goal.time)}</small></div>` : ''}
          ${b ? `<div class="kpi wide"><span>Meilleure ressource XP</span><b>${esc(b.r.name)}</b><small>niv. ${b.r.level} · ${fmt(XP.per(L - b.r.level, bonusXp()))} XP en ${sec(b.d)} s</small></div>` : ''}`;
      } else {
        stats = `<div class="kpi"><span>Niveau ${L + 1}</span><b>${fmt(need - xp)} XP</b><small>voir le plan de montée</small></div>`;
      }
    }
    const need = L !== null ? XP.need(L) : 0, xp = L !== null ? Math.min(xpOf(j.key), need - 1) : 0;
    $('#job-head').innerHTML = `
      <div class="jc-id">
        <img src="${j.icon}" alt="">
        <div><h2>${esc(j.label)}${j.type === 'craft' ? ` <button type="button" class="pinb big ${p.includes(j.key) ? 'on' : ''}" data-pin-head="${j.key}" title="${p.includes(j.key) ? 'Retirer des onglets' : 'Épingler en onglet'}">📌</button>` : ''}</h2>
        <p>${info}</p></div>
      </div>
      <div class="jc-in">
        <label>Niveau<input type="number" min="0" max="250" data-jc="lvl" value="${L ?? ''}" placeholder="—"></label>
        <label>XP actuelle<input type="number" min="0" data-jc="xp" value="${esc(store.get('xp.' + j.key) || '')}" placeholder="0"></label>
        <label>Objectif<input type="number" min="1" max="250" data-jc="target" value="${esc(store.get('target.' + j.key) || '')}" placeholder="${L !== null ? targetOf(j, L) : 'auto'}"></label>
      </div>
      ${L !== null ? `<div class="pbar"><span style="width:${(xp / need * 100).toFixed(1)}%"></span><em>Niv. ${L} · ${fmt(xp)} / ${fmt(need)} XP</em></div>
      <div class="kpis">${stats}</div>` : '<p class="meta jc-hint">Renseigne ton niveau (ou colle une capture de la fenêtre Métiers avec <kbd>Ctrl</kbd>+<kbd>V</kbd>) pour voir l’XP, les plans et la rentabilité.</p>'}`;
  }
  $('#job-head').addEventListener('change', e => {
    const el = e.target.closest('[data-jc]');
    if (!el) return;
    const k = { lvl: lvlKey(cur), xp: 'xp.' + cur, target: 'target.' + cur }[el.dataset.jc];
    store.set(k, el.value);
    renderTabs(); renderPage(); changed();
  });
  $('#job-head').addEventListener('click', e => {
    const b = e.target.closest('[data-pin-head]');
    if (b) { togglePin(b.dataset.pinHead); renderJobCard(job()); }
  });

  function renderContent() {
    const j = job(), sub = subOf(j), list = $('#list');
    if (sub === 'res') return renderResources(j);
    if (sub === 'rec') return renderRecipes(j);
    if (sub === 'plan') list.innerHTML = j.type === 'craft' ? craftPlanHtml(j) : harvestPlanHtml(j);
    if (sub === 'prices') list.innerHTML = pricesHtml(j);
    if (sub === 'equip') list.innerHTML = equipHtml(j);
  }

  // ---------------------------------------------------------------- ressources
  function renderResources(j) {
    const term = norm(q.value.trim()), L = levelOf(j.key);
    const rows = j.resources.filter(r => {
      if (only.checked && L !== null && r.level > L) return false;
      if (!term) return true;
      return norm([r.name, ...(r.zones || []), ...(r.zones_en || []), ...[...(r.normal || []), ...(r.rare || []), ...(r.seed || [])].map(i => i.name)].join(' ')).includes(term);
    });
    const list = $('#list');
    if (!rows.length) { list.innerHTML = '<p class="empty">Aucune ressource.</p>'; return; }
    const tpl = $('#tpl-res'), qa = qtyStats(j).avg, bonus = bonusXp();
    list.replaceChildren(...rows.map(r => {
      const n = tpl.content.firstElementChild.cloneNode(true);
      if (L !== null && r.level > L) n.classList.add('locked');
      $('.res-lvl', n).innerHTML = `<small>niv.</small>${r.level}`;
      const app = r.appearance || (r.normal && r.normal[0] && r.normal[0].icon) || (r.seed && r.seed[0] && r.seed[0].icon);
      $('.res-app', n).innerHTML = app ? `<img src="${app}" alt="${esc(r.name)}" loading="lazy">` : '';
      $('h3', n).innerHTML = esc(r.name) + (r.family_en && r.family_en !== r.name ? ` <span class="en-name">${esc(r.family_en)}</span>` : '');
      const cl = climate(r);
      if (r.temp) {
        const lbl = { ok: 'température idéale', hot: 'trop chaud : actions ralenties', cold: 'trop froid : actions ralenties' }[cl] || 'plage de température idéale';
        $('h3', n).insertAdjacentHTML('beforeend', ` <span class="temp ${cl || ''}" title="${lbl}">${cl === 'hot' ? '▲' : cl === 'cold' ? '▼' : '●'} ${r.temp[0]} à ${r.temp[1]} °C</span>`);
      }
      $('.zones', n).innerHTML = (r.zones || []).map(z => `<li>${esc(z)}</li>`).join('') +
        (r.zones_en || []).map(z => `<li class="en" title="Nom anglais (wiki), zone récente">${esc(z)} (EN)</li>`).join('') +
        (r.hint ? `<li class="en">${esc(r.hint)}</li>` : '');
      const drop = (arr, cls, lbl) => (arr || []).map(i => {
        const p = i.id && price(i.id);
        return `<span class="drop ${cls}" title="${lbl}${p ? ` · ${fmt(p)} ₭` : ''}">${icon(i)}${esc(i.name)}${p ? ` <small class="kph">${fmtK(p)}</small>` : ''}</span>`;
      }).join('');
      $('.drops', n).innerHTML = drop(r.normal, '', 'Ressource') + drop(r.rare, 'rare', 'Ressource rare') + drop(r.seed, 'seed', j.key === 'forestier' ? 'Bouture' : 'Graine');
      if (L !== null && r.level <= L) {
        const m = XP.mult(L - r.level), per = XP.per(L - r.level, bonus), d = dur(j.key, L - r.level, r);
        const x = document.createElement('div');
        x.className = 'xpline ' + (m === 1 ? 'full' : m > 0 ? 'part' : 'none');
        const main = (r.normal || [])[0], pm = main && price(main.id);
        x.innerHTML = m === 0 ? 'Plus d’XP (20 niveaux d’écart ou plus)'
          : `<b>${fmt(per)} XP</b>${m < 1 ? ` (${fmt1(m * 100)} %)` : ''} · ${sec(d)} s · <b>${fmt(3600 / d * per)}</b> XP/h`;
        if (pm) x.innerHTML += ` · <b class="kph">${fmtK(3600 / d * qa * pm)}/h</b>`;
        $('.res-body', n).append(x);
      }
      return n;
    }));
  }

  // ---------------------------------------------------------------- recettes
  function recipeCost(r) {
    let cost = 0, missing = 0;
    r.ing.forEach(i => { const p = price(i.item.id); if (p) cost += p * i.qty; else missing++; });
    return { cost, missing, value: (price(r.res.item.id) || 0) * r.res.qty };
  }
  function costHtml(r) {
    const c = recipeCost(r);
    if (!c.cost && !c.value) return '';
    const marge = c.value && !c.missing ? c.value - c.cost : null;
    return ` · <span class="kph" title="${c.missing ? c.missing + ' ingrédient(s) sans prix' : 'tous les prix connus'}">coût ${c.missing ? '≥ ' : ''}${fmtK(c.cost)}</span>` +
      (c.value ? ` · vente ${fmtK(c.value)}` : '') +
      (marge !== null ? ` · <b class="${marge >= 0 ? 'pos' : 'neg'}">${marge >= 0 ? '+' : ''}${fmtK(marge)}</b>` : '');
  }
  function ingChip(i, qty = i.qty) {
    const it = i.item;
    const tag = it.src ? `<button type="button" class="src" data-goto="${it.src.split(':')[0]}" data-q="${esc(it.name)}" title="Se récolte : ${esc(srcLabel(it.src))}">${esc(srcLabel(it.src))}</button>`
      : it.prod ? `<button type="button" class="src craft" data-goto="${it.prod[0]}" data-q="${esc(it.name)}" title="Se fabrique : ${esc(prodLabel(it.prod))}">⚒ ${esc(prodLabel(it.prod))}</button>` : '';
    const p = price(it.id);
    return `<span class="ing">${icon(it)}<b>${fmt(qty)}×</b> ${esc(it.name)}${p ? ` <small class="kph" title="${fmt(p)} ₭ / u">${fmtK(p * qty)}</small>` : ''} ${tag}</span>`;
  }
  function renderRecipes(j) {
    const list = $('#list');
    const data = needRecipes(j.key);
    if (!data) { list.innerHTML = '<p class="empty">Chargement des recettes…</p>'; return; }
    const term = norm(q.value.trim()), L = levelOf(j.key);
    const type = j.type === 'craft' ? ($('#rtype').value || 'all') : 'all';
    const rows = data.recipes.filter(r => {
      if (only.checked && L !== null && r.level > L) return false;
      if (type === 'craft' && r.up) return false;
      if (type === 'up' && !r.up) return false;
      return !term || norm([r.res.item.name, ...r.ing.map(i => i.item.name)].join(' ')).includes(term);
    });
    if (!rows.length) { list.innerHTML = '<p class="empty">Aucune recette.</p>'; return; }
    list.innerHTML = rows.slice(0, recLimit).map(r => {
      const it = r.res.item, rar = RARITY[it.rarity] || RARITY[0];
      const m = L === null ? null : XP.mult(L - r.level);
      const xpl = L === null ? `<b>${fmt(r.xp)} XP</b>` : r.level > L ? `<b>${fmt(r.xp)} XP</b> · niveau insuffisant`
        : m === 0 ? 'Plus d’XP (20 niveaux d’écart ou plus)' : `<b>${fmt(Math.floor(r.xp * m))} XP</b>${m < 1 ? ` (${fmt1(m * 100)} %)` : ''}`;
      const cls = L === null || r.level > L ? '' : m === 1 ? 'full' : m > 0 ? 'part' : 'none';
      return `<article class="res rec ${L !== null && r.level > L ? 'locked' : ''}" style="--rar:${rar[1]}">
        <div class="res-lvl"><small>niv.</small>${r.level}</div>
        <div class="rec-ico"><img src="${it.icon}" alt="" loading="lazy"></div>
        <div class="res-body">
          <h3>${esc(it.name)}${r.res.qty > 1 ? ` ×${r.res.qty}` : ''} <span class="rar">${rar[0]}</span>${r.up ? ' <span class="upg" title="Amélioration de rareté">⬆ amélioration</span>' : ''}</h3>
          <div class="ings">${r.ing.map(i => ingChip(i)).join('')}</div>
          <div class="xpline ${cls}">${xpl}${costHtml(r)}</div>
        </div></article>`;
    }).join('') + (rows.length > recLimit ? `<button type="button" class="more" id="rec-more">Afficher plus (${fmt(rows.length - recLimit)} restantes)</button>` : '');
    const mb = $('#rec-more'); if (mb) mb.onclick = () => { recLimit += 200; renderRecipes(j); };
  }
  // clic sur la source d'un ingrédient : ouvre le métier concerné filtré sur l'objet
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (!g || !getJob(g.dataset.goto)) return;
    e.preventDefault();
    q.value = g.dataset.q;
    store.set('sub.' + g.dataset.goto, getJob(g.dataset.goto).type === 'harvest' && !g.classList.contains('craft') ? 'res' : 'rec');
    go('metiers', g.dataset.goto);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------------------------------------------------------------- plan de montée
  const craftListHtml = crafts => [...crafts.values()].sort((a, b) => a.r.level - b.r.level).map(c => {
    const it = c.r.res.item;
    return `<li>${icon(it)}<span><b>${fmt(Math.ceil(c.n))}×</b> ${esc(it.name)} <small>niv. ${c.r.level}</small></span></li>`;
  }).join('');
  const segHtml = (attr, val, opts) => `<div class="seg">${opts.map(([v, l, t]) => `<button type="button" data-${attr}="${v}" class="${v === val ? 'on' : ''}" ${t ? `title="${esc(t)}"` : ''}>${l}</button>`).join('')}</div>`;

  function harvestPlanHtml(j) {
    const L = levelOf(j.key);
    if (L === null) return '<p class="empty">Renseigne ton niveau dans la carte du métier pour obtenir un plan.</p>';
    const tg = targetOf(j, L);
    if (tg <= L) return '<p class="empty">Choisis un objectif supérieur à ton niveau.</p>';
    const strat = store.get('strat.' + j.key) || 'harvest';
    if (strat === 'craft' && !needRecipes(j.key)) return '<p class="empty">Chargement des recettes…</p>';
    const xp = Math.min(xpOf(j.key), XP.need(L) - 1);
    const pl = harvestPlan(j, L, xp, tg, strat), alt = harvestPlan(j, L, xp, tg, strat === 'craft' ? 'harvest' : 'craft');
    const qa = qtyStats(j).avg;
    const nCraft = [...pl.crafts.values()].reduce((a, c) => a + Math.ceil(c.n), 0);
    let kam = 0;
    const resRows = [...pl.res.values()].sort((a, b) => a.r.level - b.r.level).map(o => {
      const main = (o.r.normal || [])[0], p = main && price(main.id);
      if (p && strat === 'harvest') kam += o.items * p;
      return `<li>${icon({ icon: o.r.appearance || (main || {}).icon, name: o.r.name })}<span><b>${fmt(Math.ceil(o.n))}</b> récoltes · ${esc(o.r.name)} <small>niv. ${o.r.level}</small><br>
        <small>≈ ${fmt(o.items)} ${esc((main || {}).name || 'ressources')}${p && strat === 'harvest' ? ` · ${fmtK(o.items * p)}` : ''}</small></span></li>`;
    }).join('');
    return `<div class="panel">
      <div class="panel-head">
        <h3>Niv. ${L} → ${tg}</h3>
        ${segHtml('strat', strat, [['harvest', 'Récolte seule'], ['craft', 'Récolte + craft', 'Transformer les ressources récoltées quand c’est plus rentable en XP']])}
      </div>
      <div class="kpis">
        <div class="kpi"><span>XP à gagner</span><b>${fmt(pl.xp)}</b></div>
        <div class="kpi"><span>Récoltes</span><b>${fmt(pl.actions)}</b>${nCraft ? `<small>+ ${fmt(nCraft)} crafts</small>` : ''}</div>
        <div class="kpi"><span>Durée estimée</span><b>~${fmtDur(pl.time)}</b>${isFinite(alt.time) && alt.time !== pl.time ? `<small>${strat === 'craft' ? 'récolte seule' : 'avec craft'} : ~${fmtDur(alt.time)}</small>` : ''}</div>
        ${kam ? `<div class="kpi"><span>Valeur récoltée</span><b class="kph">${fmtK(kam)}</b><small>au prix HDV</small></div>` : ''}
      </div>
      <div class="cols">
        <div><h4>À récolter</h4><ul class="plist">${resRows}</ul></div>
        ${pl.crafts.size ? `<div><h4>À crafter <small>(atelier du métier)</small></h4><ul class="plist">${craftListHtml(pl.crafts)}</ul></div>` : ''}
      </div>
      <p class="meta">Estimation avec ${fmt1(qa)} ressources par récolte et les bonus actifs, sans déplacements.
        ${strat === 'craft' ? 'XP des recettes = valeur de base du jeu (à confirmer en jeu).' : ''}</p>
    </div>`;
  }

  function craftPlanHtml(j) {
    const L = levelOf(j.key);
    if (!needRecipes(j.key)) return '<p class="empty">Chargement des recettes…</p>';
    if (L === null) return '<p class="empty">Renseigne ton niveau dans la carte du métier pour obtenir un plan.</p>';
    const tg = targetOf(j, L);
    if (tg <= L) return '<p class="empty">Choisis un objectif supérieur à ton niveau.</p>';
    const metric = store.get('metric.' + j.key) || 'crafts', withUp = store.get('withup.' + j.key) === '1';
    const pl = craftPlan(j, L, Math.min(xpOf(j.key), XP.need(L) - 1), tg, metric, withUp);
    const ings = [...pl.ing.values()].sort((a, b) => b.n - a.n);
    let c = 0, miss = 0;
    ings.forEach(o => { const p = price(o.item.id); if (p) c += p * o.n; else miss++; });
    return `<div class="panel">
      <div class="panel-head">
        <h3>Niv. ${L} → ${tg}</h3>
        ${segHtml('metric', metric, [['crafts', 'Moins de crafts'], ['ing', 'Moins d’ingrédients'], ['kamas', 'Moins cher', 'Recettes dont tous les ingrédients ont un prix HDV']])}
      </div>
      <label class="bchk"><input type="checkbox" data-withup ${withUp ? 'checked' : ''}> Inclure les améliorations de rareté</label>
      <div class="kpis">
        <div class="kpi"><span>XP à gagner</span><b>${fmt(pl.xp)}</b></div>
        <div class="kpi"><span>Crafts</span><b>${isFinite(pl.n) ? fmt(pl.n) : '—'}</b>${isFinite(pl.n) ? '' : '<small>aucune recette disponible</small>'}</div>
        ${c ? `<div class="kpi"><span>Coût des ingrédients</span><b class="kph">${miss ? '≥ ' : ''}${fmtK(c)}</b>${miss ? `<small>${miss} sans prix</small>` : ''}</div>` : ''}
      </div>
      <div class="cols">
        <div><h4>À crafter</h4><ul class="plist">${craftListHtml(pl.crafts)}</ul></div>
        <div><h4>Liste de courses <small>(${ings.length})</small></h4><ul class="plist shop">${ings.map(o => `<li>${ingChip({ item: o.item }, o.n)}</li>`).join('')}</ul></div>
      </div>
      <p class="meta">XP des recettes = valeur de base du jeu (à confirmer en jeu). Pleine XP jusqu’à 10 niveaux sous le tien. Les ingrédients craftables ne sont pas détaillés.</p>
    </div>`;
  }
  $('#list').addEventListener('click', e => {
    const s = e.target.closest('[data-strat]'), m = e.target.closest('[data-metric]');
    if (s) { store.set('strat.' + cur, s.dataset.strat); renderContent(); renderJobCard(job()); }
    if (m) { store.set('metric.' + cur, m.dataset.metric); renderContent(); }
  });
  $('#list').addEventListener('change', e => {
    if (e.target.matches('[data-withup]')) { store.set('withup.' + cur, e.target.checked ? '1' : '0'); renderContent(); }
  });

  // ---------------------------------------------------------------- prix HDV (onglet)
  function pricesHtml(j) {
    const P = PRICES(), L = levelOf(j.key);
    const row = (r, it, kind) => it && it.id ? `<tr class="${L !== null && r.level > L ? 'locked' : ''}">
      <td class="num">${r.level}</td><td>${icon(it)} ${esc(it.name)} <small class="kind">${kind}</small></td>
      <td>${priceInput(it)}</td><td class="meta">${P[it.id] ? ago(P[it.id][1]) : '—'}</td></tr>` : '';
    const n = j.resources.reduce((a, r) => a + [...(r.normal || []), ...(r.seed || []), ...(r.rare || [])].filter(it => P[it.id]).length, 0);
    return `<div class="panel">
      <div class="panel-head"><h3>Prix HDV · ${esc(j.label)}</h3><span class="meta">${n} prix connus</span></div>
      <p class="meta">Prix unitaires. Le plus simple : colle une capture de l’Hôtel des ventes avec <kbd>Ctrl</kbd>+<kbd>V</kbd> (n’importe où sur le site), les prix se remplissent tout seuls.</p>
      <table class="ptable"><thead><tr><th>Niv.</th><th>Objet</th><th>Prix ₭</th><th>Mis à jour</th></tr></thead><tbody>
      ${j.resources.map(r => (r.normal || []).map(it => row(r, it, 'ressource')).join('') + (r.rare || []).map(it => row(r, it, 'rare')).join('') + (r.seed || []).map(it => row(r, it, j.key === 'forestier' ? 'bouture' : 'graine')).join('')).join('')}
      </tbody></table></div>`;
  }
  // saisie d'un prix (n'importe où)
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-price]');
    if (!el) return;
    setPrices({ [el.dataset.price]: el.value });
    changed();
    if (page === 'rentabilite') renderProfit(); else { renderJobCard(job()); renderSide(); }
  });

  // ---------------------------------------------------------------- équipement (onglet)
  const recipeHtml = r => r ? `
    <details class="recipe"><summary>Recette ${esc(r.job_label || '')} niv. ${r.level}</summary>
      <div class="ings">${r.ingredients.map(i => `<span class="ing">${icon(i)}${i.qty}× ${esc(i.name)}</span>`).join('')}</div>
    </details>` : '';
  function equipHtml(j) {
    const L = levelOf(j.key);
    const usable = j.tools.filter(t => L !== null && t.level <= L).pop();
    const card = (title, body) => `<div class="card"><h4>${title}</h4>${body}</div>`;
    const it = (x, title, bonus, meta, extra = '') => `<div class="it">${icon(x)}<div><b>${title}</b><span class="bonus">${bonus}</span>${meta ? `<div class="meta">${meta}</div>` : ''}${extra}</div></div>`;
    return `<div class="cards">
      ${card(`Outils ${esc(j.label)}`, j.tools.map(t => it(t, `${esc(t.name)} <span class="badge ${usable === t ? 'cur' : ''}">niv. ${t.level}</span>`, `+${t.bonus} % quantité récoltée`, '', recipeHtml(t.recipe))).join(''))}
      ${card('Familier', it(j.pet, esc(j.pet.name), `+${j.pet.bonus_min} % → +${j.pet.bonus_max} % quantité récoltée`, `Niv. 1 → 50 · obtenu dans les ${esc(j.pet.how)}`))}
      ${card('Consommable', it(j.consumable, `${esc(j.consumable.name)} <span class="badge">niv. ${j.consumable.level}</span>`, `${esc(j.consumable.bonus)} · ${esc(j.consumable.duration)}`, esc(j.consumable.how), recipeHtml(j.consumable.recipe)))}
      ${j.extras.length ? card('Équipement bonus', j.extras.map(e => it(e, `${esc(e.name)}${e.level ? ` <span class="badge">niv. ${e.level}</span>` : ''}`, esc(e.bonus), esc(e.how), recipeHtml(e.recipe))).join('')) : ''}
      ${card('Bonus tous métiers', D.common.map(e => it(e, esc(e.name), esc(e.bonus), `${esc(e.kind)} · ${esc(e.how)}`)).join(''))}
    </div><p class="meta">Active ce que tu utilises dans le panneau « Bonus actifs » : les calculs en tiennent compte partout.</p>`;
  }

  // ================================================================ page Rentabilité
  function renderProfit() {
    const el = $('#page-rentabilite');
    const o = sj.get('profit', { jobs: null, access: true, craft: true, sort: 'kph', q: '' });
    const withLvl = HARVEST.filter(j => levelOf(j.key) !== null).map(j => j.key);
    const sel = o.jobs || (withLvl.length ? withLvl : HARVEST.map(j => j.key));
    const missingRec = o.craft && sel.some(k => !RD[k]);
    if (missingRec) Promise.all(sel.map(loadRecipes)).then(() => page === 'rentabilite' && renderProfit());
    let rows = HARVEST.filter(j => sel.includes(j.key)).flatMap(j => profitRows(j, o));
    const term = norm(o.q || '');
    if (term) rows = rows.filter(r => norm(`${r.it.name} ${r.r.name} ${r.j.label}`).includes(term));
    const key = o.sort === 'xph' ? 'xph' : 'kph';
    const priced = rows.filter(r => r.kph !== null && !r.locked).sort((a, b) => b[key] - a[key] || b.kph - a.kph);
    const unpriced = rows.filter(r => r.kph === null && !r.locked).sort((a, b) => b.xph - a.xph);
    const top = priced.length ? priced.reduce((a, b) => (b.kph > a.kph ? b : a)) : null;
    const topXp = rows.filter(r => !r.locked).reduce((a, b) => (!a || b.xph > a.xph ? b : a), null);
    const maxK = Math.max(1, ...priced.map(r => r.kph)), maxX = Math.max(1, ...priced.map(r => r.xph));
    const line = (r, i) => `<tr class="${r.kind === 'transformé' ? 'craftrow' : ''}">
      <td class="num rank">${i + 1}</td>
      <td><div class="pcell">${icon(r.it)}<div><b>${esc(r.it.name)}</b><small>${r.kind === 'transformé'
        ? `⚒ ${r.parts.map(p => `${fmt(p.qty)}× ${esc(p.item.name)}`).join(' + ')}`
        : `${esc(r.r.name)} · ${r.kind}`}</small></div></div></td>
      <td><span class="jchip" style="--c:${r.j.color}"><img src="${r.j.icon}" alt="">${esc(r.j.label)} ${r.r.level}</span></td>
      <td class="num">${priceInput(r.it, 'small')}</td>
      <td class="num">${fmt(r.qph)}</td>
      <td class="num bar" style="--w:${(r.xph / maxX * 100).toFixed(1)}%">${fmt(r.xph)}</td>
      <td class="num bar k" style="--w:${r.kph !== null ? (r.kph / maxK * 100).toFixed(1) : 0}%"><b>${r.kph !== null ? fmtK(r.kph) : '—'}</b></td>
    </tr>`;
    el.innerHTML = `
      <div class="page-head">
        <h2>Rentabilité</h2>
        <p class="meta">Kamas et XP par heure de farm, avec tes niveaux, tes bonus actifs et les prix HDV. Estimations théoriques sans déplacements ni repousse.</p>
      </div>
      <div class="kpis big">
        ${top ? `<div class="kpi"><span>Plus rentable</span><b>${esc(top.it.name)}</b><small>${fmtK(top.kph)}/h · ${esc(top.j.label)}</small></div>` : '<div class="kpi"><span>Plus rentable</span><b>—</b><small>ajoute des prix HDV</small></div>'}
        ${topXp ? `<div class="kpi"><span>Meilleure XP</span><b>${esc(topXp.it.name)}</b><small>${fmt(topXp.xph)} XP/h · ${esc(topXp.j.label)}</small></div>` : ''}
        <div class="kpi"><span>Prix connus</span><b>${fmt(Object.keys(PRICES()).length)}</b><small>${unpriced.length} produit(s) sans prix ici</small></div>
      </div>
      <div class="toolbar">
        <div class="chips">${HARVEST.map(j => `<button type="button" class="jchip toggle ${sel.includes(j.key) ? 'on' : ''}" data-pj="${j.key}" style="--c:${j.color}"><img src="${j.icon}" alt="">${esc(j.label)}${levelOf(j.key) !== null ? ` <small>${levelOf(j.key)}</small>` : ''}</button>`).join('')}</div>
        <div class="tb-row">
          ${segHtml('psort', o.sort, [['kph', 'Trier par kamas/h'], ['xph', 'Trier par XP/h']])}
          <label class="chk"><input type="checkbox" data-po="access" ${o.access ? 'checked' : ''}> Accessibles à mon niveau</label>
          <label class="chk"><input type="checkbox" data-po="craft" ${o.craft ? 'checked' : ''}> Inclure les transformations</label>
          <input type="search" class="tb-search" data-po="q" value="${esc(o.q || '')}" placeholder="Filtrer…">
        </div>
      </div>
      ${!withLvl.length && o.access ? '<p class="empty">Renseigne tes niveaux (onglet Métiers ou capture de la fenêtre Métiers) pour voir ce que tu peux farmer.</p>' : ''}
      <div class="tablewrap"><table class="ptable profit">
        <thead><tr><th>#</th><th>Produit</th><th>Métier</th><th>Prix u.</th><th>Qté/h</th><th>XP/h</th><th>Kamas/h</th></tr></thead>
        <tbody>${priced.slice(0, 150).map(line).join('')}</tbody>
      </table></div>
      ${unpriced.length ? `<details class="panel" ${priced.length ? '' : 'open'}><summary><b>Sans prix (${unpriced.length})</b> — renseigne un prix pour les classer</summary>
        <div class="tablewrap"><table class="ptable profit"><tbody>${unpriced.slice(0, 200).map(line).join('')}</tbody></table></div></details>` : ''}
      ${missingRec ? '<p class="meta">Chargement des recettes de transformation…</p>' : ''}`;
  }
  $('#page-rentabilite').addEventListener('click', e => {
    const o = sj.get('profit', { jobs: null, access: true, craft: true, sort: 'kph', q: '' });
    const pj = e.target.closest('[data-pj]'), ps = e.target.closest('[data-psort]');
    if (pj) {
      const withLvl = HARVEST.filter(j => levelOf(j.key) !== null).map(j => j.key);
      let s = o.jobs || (withLvl.length ? withLvl : HARVEST.map(j => j.key));
      s = s.includes(pj.dataset.pj) ? s.filter(k => k !== pj.dataset.pj) : [...s, pj.dataset.pj];
      o.jobs = s;
    } else if (ps) o.sort = ps.dataset.psort; else return;
    sj.set('profit', o); renderProfit();
  });
  $('#page-rentabilite').addEventListener('change', e => {
    const el = e.target.closest('[data-po]');
    if (!el) return;
    const o = sj.get('profit', { jobs: null, access: true, craft: true, sort: 'kph', q: '' });
    o[el.dataset.po] = el.type === 'checkbox' ? el.checked : el.value;
    sj.set('profit', o); renderProfit();
  });

  // ================================================================ page Session
  const S_DEF = { job: null, res: null, prod: null, eff: 80, plan: 60, start: null, acc: 0, done: null };
  const sess = () => sj.get('session', S_DEF);
  const setSess = s => { sj.set('session', s); };
  const elapsed = s => s.acc + (s.start ? Date.now() - s.start : 0);
  let tick = null;

  function sessCtx(s) {
    const j = getJob(s.job) || job();
    const L = levelOf(j.key);
    const avail = j.resources.filter(r => L === null || r.level <= L);
    const r = avail.find(x => x.name === s.res) || (L !== null && bestAt(j, L) || {}).r || avail[avail.length - 1];
    const prods = r ? [...(r.normal || []), ...(r.seed || [])].filter(it => it && it.id) : [];
    const it = prods.find(x => x.id === s.prod) || prods[0];
    return { j, L, r, it, prods, avail };
  }
  // estimation pour une durée (ms) de session : simulée niveau par niveau
  // (l'XP par récolte baisse et l'action accélère quand ton niveau s'éloigne de celui de la ressource)
  function sessEstimate(c, ms, eff) {
    if (!c.r) return null;
    const bonus = bonusXp(), qa = qtyStats(c.j).avg, p = c.it && price(c.it.id), known = c.L !== null;
    const from = c.L ?? 0, x0 = Math.min(xpOf(c.j.key), XP.need(from) - 1);
    const at = L => { const diff = Math.max(0, L - c.r.level); return { d: dur(c.j.key, diff, c.r), per: known ? XP.per(diff, bonus) : 0 }; };
    let T = ms / 1000 * eff / 100, L = from, x = x0, actions = 0, xp = 0, guard = 0;
    while (T > 0 && guard++ < 300) {
      const { d, per } = at(L);
      if (!per) { actions += Math.floor(T / d); break; }
      const n = Math.ceil((XP.need(L) - x) / per);
      if (n * d > T) { const k = Math.floor(T / d); actions += k; xp += k * per; x += k * per; break; }
      actions += n; xp += n * per; x += n * per - XP.need(L); L++; T -= n * d;
    }
    const s0 = at(from), s1 = at(L), qty = actions * qa;
    return { d: s0.d, per: s0.per, perEnd: s1.per, actions, xp, qty, p, kamas: p ? qty * p : null, from, x0, after: { level: L, xp: Math.floor(x) }, known, res: c.r };
  }
  function statsHtml(e) {
    if (!e) return '<p class="empty">Aucune ressource accessible.</p>';
    const lvUp = e.after.level - e.from;
    return `<div class="kpis big">
      <div class="kpi"><span>Récoltes</span><b>${fmt(e.actions)}</b><small>${sec(e.d)} s / action</small></div>
      <div class="kpi"><span>XP gagnée</span><b>${fmt(e.xp)}</b><small>${fmt(e.per)} XP / récolte</small></div>
      <div class="kpi"><span>Niveau</span><b>${e.from} → ${e.after.level}${lvUp ? ` <em class="pos">+${lvUp}</em>` : ''}</b><small>${fmt(e.after.xp)} / ${fmt(XP.need(e.after.level))} XP</small></div>
      <div class="kpi"><span>Ressources</span><b>${fmt(e.qty)}</b></div>
      <div class="kpi"><span>Kamas estimés</span><b class="kph">${e.kamas !== null ? fmtK(e.kamas) : '—'}</b><small>${e.p ? `${fmt(e.p)} ₭ / u` : 'pas de prix HDV'}</small></div>
    </div>
    ${e.known && !e.perEnd ? `<p class="meta warn-txt">⚠ ${esc(e.res.name)} ne donne plus d’XP à partir du niveau ${e.res.level + 20} : change de ressource pour continuer à monter.</p>`
      : e.known && e.perEnd < e.per ? `<p class="meta">XP par récolte en baisse en fin de session (${fmt(e.perEnd)} XP) : la ressource devient trop basse pour ton niveau.</p>` : ''}`;
  }

  function renderSession() {
    const s = sess();
    if (!s.job || !getJob(s.job) || getJob(s.job).type !== 'harvest') { s.job = cur; setSess(s); }
    if (s.job !== cur && !s.start && !s.acc) { s.job = cur; s.res = null; s.prod = null; setSess(s); }
    const c = sessCtx(s), el = $('#page-session');
    const ms = elapsed(s), running = !!s.start, active = running || s.acc > 0;
    const hist = jget('sessions', []) || [];
    el.innerHTML = `
      <div class="page-head">
        <h2>Session de farm</h2>
        <p class="meta">Lance le chrono quand tu commences à récolter : XP, niveau, ressources et kamas sont estimés en direct. À la fin, applique l’XP à ta progression.</p>
      </div>
      <div class="panel sess-setup">
        <div class="sess-row">
          <label>Métier<span class="jchip" style="--c:${c.j.color}"><img src="${c.j.icon}" alt="">${esc(c.j.label)}${c.L !== null ? ` ${c.L}` : ''}</span></label>
          <label>Ressource<select data-s="res" ${active ? 'disabled' : ''}>${c.avail.slice().reverse().map(r => `<option value="${esc(r.name)}" ${c.r === r ? 'selected' : ''}>${esc(r.name)} (niv. ${r.level})</option>`).join('')}</select></label>
          <label>Produit vendu<select data-s="prod">${c.prods.map(it => `<option value="${it.id}" ${c.it === it ? 'selected' : ''}>${esc(it.name)}${price(it.id) ? ` · ${fmt(price(it.id))} ₭` : ''}</option>`).join('')}</select></label>
          <label title="Part du temps passée à récolter (déplacements, repousse, combats exclus)">Efficacité<span class="unit"><input type="number" min="5" max="100" data-s="eff" value="${s.eff}"><i>%</i></span></label>
        </div>
        ${c.L === null ? '<p class="meta">⚠ Renseigne ton niveau dans ce métier pour estimer l’XP.</p>' : ''}
      </div>
      <div class="sess-main">
        <div class="panel timer ${running ? 'running' : ''}">
          <div class="clock" id="s-clock">${clock(ms)}</div>
          <div class="tbtns">
            ${running ? '<button type="button" class="big-btn" data-sa="pause">⏸ Pause</button>' : `<button type="button" class="big-btn go" data-sa="start">▶ ${active ? 'Reprendre' : 'Démarrer'}</button>`}
            ${active ? '<button type="button" class="big-btn stop" data-sa="stop">⏹ Terminer</button><button type="button" class="lnk" data-sa="reset">Réinitialiser</button>' : ''}
          </div>
          ${!active ? `<label class="plan-dur">ou simule une durée : <span class="unit"><input type="number" min="5" max="1440" step="5" data-s="plan" value="${s.plan}"><i>min</i></span></label>` : ''}
        </div>
        <div class="panel"><h4>${active ? 'En direct' : `Estimation pour ${s.plan} min`}</h4><div id="s-live">${statsHtml(sessEstimate(c, active ? ms : s.plan * 60000, s.eff))}</div></div>
      </div>
      ${s.done ? doneHtml(s.done) : ''}
      <div class="panel">
        <h4>Historique</h4>
        ${hist.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>Métier</th><th>Ressource</th><th>Durée</th><th>XP</th><th>Kamas</th><th></th></tr></thead><tbody>
          ${hist.slice().reverse().map((h, i) => `<tr><td>${new Date(h.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td>${esc((getJob(h.job) || {}).label || h.job)}</td><td>${esc(h.res)}</td><td>${clock(h.ms)}</td>
            <td class="num">${fmt(h.xp)}${h.applied ? ' ✓' : ''}</td><td class="num">${h.kamas ? fmtK(h.kamas) : '—'}</td>
            <td><button type="button" class="lnk" data-hdel="${hist.length - 1 - i}" title="Supprimer">✕</button></td></tr>`).join('')}
          </tbody></table></div>
          <p class="meta">Total : ${clock(hist.reduce((a, h) => a + h.ms, 0))} · ${fmt(hist.reduce((a, h) => a + h.xp, 0))} XP · ${fmtK(hist.reduce((a, h) => a + (h.kamas || 0), 0))}</p>`
          : '<p class="meta">Tes sessions terminées apparaîtront ici.</p>'}
      </div>`;
    clearInterval(tick);
    if (running) {
      tick = setInterval(() => {
        const s2 = sess();
        if (!s2.start || page !== 'session') { clearInterval(tick); return; }
        const ms2 = elapsed(s2);
        $('#s-clock').textContent = clock(ms2);
        $('#s-live').innerHTML = statsHtml(sessEstimate(sessCtx(s2), ms2, s2.eff));
      }, 1000);
    }
    $('#live-dot').hidden = !running;
  }
  function doneHtml(d) {
    return `<div class="panel done">
      <div class="panel-head"><h3>Session terminée · ${clock(d.ms)}</h3><button type="button" class="lnk" data-sa="dismiss">Fermer</button></div>
      <div class="kpis big">
        <div class="kpi"><span>XP gagnée</span><b>${fmt(d.xp)}</b><small>${esc(d.res)}</small></div>
        <div class="kpi"><span>Niveau</span><b>${d.from} → ${d.to}</b></div>
        <div class="kpi"><span>Ressources</span><b>${fmt(d.qty)}</b></div>
        <div class="kpi"><span>Kamas estimés</span><b class="kph">${d.kamas ? fmtK(d.kamas) : '—'}</b></div>
      </div>
      ${d.applied ? '<p class="meta pos">✓ XP appliquée à ta progression.</p>' : `<button type="button" class="gbtn" data-sa="apply">Appliquer l’XP à ma progression (${esc((getJob(d.job) || {}).label)} ${d.from} → ${d.to})</button>`}
    </div>`;
  }
  $('#page-session').addEventListener('click', e => {
    const a = e.target.closest('[data-sa]'), hd = e.target.closest('[data-hdel]');
    if (hd) {
      const h = jget('sessions', []) || []; h.splice(+hd.dataset.hdel, 1);
      store.set('sessions', JSON.stringify(h)); changed(); renderSession(); return;
    }
    if (!a) return;
    const s = sess();
    if (a.dataset.sa === 'start') { s.start = Date.now(); s.done = null; }
    if (a.dataset.sa === 'pause') { s.acc = elapsed(s); s.start = null; }
    if (a.dataset.sa === 'reset') { s.acc = 0; s.start = null; }
    if (a.dataset.sa === 'stop') {
      const ms = elapsed(s), c = sessCtx(s), est = sessEstimate(c, ms, s.eff);
      if (est && est.actions > 0) {
        s.done = { t: Date.now(), ms, job: c.j.key, res: c.r.name, xp: est.xp, qty: est.qty, kamas: est.kamas, from: est.from, to: est.after.level, xpAfter: est.after.xp, applied: false };
        const h = jget('sessions', []) || [];
        h.push({ t: s.done.t, ms, job: c.j.key, res: c.r.name, xp: est.xp, kamas: est.kamas, applied: false });
        store.set('sessions', JSON.stringify(h.slice(-100)));
      }
      s.acc = 0; s.start = null;
    }
    if (a.dataset.sa === 'apply' && s.done && !s.done.applied) {
      store.set(lvlKey(s.done.job), String(s.done.to));
      store.set('xp.' + s.done.job, String(s.done.xpAfter));
      s.done.applied = true;
      const h = jget('sessions', []) || [];
      const last = h.findLast ? h.findLast(x => x.t === s.done.t) : h.filter(x => x.t === s.done.t).pop();
      if (last) last.applied = true;
      store.set('sessions', JSON.stringify(h));
      renderTabs();
    }
    if (a.dataset.sa === 'dismiss') s.done = null;
    setSess(s); changed(); renderSession(); renderSide();
  });
  $('#page-session').addEventListener('change', e => {
    const el = e.target.closest('[data-s]');
    if (!el) return;
    const s = sess();
    s[el.dataset.s] = el.dataset.s === 'res' ? el.value : +el.value;
    if (el.dataset.s === 'res') s.prod = null;
    setSess(s); renderSession();
  });

  // ================================================================ panneau Bonus (colonne de droite)
  const chk = (id, on, label, extra = '') => `<label class="bchk"><input type="checkbox" data-b="${id}" ${on ? 'checked' : ''}> ${label}${extra}</label>`;
  const selB = (id, val, opts) => `<select data-b="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  function climCount(j) {
    const L = levelOf(j.key);
    const c = { ok: 0, hot: 0, cold: 0 };
    j.resources.filter(r => r.temp && (L === null || r.level <= L)).forEach(r => c[climate(r)]++);
    return `<span class="ccount"><span class="temp ok">● ${c.ok}</span> <span class="temp hot">▲ ${c.hot}</span> <span class="temp cold">▼ ${c.cold}</span></span>`;
  }
  // situation (change souvent) : région + météo
  function situationHtml(j) {
    const g = bg();
    return `
      <div class="bgrp"><h5>Bonus de région <small>(volontés du Maître de clan)</small></h5>
        <div class="region">${REGION.map(r => `
          <button type="button" data-region="${r.v}" class="${g.region === r.v ? 'on' : ''}" title="${r.label}">
            <img src="${r.img}" alt=""><span>${'★'.repeat(r.stars)}${'☆'.repeat(2 - r.stars)}</span><b>${r.v > 0 ? '+' : ''}${r.v} %</b>
          </button>`).join('')}
        </div>
      </div>
      <div class="bgrp"><h5>Météo <small>(touche X en jeu)</small></h5>
        <label class="bchk">Température <span class="unit"><input type="number" data-b="g:temp" value="${g.temp ?? ''}" placeholder="—" min="-40" max="60"><i>°C</i></span>
          ${j && g.temp !== null && g.temp !== '' && j.resources.some(r => r.temp) ? climCount(j) : ''}</label>
        <label class="bchk">Ralentissement hors plage <span class="unit"><input type="number" data-b="g:climMalus" value="${+g.climMalus || 0}" min="0" max="300"><i>%</i></span>
          <em class="warn-txt" title="Valeur non publiée par Ankama : à ajuster selon tes mesures en jeu">estim.</em></label>
        ${j && !j.resources.some(r => r.temp) ? '<p class="meta">Pas d’effet de la météo sur ce métier.</p>' : ''}
      </div>`;
  }
  function globalMoreHtml() {
    const g = bg();
    return `
      <div class="bgrp"><h5>XP</h5>
        ${chk('g:havre', g.havre, 'Havre-Monde', ' <em>+10 %</em>')}
        <label class="bchk">Source de Stasis ${selB('g:stasis', g.stasis, [[0, 'non'], [10, '+10 %'], [20, '+20 %']])}</label>
        ${chk('g:turbo', g.turbo, 'Turbo Craft 30', ' <em>+100 %</em>')}
        <label class="bchk">Autre <span class="unit"><input type="number" data-b="g:xpExtra" value="${+g.xpExtra || ''}" placeholder="0"><i>%</i></span></label>
      </div>
      <div class="bgrp"><h5>Quantité (tous métiers)</h5>
        ${chk('g:sceau', g.sceau, 'Sceau des Compagnons', ' <em>+50 %</em>')}
        ${chk('g:potion', g.potion, 'Potion de récolte', ' <em>+50 %</em>')}
        <label class="bchk">Pacte ${selB('g:pacte', g.pacte, [[0, 'aucun'], [25, 'prudent +25 %'], [50, 'opportuniste +50 %']])}</label>
        <label class="bchk">Volontés ${selB('g:mdc', g.mdc, [[0, 'quantité normale'], [33, 'ressource en surplus (jet 1–4)'], [66, 'ressource en manque (+66 % graines)']])}</label>
        <label class="bchk">Capt’chat perdus ${selB('g:captchat', g.captchat, [0, 1, 2, 3, 4, 5, 6].map(n => [n, n ? `${n} (−${33 * n} %)` : '0']))}</label>
        <label class="bchk">Autre <span class="unit"><input type="number" data-b="g:qtyExtra" value="${+g.qtyExtra || ''}" placeholder="0"><i>%</i></span></label>
      </div>
      <div class="bgrp"><h5>Vitesse</h5>
        <label class="bchk">Potion ${selB('g:speed', g.speed, [[0, 'aucune'], [50, 'Récolteur Véloce +50 %'], [100, 'Artipotion Exceptionnelle +100 %']])}</label>
      </div>`;
  }
  function jobEquipHtml(j, compact) {
    const b = bjob(j.key), auto = activeTool(j, { ...b, tool: 'auto' }, levelOf(j.key)), p = `${j.key}:`;
    return `
      <label class="bchk">Outil ${selB(p + 'tool', b.tool, [['auto', `Auto${auto ? ` (${auto.name} +${auto.bonus} %)` : ''}`], ['none', 'Aucun'], ...j.tools.map(t => [t.name, `${t.name} +${t.bonus} %`])])}</label>
      <label class="bchk">Familier ${selB(p + 'pet', b.pet, [['', 'Aucun'], ['job', `${j.pet.name} (+10→50 %)`], ['noxine', 'Noxine (+5→25 %)']])}
        ${b.pet ? `<span class="unit">niv.<input type="number" data-b="${p}petLvl" min="1" max="50" value="${+b.petLvl || 50}"></span>` : ''}</label>
      ${chk(p + 'conso', b.conso, compact ? 'Consommable' : j.consumable.name, ' <em>+15 %</em>')}
      ${j.key === 'mineur' ? chk(p + 'casque', b.casque, 'Casque de la Mine', ' <em>+25 %</em>') : ''}
      ${j.key === 'mineur' || j.key === 'trappeur' ? `<label class="bchk">${j.key === 'mineur' ? 'Sac du Greuvard' : 'Sac à Pipi'} ${selB(p + 'sacs', b.sacs, [[0, '0'], [1, '×1'], [2, '×2'], [3, '×3']])} <em>+10 % chacun</em></label>` : ''}
      ${j.key === 'paysan' ? chk(p + 'gateau', b.gateau, 'Gâteau de riz', ' <em>+15 %</em>') : ''}`;
  }
  function summaryHtml(j) {
    const xpb = bonusXp(), qs = qtyStats(j), L = levelOf(j.key);
    const best = L === null ? null : bestAt(j, L);
    const perH = best ? 3600 / best.d : 0, pm = best && price((best.r.normal[0] || {}).id);
    return `<div class="bsum">
      <div><span>XP</span><b class="${xpb < 0 ? 'neg' : ''}">${xpb >= 0 ? '+' : ''}${xpb} %</b></div>
      <div><span>Quantité</span><b class="${qs.pct < 0 ? 'neg' : ''}">${qs.pct >= 0 ? '+' : ''}${+qs.pct.toFixed(1)} %</b></div>
      <div><span>Par récolte</span><b>${qs.min}–${qs.max}</b><small>moy. ${fmt1(qs.avg)}</small></div>
      ${best ? `<div title="${esc(best.r.name)}, ${sec(best.d)} s par action"><span>Par heure</span><b>${fmt(perH * XP.per(L - best.r.level, xpb))}</b><small>XP${pm ? ` · ${fmtK(perH * qs.avg * pm)}` : ''}</small></div>` : ''}
    </div>`;
  }

  function renderSide() {
    const side = $('#side'), j = job();
    const showSide = page !== 'metiers' || j.type === 'harvest';
    $('#layout').classList.toggle('noside', !showSide);
    if (!showSide) { side.innerHTML = ''; return; }
    const more = store.get('ui.bmore') !== '0';
    if (page === 'rentabilite') {
      side.innerHTML = `<div class="box"><h4>Bonus actifs</h4>${situationHtml(null)}
        <details class="bmore" ${more ? 'open' : ''}><summary>Équipement, consommables et autres</summary>${globalMoreHtml()}
          <div class="bgrp"><h5>Par métier</h5>${HARVEST.map(h => `<details class="jeq"><summary><img src="${h.icon}" alt=""> ${esc(h.label)} <small>+${+qtyStats(h).pct.toFixed(1)} % qté</small></summary>${jobEquipHtml(h, true)}</details>`).join('')}</div>
        </details></div>`;
      return;
    }
    side.innerHTML = `<div class="box"><h4>Bonus actifs · ${esc(j.label)}</h4>${summaryHtml(j)}${situationHtml(j)}
      <details class="bmore" ${more ? 'open' : ''}><summary>Équipement, consommables et autres</summary>
        <div class="bgrp"><h5>Équipement ${esc(j.label)}</h5>${jobEquipHtml(j, false)}</div>
        ${globalMoreHtml()}
      </details>
      <p class="meta">Les bonus d’une même catégorie s’additionnent. Turbo Craft et les potions de vitesse ne se cumulent pas.${+bg().pacte ? ' Pacte : une partie des récoltes part dans l’inventaire PvP.' : ''}</p></div>`;
  }
  const side = $('#side');
  side.addEventListener('toggle', e => { if (e.target.matches('details.bmore')) store.set('ui.bmore', e.target.open ? '1' : '0'); }, true);
  side.addEventListener('click', e => {
    const r = e.target.closest('[data-region]');
    if (!r) return;
    const g = bg(), v = +r.dataset.region;
    g.region = g.region === v ? null : v;
    sj.set('bonus.global', g); renderPage(); if (page === 'metiers') renderJobCard(job()); changed();
  });
  side.addEventListener('change', e => {
    const el = e.target.closest('[data-b]');
    if (!el) return;
    const [scope, key] = el.dataset.b.includes(':') ? el.dataset.b.split(':') : ['g', el.dataset.b];
    const val = el.type === 'checkbox' ? el.checked
      : (el.tagName === 'SELECT' && !isNaN(+el.value) && el.value !== '' ? +el.value : (el.type === 'number' ? +el.value || 0 : el.value));
    if (scope === 'g') {
      const g = bg(); g[key] = val;
      if (key === 'temp') g.temp = el.value === '' ? null : +el.value;
      if (key === 'turbo' && val) g.speed = 0; // non cumulables
      if (key === 'speed' && val) g.turbo = false;
      sj.set('bonus.global', g);
    } else {
      const b = bjob(scope); b[key] = val; sj.set('bonus.' + scope, b);
    }
    renderPage(); if (page === 'metiers') renderJobCard(job()); changed();
  });

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
    setPrices(map) { setPrices(map); renderPage(); if (page === 'metiers') renderJobCard(job()); changed(); },
    price,
    allItems,
  };

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (PAGES.includes(h) && h !== page) go(h);
    else if (getJob(h) && (h !== cur || page !== 'metiers')) go('metiers', h);
  });
  renderAll();
  if (sess().start) $('#live-dot').hidden = false;
})();
