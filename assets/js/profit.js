// Waktool — module profit
import { st } from './state.js?v=ce18e5b8';
import { $, esc, fmt, fmtK, icon, norm, sj } from './util.js?v=ce18e5b8';
import { HARVEST, PRICES, RD, XP, levelOf, loadRecipes, priceInput, profitRows } from './model.js?v=ce18e5b8';
import { chk } from './side.js?v=ce18e5b8';
import { segHtml } from './metiers.js?v=ce18e5b8';
// ================================================================ page Rentabilité
function renderProfit() {
  const el = $('#page-rentabilite');
  const o = sj.get('profit', { jobs: null, access: true, craft: true, sort: 'kph', q: '' });
  const withLvl = HARVEST.filter(j => levelOf(j.key) !== null).map(j => j.key);
  const sel = o.jobs || (withLvl.length ? withLvl : HARVEST.map(j => j.key));
  const missingRec = o.craft && sel.some(k => !RD[k]);
  if (missingRec) Promise.all(sel.map(loadRecipes)).then(() => st.page === 'rentabilite' && renderProfit());
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
      : `${esc(r.r.name)} · ${r.kind}`}<span class="mob"> · ${esc(r.j.label)} ${r.r.level}</span></small></div></div></td>
    <td class="col-job"><span class="jchip" style="--c:${r.j.color}"><img src="${r.j.icon}" alt="">${esc(r.j.label)} ${r.r.level}</span></td>
    <td class="num">${priceInput(r.it, 'small')}</td>
    <td class="num col-qty">${fmt(r.qph)}</td>
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
      <thead><tr><th>#</th><th>Produit</th><th class="col-job">Métier</th><th class="num">Prix u.</th><th class="num col-qty">Qté/h</th><th class="num">XP/h</th><th class="num">Kamas/h</th></tr></thead>
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

export { renderProfit };
