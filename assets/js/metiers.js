// Waktool — module metiers
import { st } from './state.js?v=7681952f';
import { $, D, ago, changed, esc, fmt, fmt1, fmtDur, fmtK, icon, norm, sec, store } from './util.js?v=7681952f';
import { touchProg, expandShopping, farmInfo, PLANTABLE, bonusPlant, plantChance, PRICES, RARITY, RD, XP, bestAt, bonusXp, climate, craftPlan, dur, getJob, harvestPlan, levelOf, lvlKey, needRecipes, pins, price, priceInput, prodLabel, qtyStats, setPrices, srcLabel, xpOf } from './model.js?v=7681952f';
import { renderSide } from './side.js?v=7681952f';
import { renderProfit } from './profit.js?v=7681952f';
import { go, job, renderPage, renderTabs, subOf, togglePin } from './main.js?v=7681952f';
// ================================================================ page Métiers
const q = $('#q'), only = $('#only'), xponly = $('#xponly');
only.checked = store.get('only') === '1';
xponly.checked = store.get('xponly') === '1';
q.addEventListener('input', () => renderContent());
only.addEventListener('input', () => { store.set('only', only.checked ? '1' : '0'); renderContent(); changed(); });
xponly.addEventListener('input', () => { store.set('xponly', xponly.checked ? '1' : '0'); renderContent(); changed(); });
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
  store.set('sub.' + st.cur, b.dataset.sub); recLimit = 120; renderMetiers();
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
  const k = { lvl: lvlKey(st.cur), xp: 'xp.' + st.cur, target: 'target.' + st.cur }[el.dataset.jc];
  // changement de niveau : l'XP actuelle repart de 0 (valeur explicite, pour écraser aussi celle du compte)
  if (el.dataset.jc === 'lvl' && el.value !== (store.get(k) ?? '')) store.set('xp.' + st.cur, '0');
  store.set(k, el.value);
  if (el.dataset.jc !== 'target') touchProg(st.cur);
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
    if (xponly.checked && L !== null && (r.level > L || !XP.mult(L - r.level))) return false;
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
    if (xponly.checked && L !== null && (r.level > L || !XP.mult(L - r.level))) return false;
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
  const pl = harvestPlan(j, L, xp, tg, strat), alt = harvestPlan(j, L, xp, tg, strat === 'harvest' ? 'craft' : 'harvest');
  const qa = qtyStats(j).avg;
  const nCraft = [...pl.crafts.values()].reduce((a, c) => a + Math.ceil(c.n), 0);
  let kam = 0;
  const resRows = [...pl.res.values()].sort((a, b) => a.r.level - b.r.level).map(o => {
    const main = (o.r.normal || [])[0], p = main && price(main.id);
    if (p && strat !== 'craft') kam += o.items * p;
    if (strat === 'plant') {
      return `<li>${icon({ icon: o.r.appearance || (main || {}).icon, name: o.r.name })}<span><b>${esc(o.r.name)}</b> <small>niv. ${o.r.level}</small><br>
        <small><b>${fmt(Math.ceil(o.plants))}</b> plantations · <b>${fmt(Math.ceil(o.n))}</b> coupes · <b>${fmt(Math.ceil(o.seedActs))}</b> récoltes de graines
        → ≈ ${fmt(o.items)} ${esc((main || {}).name || 'ressources')}${p ? ` · ${fmtK(o.items * p)}` : ''}</small></span></li>`;
    }
    return `<li>${icon({ icon: o.r.appearance || (main || {}).icon, name: o.r.name })}<span><b>${fmt(Math.ceil(o.n))}</b> récoltes · ${esc(o.r.name)} <small>niv. ${o.r.level}</small><br>
      <small>≈ ${fmt(o.items)} ${esc((main || {}).name || 'ressources')}${p && strat === 'harvest' ? ` · ${fmtK(o.items * p)}` : ''}</small></span></li>`;
  }).join('');
  return `<div class="panel">
    <div class="panel-head">
      <h3>Niv. ${L} → ${tg}</h3>
      ${segHtml('strat', strat, [['harvest', 'Récolte', 'Récolter les ressources déjà présentes dans la nature'],
        ...(PLANTABLE.includes(j.key) ? [['plant', 'Champ perso', 'Planter, couper et récolter les graines pour replanter (autonome)']] : []),
        ['craft', 'Récolte + craft', 'Transformer les ressources récoltées quand c’est plus rentable en XP']])}
    </div>
    <div class="kpis">
      <div class="kpi"><span>XP à gagner</span><b>${fmt(pl.xp)}</b></div>
      <div class="kpi"><span>${strat === 'plant' ? 'Actions' : 'Récoltes'}</span><b>${fmt(pl.actions)}</b>${nCraft ? `<small>+ ${fmt(nCraft)} crafts</small>` : strat === 'plant' ? '<small>plantations + coupes + graines</small>' : ''}</div>
      <div class="kpi"><span>Durée estimée</span><b>~${fmtDur(pl.time)}</b>${isFinite(alt.time) && alt.time !== pl.time ? `<small>${strat === 'harvest' ? 'avec craft' : 'récolte seule'} : ~${fmtDur(alt.time)}</small>` : ''}</div>
      ${kam ? `<div class="kpi"><span>Valeur récoltée</span><b class="kph">${fmtK(kam)}</b><small>au prix HDV</small></div>` : ''}
    </div>
    <div class="cols">
      <div><h4>À récolter</h4><ul class="plist">${resRows}</ul></div>
      ${pl.crafts.size ? `<div><h4>À crafter <small>(atelier du métier)</small></h4><ul class="plist">${craftListHtml(pl.crafts)}</ul></div>` : ''}
    </div>
    <p class="meta">Estimation avec ${fmt1(qa)} ressources par récolte et les bonus actifs, sans déplacements.
      ${strat === 'craft' ? 'XP des recettes = valeur de base du jeu (à confirmer en jeu).' : ''}
      ${strat === 'plant' ? `Champ perso : ${Math.round(plantChance() * 100)} % de réussite de plantation, même XP de base qu’une récolte (bonus de plantation : ${bonusPlant() >= 0 ? '+' : ''}${bonusPlant()} %). Temps de pousse non compté.` : ''}</p>
  </div>`;
}

// une ligne de liste de courses : quantité, prix, et temps pour la farmer soi-même
function shopLine(o) {
  const f = farmInfo(o.item, o.n), p = price(o.item.id);
  const farm = !f ? '' : f.rare ? '<span class="farm na" title="Ressource rare (1 % des plantes)">rare</span>'
    : f.locked ? `<span class="farm na" title="${esc(f.j.label)} niveau ${f.r.level} requis">🔒 ${esc(f.j.label)} ${f.r.level}</span>`
      : `<span class="farm" title="Temps pour récolter ${fmt(o.n)} ${esc(o.item.name)} toi-même (${esc(f.r.name)}, bonus actifs, sans déplacements)">⏱ ${fmtDur(f.time)}${p ? ` · ${fmtK(p * o.n / (f.time / 3600))}/h` : ''}</span>`;
  return `<li>${ingChip({ item: o.item }, o.n)} ${farm}</li>`;
}
function shopTotals(list) {
  let cost = 0, miss = 0, farm = 0, nFarm = 0;
  list.forEach(o => {
    const p = price(o.item.id); if (p) cost += p * o.n; else miss++;
    const f = farmInfo(o.item, o.n); if (f && f.time) { farm += f.time; nFarm++; }
  });
  return { cost, miss, farm, nFarm };
}

function craftPlanHtml(j) {
  const L = levelOf(j.key);
  if (!needRecipes(j.key)) return '<p class="empty">Chargement des recettes…</p>';
  if (L === null) return '<p class="empty">Renseigne ton niveau dans la carte du métier pour obtenir un plan.</p>';
  const tg = targetOf(j, L);
  if (tg <= L) return '<p class="empty">Choisis un objectif supérieur à ton niveau.</p>';
  const metric = store.get('metric.' + j.key) || 'crafts', withUp = store.get('withup.' + j.key) === '1';
  const deep = store.get('deep.' + j.key) === '1';
  const pl = craftPlan(j, L, Math.min(xpOf(j.key), XP.need(L) - 1), tg, metric, withUp);
  let ings = [...pl.ing.values()], sub = null;
  if (deep) {
    const ex = expandShopping(pl.ing);
    ex.pending.forEach(k => needRecipes(k)); // charge les métiers producteurs, re-rendu à l'arrivée
    ings = [...ex.raw.values()];
    sub = ex.crafts;
  }
  ings.sort((a, b) => b.n - a.n);
  const t = shopTotals(ings);
  return `<div class="panel">
    <div class="panel-head">
      <h3>Niv. ${L} → ${tg}</h3>
      ${segHtml('metric', metric, [['crafts', 'Moins de crafts'], ['ing', 'Moins d’ingrédients'], ['kamas', 'Moins cher', 'Recettes dont tous les ingrédients ont un prix HDV']])}
    </div>
    <div class="tb-row">
      <label class="bchk"><input type="checkbox" data-withup ${withUp ? 'checked' : ''}> Inclure les améliorations de rareté</label>
      <label class="bchk"><input type="checkbox" data-deep ${deep ? 'checked' : ''}> Détailler jusqu’aux ressources brutes</label>
    </div>
    <div class="kpis">
      <div class="kpi"><span>XP à gagner</span><b>${fmt(pl.xp)}</b></div>
      <div class="kpi"><span>Crafts</span><b>${isFinite(pl.n) ? fmt(pl.n) : '—'}</b><small>${isFinite(pl.n) ? (sub ? `+ ${fmt([...sub.values()].reduce((a, c) => a + Math.ceil(c.n), 0))} intermédiaires` : '') : 'aucune recette disponible'}</small></div>
      ${t.cost ? `<div class="kpi"><span>Tout acheter</span><b class="kph">${t.miss ? '≥ ' : ''}${fmtK(t.cost)}</b><small>${t.miss ? `${t.miss} objet(s) sans prix` : 'prix HDV'}</small></div>` : ''}
      ${t.nFarm ? `<div class="kpi"><span>Tout farmer soi-même</span><b>~${fmtDur(t.farm)}</b><small>${t.nFarm} ressource(s) récoltable(s)</small></div>` : ''}
    </div>
    <div class="cols">
      <div><h4>À crafter</h4><ul class="plist">${craftListHtml(pl.crafts)}</ul>
        ${sub && sub.size ? `<h4 style="margin-top:14px">Intermédiaires</h4><ul class="plist">${[...sub.values()].sort((a, b) => a.r.level - b.r.level).map(c => `<li>${icon(c.r.res.item)}<span><b>${fmt(Math.ceil(c.n))}×</b> ${esc(c.r.res.item.name)} <small>${esc((getJob(c.job) || {}).label || '')} niv. ${c.r.level}</small></span></li>`).join('')}</ul>` : ''}</div>
      <div><h4>Liste de courses <small>(${ings.length}${deep ? ', ressources brutes' : ''})</small></h4><ul class="plist shop">${ings.map(shopLine).join('')}</ul></div>
    </div>
    <p class="meta">⏱ = temps pour récolter la quantité toi-même (ton niveau, tes bonus, sans déplacements) ; « k/h » = ce que ce temps te rapporterait si tu vendais au prix HDV : plus c’est élevé, plus il vaut mieux farmer qu’acheter.
      XP des recettes = valeur de base du jeu (à confirmer en jeu).</p>
  </div>`;
}
$('#list').addEventListener('click', e => {
  const s = e.target.closest('[data-strat]'), m = e.target.closest('[data-metric]');
  if (s) { store.set('strat.' + st.cur, s.dataset.strat); renderContent(); renderJobCard(job()); }
  if (m) { store.set('metric.' + st.cur, m.dataset.metric); renderContent(); }
});
$('#list').addEventListener('change', e => {
  if (e.target.matches('[data-deep]')) { store.set('deep.' + st.cur, e.target.checked ? '1' : '0'); renderContent(); }
  if (e.target.matches('[data-withup]')) { store.set('withup.' + st.cur, e.target.checked ? '1' : '0'); renderContent(); }
});

// ---------------------------------------------------------------- prix HDV (onglet)
function pricesHtml(j) {
  const P = PRICES(), L = levelOf(j.key);
  const row = (r, it, kind) => it && it.id ? `<tr class="${L !== null && r.level > L ? 'locked' : ''}">
    <td class="num lvl">${r.level}</td>
    <td><div class="pcell">${icon(it)}<div><b>${esc(it.name)}</b><small>${kind}${P[it.id] ? ` · ${ago(P[it.id][1])}` : ''}</small></div></div></td>
    <td class="num">${priceInput(it)}</td></tr>` : '';
  const n = j.resources.reduce((a, r) => a + [...(r.normal || []), ...(r.seed || []), ...(r.rare || [])].filter(it => P[it.id]).length, 0);
  return `<div class="panel">
    <div class="panel-head"><h3>Prix HDV · ${esc(j.label)}</h3><span class="meta">${n} prix connus</span></div>
    <p class="meta">Prix unitaires. Le plus simple : colle une capture de l’Hôtel des ventes avec <kbd>Ctrl</kbd>+<kbd>V</kbd> (n’importe où sur le site), les prix se remplissent tout seuls.</p>
    <div class="tablewrap"><table class="ptable prices"><thead><tr><th>Niv.</th><th>Objet</th><th class="num">Prix ₭</th></tr></thead><tbody>
    ${j.resources.map(r => (r.normal || []).map(it => row(r, it, 'ressource')).join('') + (r.rare || []).map(it => row(r, it, 'rare')).join('') + (r.seed || []).map(it => row(r, it, j.key === 'forestier' ? 'bouture' : 'graine')).join('')).join('')}
    </tbody></table></div></div>`;
}
// saisie d'un prix (n'importe où)
document.addEventListener('change', e => {
  const el = e.target.closest('[data-price]');
  if (!el) return;
  setPrices({ [el.dataset.price]: el.value });
  changed();
  if (st.page === 'rentabilite') renderProfit(); else { renderJobCard(job()); renderSide(); }
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

export { q, only, xponly, recLimit, renderMetiers, targetOf, renderJobCard, renderContent, renderResources, recipeCost, costHtml, ingChip, renderRecipes, craftListHtml, segHtml, harvestPlanHtml, craftPlanHtml, pricesHtml, recipeHtml, equipHtml };
