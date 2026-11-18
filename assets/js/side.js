// Waktool — module side
import { st } from './state.js?v=502a2738';
import { $, changed, esc, fmt, fmt1, fmtK, sec, sj, store } from './util.js?v=502a2738';
import { HARVEST, REGION, XP, activeTool, bestAt, bg, bjob, bonusXp, climate, levelOf, price, qtyStats } from './model.js?v=502a2738';
import { renderJobCard } from './metiers.js?v=502a2738';
import { job, renderPage } from './main.js?v=502a2738';
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
      <label class="bchk" title="70 % normalement, 56 % si l'humidité ne convient pas à la plante, 60 % en Havre-Sac">Chance de plantation <span class="unit"><input type="number" data-b="g:plantPct" value="${+g.plantPct || 70}" min="1" max="100"><i>%</i></span></label>
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
      <label class="bchk">Source de Stasis ${selB('g:stasis', g.stasis, [[0, 'non'], [10, '+10 %'], [20, '+20 %']])} <em>récolte</em></label>
      <label class="bchk">Source de Wakfu ${selB('g:wakfu', g.wakfu, [[0, 'non'], [20, '+20 %'], [30, '+30 %'], [40, '+40 %']])} <em>plantation</em></label>
      ${chk('g:turbo', g.turbo, 'Turbo Craft 30', ' <em>+100 % récolte</em>')}
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
  const showSide = st.page !== 'metiers' || j.type === 'harvest';
  $('#layout').classList.toggle('noside', !showSide);
  if (!showSide) { side.innerHTML = ''; return; }
  const more = store.get('ui.bmore') !== '0';
  if ((st.page === 'rentabilite' || st.page === 'zones')) {
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
  sj.set('bonus.global', g); renderPage(); if (st.page === 'metiers') renderJobCard(job()); changed();
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
  renderPage(); if (st.page === 'metiers') renderJobCard(job()); changed();
});

export { chk, selB, climCount, situationHtml, globalMoreHtml, jobEquipHtml, summaryHtml, renderSide, side };
