// Waktool — module zones : « Où aller ? » (zones classées selon ce que tu peux farmer, tous métiers)
import { $, esc, fmt, fmtK, icon, norm, sj } from './util.js?v=502a2738';
import { HARVEST, XP, bonusXp, dur, levelOf, price, qtyStats, zonesIndex } from './model.js?v=502a2738';
import { go } from './main.js?v=502a2738';

const Z_DEF = { jobs: null, sort: 'jobs', q: '', useful: true };
const opts = () => sj.get('zones', Z_DEF);

// intérêt d'une ressource pour toi : statut XP, XP/h, kamas/h (meilleur produit avec un prix)
function evalRes(j, r) {
  const L = levelOf(j.key);
  if (L === null) return { st: 'unknown', xph: 0, kph: null };
  if (r.level > L) return { st: 'locked', xph: 0, kph: null };
  const diff = L - r.level, m = XP.mult(diff), d = dur(j.key, diff, r);
  const xph = 3600 / d * XP.per(diff, bonusXp());
  let kph = null, best = null;
  [...(r.normal || []), ...(r.seed || [])].forEach(it => {
    const p = it && it.id && price(it.id);
    if (p && (kph === null || p > best)) { best = p; kph = 3600 / d * qtyStats(j).avg * p; }
  });
  return { st: m === 1 ? 'full' : m > 0 ? 'part' : 'none', xph, kph };
}

function renderZones() {
  const el = $('#page-zones'), o = opts();
  const withLvl = HARVEST.filter(j => levelOf(j.key) !== null).map(j => j.key);
  const sel = o.jobs || (withLvl.length ? withLvl : HARVEST.map(j => j.key));
  const term = norm(o.q || '');
  let zones = zonesIndex().map(z => {
    const entries = z.entries.filter(e => sel.includes(e.j.key)).map(e => ({ ...e, ...evalRes(e.j, e.r) }));
    const full = entries.filter(e => e.st === 'full');
    const jobs = new Set(full.map(e => e.j.key));
    const kph = Math.max(0, ...entries.map(e => e.kph || 0));
    const xph = Math.max(0, ...entries.map(e => e.xph));
    return { ...z, entries, nFull: full.length, nJobs: jobs.size, kph, xph };
  }).filter(z => z.entries.length);
  if (term) zones = zones.filter(z => norm(`${z.region} ${z.name} ${z.entries.map(e => e.r.name).join(' ')}`).includes(term));
  if (o.useful && withLvl.length) zones = zones.filter(z => z.nFull || z.entries.some(e => e.st === 'part'));
  const cmp = {
    jobs: (a, b) => b.nJobs - a.nJobs || b.nFull - a.nFull || b.kph - a.kph,
    kph: (a, b) => b.kph - a.kph || b.nJobs - a.nJobs,
    xph: (a, b) => b.xph - a.xph || b.nJobs - a.nJobs,
    az: (a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name),
  }[o.sort] || ((a, b) => 0);
  zones.sort(cmp);
  const LBL = { full: 'pleine XP', part: 'XP réduite', none: 'plus d’XP', locked: 'niveau insuffisant', unknown: 'niveau non renseigné' };
  const card = z => {
    const byJob = new Map();
    z.entries.forEach(e => { if (!byJob.has(e.j.key)) byJob.set(e.j.key, []); byJob.get(e.j.key).push(e); });
    return `<article class="zcard">
      <header><div><h3>${esc(z.name)}</h3><p>${esc(z.region)}</p></div>
        <div class="zbadges">${z.nJobs ? `<span class="zb ok">${z.nJobs} métier${z.nJobs > 1 ? 's' : ''} à pleine XP</span>` : ''}${z.kph ? `<span class="zb k">jusqu’à ${fmtK(z.kph)}/h</span>` : ''}</div></header>
      ${[...byJob.entries()].map(([k, es]) => {
        const j = es[0].j;
        return `<div class="zjob"><button type="button" class="jchip" data-zgo="${k}" style="--c:${j.color}" title="Ouvrir ${esc(j.label)}"><img src="${j.icon}" alt="">${esc(j.label)}${levelOf(k) !== null ? ` <small>${levelOf(k)}</small>` : ''}</button>
          <div class="zres">${es.sort((a, b) => a.r.level - b.r.level).map(e => `<span class="zr ${e.st}" title="${esc(e.r.name)} niv. ${e.r.level} · ${LBL[e.st]}${e.xph ? ` · ${fmt(e.xph)} XP/h` : ''}${e.kph ? ` · ${fmtK(e.kph)}/h` : ''}">
            ${icon({ icon: (e.r.normal && e.r.normal[0] || {}).icon, name: e.r.name })}${esc(e.r.name)} <small>${e.r.level}</small>${e.kph ? ` <em>${fmtK(e.kph)}/h</em>` : ''}</span>`).join('')}</div></div>`;
      }).join('')}
    </article>`;
  };
  el.innerHTML = `
    <div class="page-head">
      <h2>Où aller ?</h2>
      <p class="meta">Les zones classées selon ce que tu peux y farmer avec tes niveaux : idéal pour monter plusieurs métiers sur un même trajet.
        <span class="zr full sample">pleine XP</span> <span class="zr part sample">XP réduite</span> <span class="zr none sample">plus d’XP</span> <span class="zr locked sample">trop haut</span></p>
    </div>
    <div class="toolbar">
      <div class="chips">${HARVEST.filter(j => j.key !== 'trappeur').map(j => `<button type="button" class="jchip toggle ${sel.includes(j.key) ? 'on' : ''}" data-zj="${j.key}" style="--c:${j.color}"><img src="${j.icon}" alt="">${esc(j.label)}${levelOf(j.key) !== null ? ` <small>${levelOf(j.key)}</small>` : ''}</button>`).join('')}</div>
      <div class="tb-row">
        <div class="seg">${[['jobs', 'Multi-métiers'], ['kph', 'Kamas/h'], ['xph', 'XP/h'], ['az', 'A → Z']].map(([v, l]) => `<button type="button" data-zs="${v}" class="${o.sort === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="chk"><input type="checkbox" data-zo="useful" ${o.useful ? 'checked' : ''}> Zones utiles seulement</label>
        <input type="search" class="tb-search" data-zo="q" value="${esc(o.q || '')}" placeholder="Zone, région, ressource…">
      </div>
    </div>
    ${!withLvl.length ? '<p class="empty">Renseigne tes niveaux (onglet Métiers ou capture de la fenêtre Métiers) pour classer les zones.</p>' : ''}
    <p class="meta">${zones.length} zone${zones.length > 1 ? 's' : ''} · le Trappeur n’apparaît pas (ses ressources viennent des monstres, pas des zones).</p>
    <div class="zgrid">${zones.map(card).join('') || '<p class="empty">Aucune zone ne correspond.</p>'}</div>`;
}
const zel = $('#page-zones');
zel.addEventListener('click', e => {
  const o = opts();
  const zj = e.target.closest('[data-zj]'), zs = e.target.closest('[data-zs]'), zg = e.target.closest('[data-zgo]');
  if (zg) { go('metiers', zg.dataset.zgo); return; }
  if (zj) {
    const withLvl = HARVEST.filter(j => levelOf(j.key) !== null).map(j => j.key);
    let s = o.jobs || (withLvl.length ? withLvl : HARVEST.map(j => j.key));
    o.jobs = s.includes(zj.dataset.zj) ? s.filter(k => k !== zj.dataset.zj) : [...s, zj.dataset.zj];
  } else if (zs) o.sort = zs.dataset.zs; else return;
  sj.set('zones', o); renderZones();
});
zel.addEventListener('change', e => {
  const el = e.target.closest('[data-zo]');
  if (!el) return;
  const o = opts(); o[el.dataset.zo] = el.type === 'checkbox' ? el.checked : el.value;
  sj.set('zones', o); renderZones();
});
export { renderZones };
