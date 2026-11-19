// Waktool — page Objectif : un niveau à atteindre → plan (récolter / planter / crafter), sac suivi en direct, prochaine action
import { st } from './state.js?v=30e09915';
import { $, changed, esc, fmt, fmtDur, icon, jget, sj, store } from './util.js?v=30e09915';
import { RAIN, weatherOk, bg, HARVEST, PLANTABLE, RD, XP, getJob, goalPlan, levelOf, lvlKey, needRecipes, resZones, touchProg, xpOf } from './model.js?v=30e09915';
import { renderTabs } from './main.js?v=30e09915';
import { ITEMS, chatCfgChange, chatClick, chatPanelHtml, chatUi } from './chatlog.js?v=30e09915';
import { growEvent } from './grow.js?v=30e09915';
import { flash, initAudio } from './alert.js?v=30e09915';

// ================================================================ état : objectif + sac
const GOAL_DEF = { job: null, plant: true, craft: true, travel: 3, view: 'full', alert: 'edge', wild: 40, cap: 100, grow: 5, growBad: 5, allSeeds: true, t: 0 };
const goal = () => sj.get('goal', GOAL_DEF);
const setGoal = o => sj.set('goal', { ...goal(), ...o, t: Date.now() });
// sac : { t, items: { nom: quantité } } — mis à jour par le journal du chat, corrigé à la main (ventes, coffre…)
const bag = () => { const b = jget('stock', null); return b && b.items ? b : { t: 0, items: {} }; };
const stock = () => bag().items;
function setStock(items) { store.set('stock', JSON.stringify({ t: Date.now(), items })); }
function stockAdd(name, n) {
  const s = stock();
  s[name] = Math.max(0, (s[name] || 0) + n);
  setStock(s);
}

const goalJob = () => {
  const g = goal();
  const j = getJob(g.job);
  if (j && j.type === 'harvest') return j;
  return HARVEST.slice().sort((a, b) => (levelOf(b.key) ?? -1) - (levelOf(a.key) ?? -1))[0];
};
const autoTarget = L => Math.min(200, (Math.floor((L ?? 0) / 10) + 1) * 10);
const targetOf = (j, L) => +(store.get('target.' + j.key) || 0) || autoTarget(L);
const mainItem = r => (r.normal || [])[0] || { name: r.name, icon: r.appearance };
const seedItem = r => (r.seed || [])[0];

// ================================================================ calcul : plan + prochaine action
function ctx() {
  const g = goal(), j = goalJob(), L = levelOf(j.key);
  const to = targetOf(j, L), x = L === null ? 0 : Math.min(xpOf(j.key), XP.need(L) - 1);
  const plant = g.plant && PLANTABLE.includes(j.key);
  const craft = g.craft && (RD[j.key] || needRecipes(j.key));
  let plan = null, lock = null;
  if (L !== null && to > L && (!g.craft || craft)) {
    // étape en cours verrouillée jusqu'à son niveau de fin (même métier, même objectif, mêmes options)
    lock = jget('goal.lock', null);
    if (lock && (lock.job !== j.key || lock.target !== to || lock.plant !== plant || lock.craft !== !!g.craft || L >= lock.until)) lock = null;
    plan = goalPlan(j, L, x, to, stock(), { plant, craft: !!g.craft, travel: Math.max(0, +g.travel || 0) * 60, force: lock,
      field: { wild: Math.max(0, +g.wild || 0), cap: Math.max(1, +g.cap || 1), grow: Math.max(0, +g.grow || 0) * 60, growBad: Math.max(0, +g.growBad || 0) * 60, allSeeds: g.allSeeds !== false } });
    const s0 = plan.steps[0];
    if (s0 && (!lock || lock.key !== s0.key)) {
      lock = { job: j.key, target: to, plant, craft: !!g.craft, key: s0.key, until: s0.to };
      store.set('goal.lock', JSON.stringify(lock));
    }
  }
  return { g, j, L, x, to, plant, plan, lock, loading: g.craft && !craft };
}

function guide(c) {
  if (c.L === null) return { kind: 'nolvl' };
  if (c.L >= c.to) return { kind: 'done' };
  if (c.loading) return { kind: 'loading' };
  const s = c.plan && c.plan.steps[0];
  if (!s) return { kind: 'blocked' };
  if (s.kind === 'g') {
    // étape suivante = craft qui utilise cette ressource : à garder en sac
    const nx = c.plan.steps[1], it = mainItem(s.r);
    const use = nx && nx.kind === 'c' && nx.ing.find(o => o.item.name === it.name);
    return { kind: 'g', s, steps: c.plan.steps, key: s.key, keep: use ? { n: use.qty * Math.ceil(nx.crafts - 1e-6), prod: nx.rec.res.item.name, crafts: Math.ceil(nx.crafts - 1e-6), at: nx.from } : null };
  }
  const S = stock(), N = Math.max(1, Math.ceil(s.crafts - 1e-6));
  const ing = s.ing.map(o => {
    const need = o.qty * N, have = S[o.item.name] || 0;
    return { ...o, need, have, left: Math.max(0, need - have), ok: have >= need };
  });
  const now = Math.floor(Math.min(...ing.map(o => o.have / o.qty)));
  // ingrédient à récolter : on reste sur celui qu'on récolte déjà (pas de trajet), sinon le plus avancé
  const todo = ing.filter(o => !o.ok), last = store.get('goal.last');
  const next = todo.find(o => o.item.name === last) || todo.slice().sort((a, b) => b.have / b.need - a.have / a.need)[0];
  return { kind: 'c', s, steps: c.plan.steps, N, ing, ready: !todo.length, now, next, key: s.key };
}

// ================================================================ rythme réel (XP / heure sur les 10 dernières minutes)
const recent = [];
// XP moyenne par action ces dernières minutes (journal) : pour estimer les actions restantes avant le niveau suivant
function avgGain(k) {
  const win = recent.filter(e => e.job === k).slice(-30);
  return win.length >= 3 ? win.reduce((a, e) => a + e.gain, 0) / win.length : null;
}
function rate(k) {
  const now = Date.now(), win = recent.filter(e => e.job === k && now - e.at < 10 * 60000);
  if (win.length < 3) return null;
  const span = (now - win[0].at) / 1000;
  return span > 20 ? win.reduce((a, e) => a + e.gain, 0) / span * 3600 : null;
}

// ================================================================ événements du journal (appelés par chatlog.js)
function goalEvent(ev, mode) {
  growEvent(ev);
  if (ev.type === 'got') { stockAdd(ev.name, ev.n); if (ITEMS[ev.name] && !ITEMS[ev.name].seed) store.set('goal.last', ev.name); }
  else if (ev.type === 'plant' || ev.type === 'used') stockAdd(ev.name, -ev.n);
  else if (ev.type === 'xp' && mode === 'live') { recent.push({ job: ev.job, gain: ev.gain, at: Date.now() }); if (recent.length > 400) recent.splice(0, 100); }
}

// alertes aux changements d'étape : comparées à l'état précédent (calculé sans alerte au chargement)
let prevSig = null;
function signature(c, gd) {
  return { job: c.j.key, L: c.L, done: gd.kind === 'done', key: gd.key || gd.kind, ready: !!gd.ready, ok: gd.ing ? gd.ing.filter(o => o.ok).map(o => o.item.name) : [] };
}
function checkAlerts(silent) {
  const c = ctx(), gd = guide(c), sig = signature(c, gd), p = prevSig;
  prevSig = sig;
  if (silent || !p || p.job !== sig.job) return;
  if (sig.done && !p.done) { flash(`Objectif atteint 🎉`, `${c.j.label} niveau ${c.L}`, { big: true }); return; }
  if (sig.done) return;
  if (sig.key !== p.key) {
    // vraie fin d'étape = niveau de fin atteint ; sinon simple recalcul (réglage, sac corrigé…) : pas d'alerte
    if (sig.L > p.L) flash('Étape terminée ✓', 'Ensuite : ' + actionText(gd).title);
    return;
  }
  if (gd.kind !== 'c') return;
  if (sig.ready && !p.ready) { flash(`Crafte ${fmt(gd.N)} × ${gd.s.rec.res.item.name}`, 'Tu as tous les ingrédients.'); return; }
  const fresh = sig.ok.filter(n => !p.ok.includes(n));
  if (fresh.length && gd.next) flash(`Assez de ${fresh.join(' et ')} ✓`, `Passe à ${gd.next.item.name} : encore ${fmt(gd.next.left)} pour crafter ${fmt(gd.N)} ${gd.s.rec.res.item.name}`);
}
// après un lot de lignes du journal
function goalAfterFeed(first) {
  checkAlerts(first);
  refreshObjectif();
}

// ================================================================ rendu
// zones où pousse une ressource (ou les zones communes d'un groupe de spots), les 3 premières en clair
const zoneName = z => (z.region && z.region !== z.name ? `${z.name} (${z.region})` : z.name);
function zonesTxt(zs, max = 3) {
  if (!zs.length) return '';
  const all = zs.map(zoneName);
  return `<span class="zone" title="${esc(all.join('\n'))}">📍 ${esc(all.slice(0, max).join(' · '))}${all.length > max ? ` <i>+${all.length - max}</i>` : ''}</span>`;
}
const groupZones = g => (g.zones.size ? resZones(g.rs[0]).filter(z => g.zones.has(z.key)) : []);
// zones d'un spot d'une étape, réduites à celles où pousse aussi l'étape suivante (pas d'aller-retour au changement d'étape)
function stepZones(steps, i, g) {
  const s = steps[i];
  g ||= (s.groups || [])[0];
  if (!g) return { zs: [], also: [] };
  const own = groupZones(g), nx = steps[i + 1];
  if (nx && (nx.groups || []).length) {
    const nk = new Set(nx.groups.flatMap(x => [...x.zones]));
    const both = own.filter(z => nk.has(z.key));
    const also = [...new Set(nx.groups.filter(x => [...x.zones].some(k => both.some(z => z.key === k))).flatMap(x => x.rs).filter(r => !g.rs.includes(r)).map(r => mainItem(r).name))];
    if (both.length && also.length) return { zs: both, also, at: nx.from };
  }
  return { zs: own, also: [] };
}
const alsoTxt = (z, long) => (z.also.length ? `<small class="same">${long ? `Va plutôt ici : ${esc(z.also.join(' et '))} y pousse aussi pour la suite (niv. ${z.at})` : `+ ${esc(z.also.join(', '))} ensuite`}</small>` : '');
// où aller pour l'étape en cours : zones communes aux ingrédients, et de préférence à l'étape suivante
// météo idéale pour planter la ressource (donnée du jeu) et avertissement si la météo actuelle ne convient pas
function rainHtml(r, plant) {
  if (!plant || !r || !RAIN[r.rain]) return '';
  const [ic, nm] = RAIN[r.rain], ok = weatherOk(r), cur = RAIN[+bg().weather];
  return `<small class="rain-line ${ok === false ? 'bad' : ok ? 'good' : ''}">${ic} Météo idéale pour planter : ${nm}${ok === false ? ` · il fait ${cur[0]} ${cur[1]} : 56 % de réussite au lieu de 70 %` : ok ? ' · ✓ c’est le cas' : ' · indique la météo dans le panneau Météo'}</small>`;
}
function whereHtml(gd) {
  if (gd.kind === 'g') { const z = stepZones(gd.steps, 0); return zonesTxt(z.zs) + alsoTxt(z, true) + rainHtml(gd.s.r, gd.s.plants > 0); }
  if (gd.kind !== 'c' || gd.ready) return '';
  const g = (gd.s.groups || []).find(x => x.rs.includes(gd.next.rr));
  const rain = rainHtml(gd.next.rr, gd.next.plants > 0);
  if (!g) return zonesTxt(resZones(gd.next.rr)) + rain;
  const z = stepZones(gd.steps, 0, g);
  return zonesTxt(z.zs) + (g.rs.length > 1 && g.zones.size ? `<small class="same">${g.rs.length} ingrédients au même endroit</small>` : '') + alsoTxt(z, true) + rain;
}
const pct = (a, b) => Math.max(0, Math.min(100, b ? a / b * 100 : 0));
const bar = (p, cls = '') => `<div class="gbar2 ${cls}"><i style="width:${p.toFixed(1)}%"></i></div>`;

function actionText(gd) {
  if (gd.kind === 'g') {
    const it = mainItem(gd.s.r);
    const k = gd.keep;
    return { title: `Récolte ${it.name}`, sub: `${gd.s.plants ? 'Graines, coupe, replante' : 'Récolte en boucle'} jusqu’au niveau ${gd.s.to}`
      + (k ? `. Garde-les : au niveau ${k.at}, ${fmt(k.crafts)} ${k.prod} en utiliseront ${fmt(k.n)}.` : '') };
  }
  if (gd.kind === 'c') {
    const prod = gd.s.rec.res.item.name;
    if (gd.ready) return { title: `Crafte ${fmt(gd.N)} × ${prod}`, sub: 'Tu as tous les ingrédients : direction l’atelier.' };
    const ok = gd.ing.filter(o => o.ok);
    return { title: `Récolte ${gd.next.item.name}`, sub: `${ok.length ? `Assez de ${ok.map(o => o.item.name).join(', ')} ✓ · ` : ''}encore ${fmt(gd.next.left)} pour crafter ${fmt(gd.N)} ${prod}` };
  }
  return { title: '', sub: '' };
}

// encart « niveau en cours » : barre qui se remplit à chaque gain d'XP (animée depuis la valeur précédente)
function lvlCardHtml(c) {
  const need = XP.need(c.L), p = pct(c.x, need), left = Math.max(0, need - c.x), g = avgGain(c.j.key);
  return `<div class="lvl-card">
    <div class="lvl-top"><span>Niveau <b>${c.L}</b> <i>→ ${c.L + 1}</i></span><b class="lvl-pct">${Math.floor(p)} %</b></div>
    <div class="lvlbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(p)}"><i data-lvl="${c.L}" data-p="${p.toFixed(2)}" style="width:${p.toFixed(2)}%"></i></div>
    <div class="lvl-bot"><small>${fmt(c.x)} / ${fmt(need)} XP</small><small>encore ${fmt(left)} XP${g ? ((n) => ` · ≈ ${fmt(n)} action${n > 1 ? 's' : ''}`)(Math.ceil(left / g)) : ''}</small></div>
  </div>`;
}
let lastLvl = null; // { job, L, p } du dernier rendu
function animLvl() {
  const i = $('#g-hero .lvlbar i');
  if (!i) return;
  const L = +i.dataset.lvl, p = +i.dataset.p, job = goalJob().key, prev = lastLvl;
  lastLvl = { job, L, p };
  if (!prev || prev.job !== job || L < prev.L || (L === prev.L && p <= prev.p)) return; // rien à animer
  const bump = () => { i.parentElement.classList.remove('gain'); void i.offsetWidth; i.parentElement.classList.add('gain'); };
  const to = w => requestAnimationFrame(() => requestAnimationFrame(() => { i.style.width = w + '%'; bump(); }));
  i.style.transition = 'none'; i.style.width = prev.p + '%'; void i.offsetWidth; i.style.transition = '';
  if (L === prev.L) { to(p); return; }
  // montée de niveau : la barre se remplit jusqu'au bout, puis repart de zéro
  to(100);
  setTimeout(() => {
    if (!i.isConnected) return;
    i.style.transition = 'none'; i.style.width = '0%'; void i.offsetWidth; i.style.transition = '';
    to(p);
  }, 800);
}

function heroHtml(c, gd) {
  const j = c.j;
  const lvlIn = `<input type="number" min="0" max="250" data-g="lvl" value="${c.L ?? ''}" placeholder="?" aria-label="Niveau actuel">`;
  const head = `<div class="hero-head">
    <label class="hero-job" style="--c:${j.color}"><img src="${j.icon}" alt=""><select data-g="job" aria-label="Métier">${HARVEST.map(h => `<option value="${h.key}" ${h === j ? 'selected' : ''}>${esc(h.label)}${levelOf(h.key) !== null ? ` · ${levelOf(h.key)}` : ''}</option>`).join('')}</select></label>
    <div class="hero-lv">Niv. ${lvlIn}<span class="arrow">→</span><input type="number" min="1" max="250" data-g="to" value="${c.to}" aria-label="Objectif"></div>
    <div class="seg view-seg" role="group" aria-label="Affichage">${[['full', '▤', 'Affichage complet'], ['compact', '▢', 'Affichage compact (à côté du jeu)']].map(([v, ic, t]) => `<button type="button" data-view="${v}" class="${(c.g.view || 'full') === v ? 'on' : ''}" title="${t}">${ic}</button>`).join('')}</div>
    ${chatUi.state === 'on' ? '<span class="live-pill" title="Journal du chat lu en direct">● en direct</span>' : '<a href="#journal" class="live-pill off" data-g="tojournal">○ journal non lié</a>'}
  </div>`;
  if (gd.kind === 'nolvl') return `<section class="hero">${head}<p class="hero-msg">Indique ton niveau actuel en ${esc(j.label)} pour calculer le plan${chatUi.state === 'on' ? ' (ou attends ta prochaine montée de niveau : le journal le déduira)' : ''}.</p></section>`;
  const xNow = XP.total(c.L) + c.x, xEnd = XP.total(c.to);
  let g = c.g;
  if (!(g.job === j.key && g.start && g.start.to === c.to && g.start.x <= xNow)) { setGoal({ job: j.key, start: { to: c.to, x: XP.total(c.L) } }); g = goal(); } // départ = début du niveau actuel
  // barre : de ton niveau au moment où tu as fixé l'objectif (départ) jusqu'à l'objectif
  const startTot = g.start.x, startL = Math.min(c.L, Math.floor(Math.sqrt(startTot / 75) + 1e-9)), p = pct(xNow - startTot, xEnd - startTot);
  const prog = `<div class="hero-prog">
    <div class="hero-prog-l"><b>${startL}</b><small>départ</small></div>
    <div class="hero-prog-m">${bar(p, 'big')}<small>Niv. <b>${c.L}</b> · ${fmt(c.x)} / ${fmt(XP.need(c.L))} XP · ${Math.floor(p)} %${startL < c.L ? ' <button type="button" class="lnk" data-g="restart" title="Repartir de ton niveau actuel">↺</button>' : ''}</small></div>
    <div class="hero-prog-r"><b>${c.to}</b><small>${c.L >= c.to ? 'atteint' : `${fmt(Math.max(0, xEnd - xNow))} XP restants`}</small></div>
  </div>${lvlCardHtml(c)}`;
  if (gd.kind === 'done') return `<section class="hero done">${head}${prog}<div class="next big-done"><div class="next-txt"><b>Objectif atteint 🎉</b><span>Fixe un nouveau niveau à atteindre.</span></div></div></section>`;
  if (gd.kind === 'loading') return `<section class="hero">${head}${prog}<p class="hero-msg">Chargement des recettes…</p></section>`;
  if (gd.kind === 'blocked') return `<section class="hero">${head}${prog}<p class="hero-msg">Aucune ressource ne donne d’XP à ce niveau.</p></section>`;
  const a = actionText(gd), r = rate(j.key);
  let visual = '';
  if (gd.kind === 'g') {
    const it = mainItem(gd.s.r);
    visual = `<div class="next-ico">${icon(it, 'xl')}</div>`;
  } else {
    visual = `<div class="next-ico">${icon(gd.ready ? gd.s.rec.res.item : gd.next.item, 'xl')}</div>`;
  }
  const ingRows = gd.kind === 'c' ? `<div class="need-list">${gd.ing.map(o => `<div class="need ${o.ok ? 'ok' : ''} ${gd.next === o ? 'cur' : ''}">
      ${icon(o.item, 'ico')}<span class="need-n">${esc(o.item.name)}</span><b>${fmt(Math.min(o.have, o.need))} / ${fmt(o.need)}</b>${bar(pct(o.have, o.need))}${o.ok ? '<i class="tick">✓</i>' : ''}</div>`).join('')}
      <div class="need prod">${icon(gd.s.rec.res.item, 'ico')}<span class="need-n">${esc(gd.s.rec.res.item.name)}</span><b>${gd.now ? `${fmt(Math.min(gd.now, gd.N))} faisables` : '—'} / ${fmt(gd.N)}</b>${bar(pct(gd.now, gd.N))}</div>
    </div>` : `<div class="need-list"><div class="need cur">${icon(mainItem(gd.s.r), 'ico')}<span class="need-n">≈ ${fmt(gd.s.items)} ${esc(mainItem(gd.s.r).name)}</span><b>${gd.s.plants ? `${fmt(gd.s.plants)} plantations · ` : ''}${fmt(gd.s.cuts * 1 + gd.s.seedActs)} récoltes</b></div></div>`;
  const left = c.plan.time, eta = r ? (XP.total(c.to) - xNow) / r * 3600 : null;
  return `<section class="hero ${gd.ready ? 'ready' : ''}">${head}${prog}
    <div class="next">${visual}<div class="next-txt"><small>Prochaine action</small><b>${esc(a.title)}</b><span>${esc(a.sub)}</span>${whereHtml(gd)}</div></div>
    ${ingRows}
    <div class="hero-foot">
      <span title="Récolte, plantation et crafts avec tes bonus + trajets entre spots + attente de la première pousse sur chaque spot">⏱ ~${fmtDur(left)}${c.plan.travels ? ` · ${c.plan.travels} spot${c.plan.travels > 1 ? 's' : ''}` : ''}${c.plan.idle >= 30 ? ` · dont ~${fmtDur(c.plan.idle)} d’attente de pousse` : ''}</span>
      ${r ? `<span title="XP gagnée ces 10 dernières minutes">⚡ ${fmt(r)} XP/h · fin dans ~${fmtDur(eta)}</span>` : ''}
      <details class="opts"><summary>Réglages</summary>
        ${PLANTABLE.includes(j.key) ? `<label class="chk"><input type="checkbox" data-g="plant" ${c.g.plant ? 'checked' : ''}> Replanter les graines (XP de plantation)</label>
        ${c.g.plant ? `<label class="chk"><input type="checkbox" data-g="allSeeds" ${c.g.allSeeds !== false ? 'checked' : ''}> Graines récoltées sur chaque plant</label>
        <label class="chk" title="Plants trouvés en arrivant sur un nouveau spot">Plants sauvages à l’arrivée <input type="number" min="0" max="300" data-g="wild" value="${+c.g.wild}"></label>
        <label class="chk" title="Nombre de plants que tu entretiens sur un spot">Plants max sur un spot <input type="number" min="1" max="500" data-g="cap" value="${+c.g.cap}"></label>
        <label class="chk" title="Temps entre la plantation et le stade où l’on peut récolter les graines (mesurable avec le chrono du menu ☰). La météo du panneau Météo choisit le bon temps pour chaque plante.">Pousse <input type="number" min="0" max="60" step="0.5" data-g="grow" value="${+c.g.grow}"> min bonne météo · <input type="number" min="0" max="60" step="0.5" data-g="growBad" value="${+c.g.growBad}"> min mauvaise</label>` : ''}` : ''}
        <label class="chk"><input type="checkbox" data-g="craft" ${c.g.craft ? 'checked' : ''}> Crafter quand ça accélère (fils…)</label>
        <label class="chk" title="Temps moyen pour aller d’un spot de récolte à un autre : plus il est long, moins le plan te fait changer de cible">Trajet entre 2 spots <input type="number" min="0" max="60" data-g="travel" value="${+c.g.travel || 0}"> min</label>
        <label class="chk">XP actuelle <input type="number" min="0" data-g="xp" value="${c.x}"></label>
        <label class="chk">Alertes <select data-g="alert">${[['edge', 'Barre en bas (discrète)'], ['banner', 'Bandeau en haut'], ['full', 'Plein écran']].map(([v, l]) => `<option value="${v}" ${c.g.alert === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button type="button" class="lnk" data-g="test-alert">Tester l’alerte</button>
      </details>
    </div>
  </section>`;
}

function stepsHtml(c) {
  if (!c.plan || !c.plan.steps.length) return '';
  const rows = c.plan.steps.map((s, i) => {
    if (s.kind === 'g') {
      const it = mainItem(s.r);
      return `<li class="${i ? '' : 'cur'}"><span class="lv">${s.from}–${s.to}</span>${icon(it, 'ico')}<span class="what"><b>${esc(it.name)}</b>
        <small>≈ ${fmt(s.items)} ramassés${s.plants ? ` · ${fmt(s.plants)} plantations` : ''}</small>${(z => zonesTxt(z.zs, 2) + alsoTxt(z, false))(stepZones(c.plan.steps, i))}</span><span class="t">~${fmtDur(s.t)}</span></li>`;
    }
    const p = s.rec.res.item;
    return `<li class="${i ? '' : 'cur'}"><span class="lv">${s.from}–${s.to}</span>${icon(p, 'ico')}<span class="what"><b>${fmt(Math.ceil(s.crafts - 1e-6))} × ${esc(p.name)}</b>
      <small>${s.ing.map(o => `${fmt(o.qty * Math.ceil(s.crafts - 1e-6))} ${esc(o.item.name)}${o.fromStock >= 1 ? ` <em>(${fmt(o.fromStock)} en sac)</em>` : ''}`).join(' · ')}${s.spots > 1 ? ` · ${s.spots} spots` : ''}</small>${s.groups.length === 1 ? (z => zonesTxt(z.zs, 2) + alsoTxt(z, false))(stepZones(c.plan.steps, i)) : s.groups.map(g => zonesTxt(stepZones(c.plan.steps, i, g).zs, 1)).join(' ')}</span><span class="t">~${fmtDur(s.t)}</span></li>`;
  }).join('');
  return `<section class="panel"><div class="panel-head"><h4>Le plan <small>· l’étape en cours reste la même jusqu’au niveau ${c.lock ? c.lock.until : c.plan.steps[0].to}, la suite est recalculée à chaque action</small></h4>
    <button type="button" class="lnk" data-g="replan" title="Recalculer tout le plan depuis ta situation actuelle (peut changer l’étape en cours)">↻ Recalculer</button></div><ol class="steps">${rows}</ol></section>`;
}

// objets utiles au plan (ressources, graines, produits) puis le reste du sac
function bagHtml(c) {
  const S = stock(), names = [], need = {};
  const add = (it, n) => { if (!it || !it.name) return; if (!names.includes(it.name)) names.push(it.name); if (n) need[it.name] = (need[it.name] || 0) + n; };
  (c.plan ? c.plan.steps : []).forEach((s, i) => {
    if (s.kind === 'g') { add(mainItem(s.r)); if (c.plant) add(seedItem(s.r)); return; }
    s.ing.forEach(o => { add(o.item, i === 0 ? o.need : 0); if (c.plant) add(seedItem(o.rr)); });
    add(s.rec.res.item);
  });
  const icons = {};
  (c.plan ? c.plan.steps : []).forEach(s => { if (s.kind === 'c') { icons[s.rec.res.item.name] = s.rec.res.item; s.ing.forEach(o => { icons[o.item.name] = o.item; }); } });
  const tile = n => {
    const it = ITEMS[n] || icons[n] || { name: n }, q = S[n] || 0;
    return `<label class="tile ${q ? '' : 'zero'}">${icon({ ...it, name: n }, 'ico')}<span class="tn">${esc(n)}</span>
      <input type="number" min="0" inputmode="numeric" data-stock="${esc(n)}" value="${q}" aria-label="${esc(n)} en sac"></label>`;
  };
  const others = Object.keys(S).filter(n => !names.includes(n) && S[n] > 0).sort();
  return `<section class="panel" id="g-bag"><div class="panel-head"><h4>Ton sac <small>· suivi par le journal, corrige si tu vends ou ranges au coffre</small></h4></div>
    <div class="tiles">${names.map(tile).join('') || '<p class="meta">Fixe un objectif pour voir les objets utiles.</p>'}</div>
    ${others.length ? `<details class="more"><summary>Autres objets suivis (${others.length})</summary><div class="tiles">${others.map(tile).join('')}</div></details>` : ''}
  </section>`;
}

function renderObjectif() {
  const el = $('#page-objectif'), c = ctx(), gd = guide(c);
  st.cur = c.j.key; // le panneau Bonus suit le métier de l'objectif
  document.documentElement.style.setProperty('--c', c.j.color);
  const compact = c.g.view === 'compact';
  el.classList.toggle('compact', compact);
  document.body.classList.toggle('obj-compact', compact);
  el.innerHTML = `<div id="g-hero">${heroHtml(c, gd)}</div>
    ${compact ? '<details class="more"><summary>Plan, sac et journal</summary>' : ''}
    <div id="g-steps">${stepsHtml(c)}</div>
    <div id="g-bagw">${bagHtml(c)}</div>
    <div id="journal">${chatPanelHtml()}</div>
    ${compact ? '</details>' : ''}`;
  animLvl();
  if (!prevSig) prevSig = signature(c, gd);
}
// mise à jour après le journal : sans casser une saisie en cours
function refreshObjectif() {
  if (st.page !== 'objectif') return;
  const a = document.activeElement, typing = a && a.closest('#page-objectif') && a.matches('input, select, textarea');
  if (!typing) { renderObjectif(); return; }
  const c = ctx(), gd = guide(c);
  if (!a.closest('#g-hero')) { $('#g-hero').innerHTML = heroHtml(c, gd); animLvl(); }
  $('#g-steps').innerHTML = stepsHtml(c);
  if (!a.closest('#g-bagw')) $('#g-bagw').innerHTML = bagHtml(c);
  if (!a.closest('#journal')) $('#journal').innerHTML = chatPanelHtml();
}

// ================================================================ saisies
const page = $('#page-objectif');
page.addEventListener('click', async e => {
  const ch = e.target.closest('[data-chat]');
  if (ch) { await chatClick(ch); return; }
  if (e.target.closest('[data-g="tojournal"]')) {
    e.preventDefault();
    const d = $('#page-objectif details.more'); if (d) d.open = true;
    $('#journal').scrollIntoView({ behavior: 'smooth' });
  }
  if (e.target.closest('[data-g="replan"]')) { store.set('goal.lock', ''); prevSig = null; renderObjectif(); return; }
  if (e.target.closest('[data-g="restart"]')) {
    const c = ctx();
    if (c.L !== null) { setGoal({ job: c.j.key, start: { to: c.to, x: XP.total(c.L) } }); renderObjectif(); }
    return;
  }
  const v = e.target.closest('[data-view]');
  if (v) { setGoal({ view: v.dataset.view }); renderObjectif(); }
  if (e.target.closest('[data-g="test-alert"]')) { initAudio(); const gd = guide(ctx()); flash(gd.kind === 'c' || gd.kind === 'g' ? actionText(gd).title : 'Exemple d’alerte', gd.kind === 'c' || gd.kind === 'g' ? actionText(gd).sub : 'Voilà à quoi ressemble une alerte.'); }
});
page.addEventListener('change', e => {
  const cc = e.target.closest('[data-chatcfg]');
  if (cc) { chatCfgChange(cc); return; }
  const sk = e.target.closest('[data-stock]');
  if (sk) {
    const s = stock(); s[sk.dataset.stock] = Math.max(0, Math.round(+sk.value || 0)); setStock(s);
    prevSig = null; changed(); renderObjectif(); return;
  }
  const el = e.target.closest('[data-g]');
  if (!el) return;
  const k = el.dataset.g, j = goalJob();
  if (k !== 'alert') store.set('goal.lock', ''); // réglage changé : nouveau plan complet
  if (k === 'job') setGoal({ job: el.value });
  else if (k === 'plant' || k === 'craft') setGoal({ [k]: el.checked });
  else if (k === 'travel') setGoal({ travel: Math.max(0, Math.min(60, +el.value || 0)) });
  else if (k === 'allSeeds') setGoal({ allSeeds: el.checked });
  else if (k === 'wild' || k === 'cap' || k === 'grow' || k === 'growBad') setGoal({ [k]: Math.max(0, +el.value || 0) });
  else if (k === 'alert') { setGoal({ alert: el.value }); return; }
  else if (k === 'lvl') {
    const v = el.value === '' ? null : Math.max(0, Math.min(250, +el.value));
    if (v !== levelOf(j.key)) store.set('xp.' + j.key, '0');
    store.set(lvlKey(j.key), v === null ? '' : String(v));
    touchProg(j.key);
    renderTabs();
  } else if (k === 'xp') { store.set('xp.' + j.key, String(Math.max(0, +el.value || 0))); touchProg(j.key); }
  else if (k === 'to') {
    store.set('target.' + j.key, String(Math.max(1, Math.min(250, +el.value || 0))));
    const L = levelOf(j.key);
    if (L !== null) setGoal({ job: j.key, start: { to: +el.value, x: XP.total(L) } });
  }
  if (k === 'job' || k === 'to' || k === 'lvl') prevSig = null;
  changed(); renderObjectif();
});

export { goal, setGoal, bag, stock, setStock, goalJob, goalEvent, goalAfterFeed, renderObjectif, refreshObjectif, ctx as goalCtx, guide as goalGuide };
