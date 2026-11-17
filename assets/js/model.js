// Waktool — module model
import { st } from './state.js?v=aec81dce';
import { D, icon, jget, norm, sj, store } from './util.js?v=aec81dce';

import { job, renderPage } from './main.js?v=aec81dce';
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

export { PLANTABLE, bonusPlant, plantChance, fieldCycle, bestField, XP, PRICES, price, setPrices, priceInput, CRAFTS, ALL, HARVEST, getJob, lvlKey, levelOf, xpOf, pins, setPins, G_DEF, J_DEF, REGION, bg, bjob, bonusXp, speedMult, climate, climK, dur, activeTool, qtyParts, qtyStats, bestAt, addXp, RARITY, RD, RP, loadRecipes, needRecipes, srcLabel, prodLabel, resOfItem, allItemsP, allItems, addTo, craftCycle, harvestPlan, craftPlan, profitRows };

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
