// Waktool — module model
import { st } from './state.js?v=d5853ef8';
import { D, icon, jget, norm, sj, store } from './util.js?v=d5853ef8';

import { job, renderPage } from './main.js?v=d5853ef8';
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
// historique des prix : { id: [t1, p1, t2, p2, …] } (tableau à plat : Firestore n'accepte pas les tableaux imbriqués)
const PHIST = () => jget('phist', {}) || {};
const HIST_MAX = 30;
function setPrices(map) {
  const all = PRICES(), hist = PHIST(), now = Date.now();
  for (const [id, v] of Object.entries(map)) {
    if (v === null || v === '' || isNaN(+v) || +v <= 0) { delete all[id]; continue; }
    const p = Math.round(+v);
    all[id] = [p, now];
    const h = hist[id] || [];
    // nouvelle entrée si le prix change, sinon on rafraîchit la date de la dernière
    if (h.length && h[h.length - 1] === p) h[h.length - 2] = now; else h.push(now, p);
    hist[id] = h.slice(-HIST_MAX * 2);
  }
  store.set('prices', JSON.stringify(all));
  store.set('phist', JSON.stringify(hist));
}
// ancienneté d'un prix en jours, et tendance par rapport au prix précédent (différent)
const priceAge = id => { const p = PRICES()[id]; return p ? (Date.now() - p[1]) / 864e5 : null; };
function priceTrend(id) {
  const h = PHIST()[id];
  if (!h || h.length < 4) return null;
  const last = h[h.length - 1], prev = h[h.length - 3];
  return prev ? { prev, pct: (last - prev) / prev * 100 } : null;
}
function priceHistoryText(id) {
  const h = PHIST()[id] || [];
  const out = [];
  for (let i = h.length - 2; i >= 0 && out.length < 8; i -= 2) out.push(`${new Date(h[i]).toLocaleDateString('fr-FR')} : ${h[i + 1].toLocaleString('fr-FR')} ₭`);
  return out.join('\n');
}
const priceInput = (it, cls = '') => {
  const P = PRICES()[it.id], age = priceAge(it.id), tr = priceTrend(it.id);
  const stale = age === null ? '' : age > 30 ? 'old' : age > 7 ? 'stale' : '';
  const title = P ? `Prix du ${new Date(P[1]).toLocaleDateString('fr-FR')}${stale ? ' (à mettre à jour)' : ''}${priceHistoryText(it.id) ? '\nHistorique :\n' + priceHistoryText(it.id) : ''}` : 'Prix unitaire HDV';
  return `<span class="pin-price ${cls} ${stale}" title="${title.replace(/"/g, '&quot;')}"><input type="number" min="0" inputmode="numeric" data-price="${it.id}" value="${P ? P[0] : ''}" placeholder="prix"><i>₭</i>${tr && Math.abs(tr.pct) >= 1 ? `<b class="trend ${tr.pct > 0 ? 'up' : 'down'}">${tr.pct > 0 ? '↗' : '↘'}${Math.abs(Math.round(tr.pct))} %</b>` : ''}</span>`;
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
const G_DEF = { region: null, temp: null, climMalus: 50, plantPct: 70, wakfu: 0, havre: false, stasis: 0, turbo: false, xpExtra: 0, speed: 0,
  sceau: false, potion: false, pacte: 0, mdc: 0, captchat: 0, qtyExtra: 0 };
const J_DEF = { tool: 'auto', pet: '', petLvl: 50, conso: false, casque: false, sacs: 0, gateau: false };
const REGION = [
  { v: -10, stars: 0, img: 'img/ui/region-0.png', label: 'Aucune volonté respectée' },
  { v: 10, stars: 1, img: 'img/ui/region-1.png', label: 'Volontés partiellement respectées' },
  { v: 30, stars: 2, img: 'img/ui/region-2.png', label: 'Toutes les volontés respectées' },
];
const bg = () => sj.get('bonus.global', G_DEF);
const bjob = k => sj.get('bonus.' + k, J_DEF);
// métiers où l'on plante (graines/boutures) : la plantation donne la même XP de base que la récolte
const PLANTABLE = ['paysan', 'forestier', 'herboriste'];
// bonus d'XP de plantation : région, Havre-Monde, Source de Wakfu, autre (Stasis et Turbo ne concernent que la récolte)
function bonusPlant() {
  const g = bg();
  return (g.region ?? 0) + (g.havre ? 10 : 0) + (+g.wakfu || 0) + (+g.xpExtra || 0);
}
const plantChance = () => Math.max(1, Math.min(100, +bg().plantPct || 70)) / 100;
// cycle « champ perso » sur la ressource r au niveau L : tentatives de plantation (XP si réussite),
// coupe de la plante, et récolte des graines nécessaires pour replanter (XP de récolte aussi)
function fieldCycle(j, r, L, qAvg) {
  const diff = Math.max(0, L - r.level), d = dur(j.key, diff, r), p = plantChance();
  const plants = 1 / p, seedActs = plants / Math.max(qAvg, 0.01);
  const acts = plants + 1 + seedActs;
  const xp = XP.per(diff, bonusPlant()) + XP.per(diff, bonusXp()) * (1 + seedActs);
  return { r, d, plants, seedActs, acts, time: acts * d, xp };
}
function bestField(j, L, qAvg) {
  if (!PLANTABLE.includes(j.key)) return null;
  let best = null;
  for (const r of j.resources) {
    if (r.level > L || !(r.seed || []).length || !XP.mult(L - r.level)) continue;
    const c = fieldCycle(j, r, L, qAvg);
    if (!best || c.xp / c.time > best.xp / best.time) best = c;
  }
  return best;
}

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
// renvoie les recettes si déjà chargées, sinon lance le chargement et re-rend la st.page à l'arrivée
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
    if (strat === 'plant') {
      const f = bestField(j, L, qAvg);
      if (f) best = { rate: f.xp / f.time, kind: 'p', f };
    }
    if (data) for (const r of data.recipes) {
      const c = craftCycle(j, r, L, qAvg, bonus);
      if (c && c.cx / c.ct > best.rate) best = { rate: c.cx / c.ct, kind: 'c', ...c };
    }
    if (best.kind === 'p') {
      const f = best.f, cycles = need / f.xp;
      actions += cycles * f.acts; time += cycles * f.time;
      addTo(res, f.r.name, cycles, { r: f.r, items: 0, plants: 0, seedActs: 0 });
      const o = res.get(f.r.name);
      o.items += cycles * qAvg; o.plants += cycles * f.plants; o.seedActs += cycles * f.seedActs;
    } else if (best.kind === 'h') {
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

// ================================================================ assistant d'objectif
// plantation dans la nature (réglages page Objectif) : plants sauvages trouvés en arrivant sur un spot, plants max
// entretenus sur le spot, temps de pousse (s), graines récoltées sur chaque plant avant de le couper
const FIELD_DEF = { wild: 40, cap: 100, grow: 300, allSeeds: true };
// cycle d'un plant : planter (1/p tentatives, XP si ça prend) → pousse → récolter les graines → couper (objets).
// La pousse ne freine que si l'on a trop peu de plants : chaque plant ne repasse qu'après `grow` secondes.
function plantCycle(j, r, L, qAvg, fd = FIELD_DEF) {
  const diff = Math.max(0, L - r.level), d = dur(j.key, diff, r), plants = 1 / plantChance();
  const seedActs = fd.allSeeds ? Math.max(1, plants / qAvg) : plants / qAvg;
  const a = (plants + 1 + seedActs) * d;
  const time = Math.max(a, (fd.grow + a) / Math.max(1, fd.cap));
  return { d, plants, seedActs, a, time, growBound: time > a + 1e-9, xp: XP.per(diff, bonusPlant()) + XP.per(diff, bonusXp()) * (1 + seedActs) };
}
// attente à l'arrivée sur un spot : on récolte les graines des plants sauvages, on replante, on coupe les sauvages,
// puis on attend que les premiers plants plantés aient poussé (s'il reste du temps)
function spotIdle(j, rs, L, qAvg, fd = FIELD_DEF) {
  let busy = 0;
  for (const r of rs) {
    if (!PLANTABLE.includes(j.key) || !(r.seed || []).length) return 0;
    const d = dur(j.key, Math.max(0, L - r.level), r);
    const n = Math.min(fd.wild * qAvg, Math.max(0, fd.cap - fd.wild) / plantChance()); // tentatives de plantation
    busy += (n + fd.wild) * d;
  }
  return Math.max(0, fd.grow - busy);
}
// coût d'un objet d'une ressource au niveau L : XP gagnée et temps passé pour le ramasser.
// plant = on replante les graines dans la nature (voir plantCycle), sinon récolte seule.
function gatherUnit(j, r, L, qAvg, plant, fd = FIELD_DEF) {
  const diff = Math.max(0, L - r.level);
  if (plant && PLANTABLE.includes(j.key) && (r.seed || []).length) {
    const f = plantCycle(j, r, L, qAvg, fd);
    return { xp: f.xp / qAvg, t: f.time / qAvg, plants: f.plants / qAvg, cuts: 1 / qAvg, seedActs: f.seedActs / qAvg, growBound: f.growBound };
  }
  return { xp: XP.per(diff, bonusXp()) / qAvg, t: dur(j.key, diff, r) / qAvg, plants: 0, cuts: 1 / qAvg, seedActs: 0 };
}
const CRAFT_T = 2; // s par craft (atelier), approximatif
// option « récolter les ingrédients d'une recette puis crafter » au niveau L pour gagner `need` XP, stock S déjà en sac.
// Renvoie le nombre de crafts (continu) et le temps, ou null si la recette n'est pas faisable.
function craftOption(j, rec, L, qAvg, plant, need, S, fd = FIELD_DEF) {
  if (rec.up || rec.level > L || !rec.ing.length) return null;
  const c = Math.floor(rec.xp * XP.mult(L - rec.level));
  if (!c) return null;
  const ing = [];
  for (const i of rec.ing) {
    const rr = resOfItem(j, i.item.id);
    if (!rr || rr.level > L || (rr.rare || []).some(x => x.id === i.item.id)) return null;
    ing.push({ item: i.item, qty: i.qty, rr, u: gatherUnit(j, rr, L, qAvg, plant, fd), have: Math.max(0, S[i.item.name] || 0) });
  }
  const xpOf = N => N * c + ing.reduce((a, g) => a + Math.max(0, g.qty * N - g.have) * g.u.xp, 0);
  let lo = 0, hi = need / c;
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (xpOf(m) >= need) hi = m; else lo = m; }
  const N = hi, t = ing.reduce((a, g) => a + Math.max(0, g.qty * N - g.have) * g.u.t, 0) + N * CRAFT_T;
  return { kind: 'c', key: 'c:' + rec.id, rec, N, t, c, ing };
}
// zones d'une ressource (index des zones) et groupes de ressources récoltables au même endroit
let RZ = null;
function resZones(r) {
  if (!RZ) {
    RZ = new Map();
    zonesIndex().forEach(z => z.entries.forEach(e => { if (!RZ.has(e.r)) RZ.set(e.r, []); RZ.get(e.r).push(z); }));
  }
  return RZ.get(r) || [];
}
// ressources → spots : deux ressources qui ont une zone en commun se récoltent sans trajet entre elles
// (chaque groupe garde les zones communes à toutes ses ressources)
function spotGroups(rs) {
  const groups = [];
  for (const r of rs) {
    const keys = new Set(resZones(r).map(z => z.key));
    const g = keys.size && groups.find(g => g.zones.size && [...keys].some(k => g.zones.has(k)));
    if (g) { g.zones = new Set([...g.zones].filter(k => keys.has(k))); g.rs.push(r); } else groups.push({ zones: keys, rs: [r] });
  }
  return groups;
}
const sharesSpot = (a, b) => a.some(x => b.some(y => [...y.zones].some(k => x.zones.has(k))));
// trajets pour passer d'une option à l'autre : un par spot, sauf si on est déjà dans une zone du nouveau
const hops = (prev, cur) => cur.length - (prev && sharesSpot(prev, cur) ? 1 : 0);
// temps perdu en changeant d'option : trajets + attente de pousse sur chaque nouveau spot
const switchCost = (prev, cur, travel) => travel * hops(prev, cur) + cur.reduce((a, g) => a + (g.idle || 0), 0);

// plan vers un objectif de niveau. Changer de spot coûte un trajet (travel, en s) : on cherche le chemin le plus court
// en temps total (récolte + crafts + trajets) par programmation dynamique sur les niveaux, ce qui évite de changer de
// ressource pour un gain minime. Une étape « craft » = aller récolter chaque ingrédient (un trajet par ingrédient).
// Le stock en sac sert d'abord (il est consommé au fil du plan). En plantation, chaque nouveau spot coûte aussi
// l'attente de la première pousse (voir spotIdle).
function goalPlan(j, from, x0, to, stock = {}, { plant = true, craft = true, travel = 180, field = FIELD_DEF } = {}) {
  const data = craft ? RD[j.key] : null, q = qtyStats(j).avg || 1, fd = { ...FIELD_DEF, ...field };
  const withIdle = (groups, L) => { if (plant) groups.forEach(g => { g.idle = spotIdle(j, g.rs, L, q, fd); }); return groups; };
  const needOf = L => Math.max(0, XP.need(L) - (L === from ? x0 : 0));
  // 1) coût de chaque option à chaque niveau (stock pris en compte au premier niveau seulement)
  const lv = [];
  for (let L = from; L < to; L++) {
    const need = needOf(L), opts = new Map();
    for (const r of j.resources) {
      if (r.level > L) continue;
      const u = gatherUnit(j, r, L, q, plant, fd);
      if (u.xp) opts.set('g:' + r.name, { t: need / u.xp * u.t, groups: withIdle(spotGroups([r]), L) });
    }
    if (data) for (const rec of data.recipes) {
      const o = craftOption(j, rec, L, q, plant, need, L === from ? stock : {}, fd);
      if (o) opts.set(o.key, { t: o.t, groups: withIdle(spotGroups(o.ing.filter(g => g.qty * o.N > g.have).map(g => g.rr)), L) });
    }
    lv.push(opts);
  }
  // 2) programmation dynamique : rester sur la même option ne coûte pas de trajet, changer coûte un trajet
  //    par nouveau spot (aucun si la nouvelle ressource pousse dans une zone où l'on est déjà)
  let prev = null, prevOpts = null;
  const back = [];
  for (const opts of lv) {
    const cur = new Map();
    for (const [k, o] of opts) {
      let best = null;
      if (!prev) best = { c: o.t + switchCost(null, o.groups, travel), p: null };
      else for (const [pk, pv] of prev) {
        const c = pv.c + o.t + (pk === k ? 0 : switchCost(prevOpts.get(pk).groups, o.groups, travel));
        if (!best || c < best.c) best = { c, p: pk };
      }
      cur.set(k, best);
    }
    back.push(cur);
    prev = cur; prevOpts = opts;
    if (!cur.size) break;
  }
  const path = [];
  let k = null;
  if (prev && prev.size) { for (const [kk, v] of prev) if (k === null || v.c < prev.get(k).c) k = kk; }
  for (let i = back.length - 1; i >= 0 && k !== null; i--) { path[i] = k; k = back[i].get(k).p; }
  // 3) on rejoue le chemin avec le stock pour obtenir les quantités
  const S = { ...stock }, steps = [];
  let time = 0, xpTotal = 0, blocked = null, travels = 0, idle = 0;
  for (let i = 0; i < lv.length; i++) {
    const L = from + i, need = needOf(L), key = path[i];
    xpTotal += need;
    if (!key) { blocked = L; break; }
    let best;
    if (key[0] === 'g') {
      const r = j.resources.find(x => 'g:' + x.name === key), u = gatherUnit(j, r, L, q, plant, fd);
      best = { kind: 'g', key, r, u, n: need / u.xp, t: need / u.xp * u.t };
    } else best = craftOption(j, data.recipes.find(x => 'c:' + x.id === key), L, q, plant, need, S, fd);
    time += best.t;
    let st = steps[steps.length - 1];
    if (!st || st.key !== best.key) {
      st = best.kind === 'g' ? { kind: 'g', key: best.key, r: best.r, from: L, to: L, items: 0, plants: 0, cuts: 0, seedActs: 0, t: 0, xp: 0 }
        : { kind: 'c', key: best.key, rec: best.rec, from: L, to: L, crafts: 0, t: 0, xp: 0, ing: best.ing.map(g => ({ item: g.item, qty: g.qty, rr: g.rr, need: 0, fromStock: 0, gather: 0, plants: 0, cuts: 0, seedActs: 0 })) };
      steps.push(st);
    }
    st.to = L + 1; st.t += best.t; st.xp += need;
    const acts = (o, u, n) => { o.plants += n * u.plants; o.cuts += n * u.cuts; o.seedActs += n * u.seedActs; };
    if (best.kind === 'g') { st.items += best.n; acts(st, best.u, best.n); }
    else {
      st.crafts += best.N;
      best.ing.forEach((g, n) => {
        const o = st.ing[n], use = g.qty * best.N, fromStock = Math.min(g.have, use);
        o.need += use; o.fromStock += fromStock; o.gather += use - fromStock; acts(o, g.u, use - fromStock);
        S[g.item.name] = g.have - fromStock;
      });
    }
  }
  // trajets : un par spot de chaque étape, sauf si l'étape précédente était déjà dans une de ses zones
  let pg = null;
  steps.forEach(st => {
    st.groups = withIdle(spotGroups(st.kind === 'g' ? [st.r] : st.ing.filter(o => o.gather >= 0.5).map(o => o.rr)), st.from);
    st.spots = st.groups.length; st.hops = hops(pg, st.groups); travels += st.hops;
    st.idle = st.groups.reduce((a, g) => a + (g.idle || 0), 0); idle += st.idle;
    if (st.groups.length) pg = st.groups;
  });
  return { steps, time: time + travels * travel + idle, farm: time, travels, travel, idle, xp: xpTotal, blocked };
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

export { FIELD_DEF, plantCycle, spotIdle, resZones, spotGroups, gatherUnit, craftOption, goalPlan, CRAFT_T, PHIST, priceAge, priceTrend, priceHistoryText, PLANTABLE, bonusPlant, plantChance, fieldCycle, bestField, XP, PRICES, price, setPrices, priceInput, CRAFTS, ALL, HARVEST, getJob, lvlKey, levelOf, xpOf, pins, setPins, G_DEF, J_DEF, REGION, bg, bjob, bonusXp, speedMult, climate, climK, dur, activeTool, qtyParts, qtyStats, bestAt, addXp, RARITY, RD, RP, loadRecipes, needRecipes, srcLabel, prodLabel, resOfItem, allItemsP, allItems, addTo, craftCycle, harvestPlan, craftPlan, profitRows };

// ================================================================ zones (« Où aller ? »)
// Les zones viennent du texte MethodWakfu (« Région - zone1, zone2 & zone3 »), hétérogène : on normalise.
const REGION_ALIAS = { 'brakmar': 'Brâkmar', 'erebora': 'Ereboria', 'ile wabbit': 'Île des Wabbits', 'royaume de chuchoku': 'Royaume Chuchoku' };
const zkey = s => norm(s).replace(/[’']/g, "'").replace(/[^a-z0-9' ()]/g, ' ').replace(/\s+/g, ' ').trim();
const tidy = s => s.replace(/’/g, "'").replace(/\b(\w+) \1\b/g, '$1').replace(/\s+/g, ' ').trim();
let ZONES = null;
function zonesIndex() {
  if (ZONES) return ZONES;
  const parsed = [];
  HARVEST.forEach(j => j.resources.forEach(r => {
    (r.zones || []).forEach(line => {
      let region = null, rest = tidy(line);
      const m = rest.match(/^(.+?) - (.+)$/);
      if (m) { region = m[1]; rest = m[2]; }
      // « Mine d'Amakna - Galeries », « Haut Flanc - Blérox (Zinit) »
      const mine = region && region.match(/^Mines? (?:de |d'|de la )(.+)$/i);
      if (mine) { rest = `${region} (${rest})`; region = mine[1]; }
      if (region && /\(Zinit\)$/.test(rest)) { rest = `${region} (${rest.replace(/ \(Zinit\)$/, '')})`; region = 'Zinit'; }
      if (region) region = REGION_ALIAS[zkey(region)] || region;
      rest.split(/\s*,\s*|\s+&\s+/).filter(Boolean).forEach(z => {
        z = z.replace(/^(Grotte du Dor'Mor) Zinit$/, '$1');
        parsed.push({ region, zone: z, j, r });
      });
    });
    (r.zones_en || []).forEach(z => parsed.push({ region: 'Zones récentes (noms EN)', zone: z, j, r }));
  }));
  // région des zones citées sans région : déduite des autres mentions, du nom, sinon la zone elle-même
  const regionOf = {};
  parsed.forEach(p => { if (p.region) regionOf[zkey(p.zone)] ||= p.region; });
  const regions = [...new Set(parsed.map(p => p.region).filter(Boolean))];
  const loose = [...new Set(parsed.filter(p => !p.region).map(p => p.zone))]; // îles / zones isolées (Kelba, Saharach…)
  parsed.forEach(p => {
    if (p.region) return;
    const k = zkey(p.zone);
    p.region = regionOf[k] || regions.find(rg => k.includes(zkey(rg)) && zkey(rg).length > 3)
      || loose.find(z => z !== p.zone && k.includes(zkey(z))) || p.zone;
  });
  const map = new Map();
  parsed.forEach(p => {
    const k = zkey(p.region) + '|' + zkey(p.zone);
    if (!map.has(k)) map.set(k, { key: k, region: p.region, name: p.zone, entries: [] });
    const z = map.get(k);
    if (!z.entries.some(e => e.j === p.j && e.r === p.r)) z.entries.push({ j: p.j, r: p.r });
  });
  ZONES = [...map.values()];
  return ZONES;
}
export { zonesIndex };

// ================================================================ liste de courses : acheter ou farmer, arbre de craft
// temps pour récolter soi-même `qty` exemplaires d'un objet (selon ton niveau et tes bonus)
function farmInfo(it, qty) {
  if (!it || !it.src) return null;
  const j = getJob(it.src.split(':')[0]);
  if (!j || j.type !== 'harvest') return null;
  const r = resOfItem(j, it.id), L = levelOf(j.key);
  if (!r) return null;
  if ((r.rare || []).some(x => x.id === it.id)) return { j, r, rare: true };
  if (L === null || r.level > L) return { j, r, locked: true };
  const d = dur(j.key, L - r.level, r), q = qtyStats(j).avg || 1;
  return { j, r, time: qty / q * d };
}
// déplie les ingrédients fabriquables (recette de base la moins haute du métier producteur) jusqu'aux
// ressources brutes. Renvoie { raw: Map(id -> {item, n}), crafts: Map(id -> {r, n, job}), pending: [métiers à charger] }
function expandShopping(ingMap, maxDepth = 6) {
  const raw = new Map(), crafts = new Map(), pending = new Set();
  const recipeFor = it => {
    for (const k of it.prod || []) {
      if (!RD[k]) { pending.add(k); continue; }
      const cands = RD[k].recipes.filter(r => !r.up && r.res.item.id === it.id);
      if (cands.length) return { r: cands.sort((a, b) => a.level - b.level)[0], job: k };
    }
    return null;
  };
  const walk = (it, n, depth, path) => {
    const rc = !it.src && depth < maxDepth && !path.has(it.id) ? recipeFor(it) : null;
    if (!rc) { addTo(raw, it.id, n, { item: it }); return; }
    const times = n / rc.r.res.qty;
    addTo(crafts, rc.r.id, times, { r: rc.r, job: rc.job });
    const p2 = new Set(path).add(it.id);
    rc.r.ing.forEach(i => walk(i.item, times * i.qty, depth + 1, p2));
  };
  ingMap.forEach(o => walk(o.item, o.n, 0, new Set()));
  return { raw, crafts, pending: [...pending] };
}
export { farmInfo, expandShopping };
