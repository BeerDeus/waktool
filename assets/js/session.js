// Waktool — module session : chrono de farm, estimation en direct, compteurs, bilan, historique
import { st } from './state.js?v=aec81dce';
import { $, changed, clock, esc, fmt, fmtK, jget, sec, sj, store } from './util.js?v=aec81dce';
import { PLANTABLE, XP, bestAt, bonusPlant, bonusXp, dur, fieldCycle, getJob, levelOf, lvlKey, price, qtyStats, xpOf } from './model.js?v=aec81dce';
import { renderSide } from './side.js?v=aec81dce';
import { job, renderTabs } from './main.js?v=aec81dce';

const S_DEF = { job: null, res: null, prod: null, mode: 'wild', eff: 80, plan: 60, start: null, acc: 0, cnt: { h: 0, p: 0 }, notify: false, notified: false, done: null };
const sess = () => { const s = sj.get('session', S_DEF); s.cnt ||= { h: 0, p: 0 }; return s; };
const setSess = s => { sj.set('session', s); };
const elapsed = s => s.acc + (s.start ? Date.now() - s.start : 0);
const counted = s => (s.cnt.h + s.cnt.p) > 0;
let tick = null;

function sessCtx(s) {
  const j = getJob(s.job) || job();
  const L = levelOf(j.key);
  const avail = j.resources.filter(r => L === null || r.level <= L);
  const r = avail.find(x => x.name === s.res) || (L !== null && bestAt(j, L) || {}).r || avail[avail.length - 1];
  const prods = r ? [...(r.normal || []), ...(r.seed || [])].filter(it => it && it.id) : [];
  const it = prods.find(x => x.id === s.prod) || prods[0];
  const mode = PLANTABLE.includes(j.key) && (r && (r.seed || []).length) ? s.mode : 'wild';
  return { j, L, r, it, prods, avail, mode };
}
const targetLevel = j => +(store.get('target.' + j.key) || 0) || null;

// XP par action et durée au niveau L pour la ressource de la session
function rates(c, L) {
  const diff = Math.max(0, L - c.r.level), known = c.L !== null;
  const d = dur(c.j.key, diff, c.r);
  return { d, diff, perH: known ? XP.per(diff, bonusXp()) : 0, perP: known ? XP.per(diff, bonusPlant()) : 0 };
}

// estimation au temps, simulée niveau par niveau (l'XP baisse et l'action accélère quand ton niveau monte)
// mode « champ perso » : cycles planter → couper → récolter les graines (voir fieldCycle)
function estimateTime(c, ms, eff) {
  const qa = qtyStats(c.j).avg, known = c.L !== null;
  const from = c.L ?? 0, x0 = Math.min(xpOf(c.j.key), XP.need(from) - 1);
  let T = ms / 1000 * eff / 100, L = from, x = x0, h = 0, p = 0, xp = 0, items = 0, guard = 0;
  while (T > 0 && guard++ < 300) {
    let xpPerS, hPerS, pPerS, itemsPerS;
    if (c.mode === 'field') {
      const f = fieldCycle(c.j, c.r, L, qa);
      xpPerS = known ? f.xp / f.time : 0;
      hPerS = (1 + f.seedActs) / f.time; pPerS = f.plants / f.time; itemsPerS = qa / f.time;
    } else {
      const r = rates(c, L);
      xpPerS = r.perH / r.d; hPerS = 1 / r.d; pPerS = 0; itemsPerS = qa / r.d;
    }
    const tLvl = xpPerS > 0 ? (XP.need(L) - x) / xpPerS : Infinity;
    const t = Math.min(T, tLvl);
    h += t * hPerS; p += t * pPerS; items += t * itemsPerS; xp += t * xpPerS; x += t * xpPerS; T -= t;
    if (t === tLvl) { x -= XP.need(L); L++; }
  }
  return finish(c, { h, p, xp, items, from, L, x, mode: 'time' });
}

// chiffres réels à partir des compteurs (récoltes / plantations), appliqués niveau par niveau
function estimateCount(c, cnt) {
  const qa = qtyStats(c.j).avg, from = c.L ?? 0, x0 = Math.min(xpOf(c.j.key), XP.need(from) - 1);
  const total = cnt.h + cnt.p;
  let left = total, L = from, x = x0, xp = 0, guard = 0;
  while (left > 0 && guard++ < 300) {
    const r = rates(c, L);
    const per = (cnt.h * r.perH + cnt.p * r.perP) / total; // XP moyenne par action
    if (!per) break;
    const n = Math.min(left, Math.ceil((XP.need(L) - x) / per));
    xp += n * per; x += n * per; left -= n;
    if (x >= XP.need(L)) { x -= XP.need(L); L++; }
  }
  return finish(c, { h: cnt.h, p: cnt.p, xp: Math.round(xp), items: cnt.h * qa, from, L, x, mode: 'count' });
}

function finish(c, o) {
  const unit = c.it && price(c.it.id), r0 = rates(c, o.from), r1 = rates(c, o.L);
  return { ...o, actions: o.h + o.p, d: r0.d, per: r0.perH, perEnd: r1.perH, known: c.L !== null, res: c.r,
    qty: o.items, unit, kamas: unit ? o.items * unit : null, after: { level: o.L, xp: Math.floor(o.x) }, target: targetLevel(c.j) };
}
const estimate = (c, s, ms) => (counted(s) ? estimateCount(c, s.cnt) : estimateTime(c, ms, s.eff));

function statsHtml(e) {
  if (!e) return '<p class="empty">Aucune ressource accessible.</p>';
  const lvUp = e.after.level - e.from;
  return `<div class="kpis big">
    <div class="kpi"><span>${e.mode === 'count' ? 'Comptées' : 'Actions estimées'}</span><b>${fmt(e.h)}${e.p >= 0.5 ? ` + ${fmt(e.p)}` : ''}</b><small>${e.p >= 0.5 ? 'récoltes + plantations' : `récoltes · ${sec(e.d)} s / action`}</small></div>
    <div class="kpi"><span>XP gagnée</span><b>${fmt(e.xp)}</b><small>${fmt(e.per)} XP / récolte</small></div>
    <div class="kpi"><span>Niveau</span><b>${e.from} → ${e.after.level}${lvUp ? ` <em class="pos">+${lvUp}</em>` : ''}</b><small>${fmt(e.after.xp)} / ${fmt(XP.need(e.after.level))} XP${e.target ? ` · objectif ${e.target}` : ''}</small></div>
    <div class="kpi"><span>Ressources</span><b>${fmt(e.qty)}</b><small>${e.mode === 'count' ? 'estimées depuis tes récoltes' : 'estimées'}</small></div>
    <div class="kpi"><span>Kamas estimés</span><b class="kph">${e.kamas !== null ? fmtK(e.kamas) : '—'}</b><small>${e.unit ? `${fmt(e.unit)} ₭ / u` : 'pas de prix HDV'}</small></div>
  </div>
  ${e.known && !e.perEnd ? `<p class="meta warn-txt">⚠ ${esc(e.res.name)} ne donne plus d’XP à partir du niveau ${e.res.level + 20} : change de ressource pour continuer à monter.</p>`
    : e.known && e.perEnd < e.per ? `<p class="meta">XP par récolte en baisse en fin de session (${fmt(e.perEnd)} XP) : la ressource devient trop basse pour ton niveau.</p>` : ''}`;
}

function renderSession() {
  const s = sess();
  if (!s.job || !getJob(s.job) || getJob(s.job).type !== 'harvest') { s.job = st.cur; setSess(s); }
  if (s.job !== st.cur && !s.start && !s.acc && !counted(s)) { s.job = st.cur; s.res = null; s.prod = null; setSess(s); }
  const c = sessCtx(s), el = $('#page-session');
  const ms = elapsed(s), running = !!s.start, active = running || s.acc > 0 || counted(s);
  const hist = jget('sessions', []) || [];
  const canPlant = PLANTABLE.includes(c.j.key);
  el.innerHTML = `
    <div class="page-head">
      <h2>Session de farm</h2>
      <p class="meta">Lance le chrono quand tu commences : XP, niveau, ressources et kamas sont estimés en direct. Compte tes récoltes
        (<kbd>Espace</kbd>)${canPlant ? ' et plantations (<kbd>P</kbd>)' : ''} pour remplacer l’estimation par tes vrais chiffres. À la fin, applique l’XP à ta progression.</p>
    </div>
    <div class="panel sess-setup">
      <div class="sess-row">
        <label>Métier<span class="jchip" style="--c:${c.j.color}"><img src="${c.j.icon}" alt="">${esc(c.j.label)}${c.L !== null ? ` ${c.L}` : ''}</span></label>
        <label>Ressource<select data-s="res" ${active ? 'disabled' : ''}>${c.avail.slice().reverse().map(r => `<option value="${esc(r.name)}" ${c.r === r ? 'selected' : ''}>${esc(r.name)} (niv. ${r.level})</option>`).join('')}</select></label>
        ${canPlant ? `<label>Mode<select data-s="mode" ${active ? 'disabled' : ''}>
          <option value="wild" ${c.mode === 'wild' ? 'selected' : ''}>Récolte dans la nature</option>
          <option value="field" ${c.mode === 'field' ? 'selected' : ''}>Champ perso (planter + couper)</option></select></label>` : ''}
        <label>Produit vendu<select data-s="prod">${c.prods.map(it => `<option value="${it.id}" ${c.it === it ? 'selected' : ''}>${esc(it.name)}${price(it.id) ? ` · ${fmt(price(it.id))} ₭` : ''}</option>`).join('')}</select></label>
        <label title="Part du temps passée à récolter (déplacements, repousse, combats exclus). Ignorée si tu comptes tes récoltes.">Efficacité<span class="unit"><input type="number" min="5" max="100" data-s="eff" value="${s.eff}"><i>%</i></span></label>
      </div>
      ${c.L === null ? '<p class="meta">⚠ Renseigne ton niveau dans ce métier pour estimer l’XP.</p>' : ''}
    </div>
    <div class="sess-main">
      <div class="panel timer ${running ? 'running' : ''}">
        <div class="clock" id="s-clock">${clock(ms)}</div>
        <div class="tbtns">
          ${running ? '<button type="button" class="big-btn" data-sa="pause">⏸ Pause</button>' : `<button type="button" class="big-btn go" data-sa="start">▶ ${s.acc > 0 ? 'Reprendre' : 'Démarrer'}</button>`}
          ${active ? '<button type="button" class="big-btn stop" data-sa="stop">⏹ Terminer</button>' : ''}
        </div>
        <div class="counters">
          <div class="ctr"><span>Récoltes</span><div><button type="button" data-sc="h:-1" aria-label="Retirer une récolte">−</button><b id="c-h">${s.cnt.h}</b><button type="button" class="plus" data-sc="h:1" title="Espace">+1</button></div></div>
          ${canPlant ? `<div class="ctr"><span>Plantations</span><div><button type="button" data-sc="p:-1" aria-label="Retirer une plantation">−</button><b id="c-p">${s.cnt.p}</b><button type="button" class="plus" data-sc="p:1" title="Touche P">+1</button></div></div>` : ''}
        </div>
        <div class="tfoot">
          ${!active ? `<label class="plan-dur">Simuler <span class="unit"><input type="number" min="5" max="1440" step="5" data-s="plan" value="${s.plan}"><i>min</i></span></label>` : '<button type="button" class="lnk" data-sa="reset">Réinitialiser</button>'}
          ${'Notification' in window ? `<button type="button" class="lnk" data-sa="notify" title="Notification quand ton objectif de niveau est atteint">${s.notify ? '🔔 Alerte objectif activée' : '🔕 Prévenir à l’objectif'}</button>` : ''}
        </div>
      </div>
      <div class="panel"><h4>${counted(s) ? 'Tes chiffres (comptés)' : active ? 'En direct (estimation)' : `Estimation pour ${s.plan} min`}</h4><div id="s-live">${statsHtml(estimate(c, s, active ? ms : s.plan * 60000))}</div></div>
    </div>
    ${s.done ? doneHtml(s.done) : ''}
    <div class="panel">
      <h4>Historique</h4>
      ${hist.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>Métier</th><th>Ressource</th><th>Durée</th><th>Actions</th><th>XP</th><th>Kamas</th><th></th></tr></thead><tbody>
        ${hist.slice().reverse().map((h, i) => `<tr><td>${new Date(h.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td>${esc((getJob(h.job) || {}).label || h.job)}</td><td>${esc(h.res)}${h.mode === 'field' ? ' <small class="kind">champ</small>' : ''}</td><td>${clock(h.ms)}</td>
          <td class="num">${h.actions ? fmt(h.actions) + (h.counted ? '' : ' ~') : '—'}</td>
          <td class="num">${fmt(h.xp)}${h.applied ? ' ✓' : ''}</td><td class="num">${h.kamas ? fmtK(h.kamas) : '—'}</td>
          <td><button type="button" class="lnk" data-hdel="${hist.length - 1 - i}" title="Supprimer">✕</button></td></tr>`).join('')}
        </tbody></table></div>
        <p class="meta">Total : ${clock(hist.reduce((a, h) => a + h.ms, 0))} · ${fmt(hist.reduce((a, h) => a + h.xp, 0))} XP · ${fmtK(hist.reduce((a, h) => a + (h.kamas || 0), 0))} · « ~ » = estimé</p>`
        : '<p class="meta">Tes sessions terminées apparaîtront ici.</p>'}
    </div>`;
  clearInterval(tick);
  if (running) tick = setInterval(liveTick, 1000);
  updateTitle();
}

// mise à jour légère chaque seconde (chrono + chiffres + titre de l'onglet + alerte objectif)
function liveTick() {
  const s = sess();
  if (!s.start) { clearInterval(tick); updateTitle(); return; }
  updateTitle();
  const e = estimate(sessCtx(s), s, elapsed(s));
  if (s.notify && !s.notified && e && e.target && e.after.level >= e.target) {
    s.notified = true; setSess(s);
    try { new Notification('Waktool : objectif atteint 🎉', { body: `${getJob(s.job).label} niveau ${e.after.level}`, icon: 'img/app/icon-192.png' }); } catch { /* ignore */ }
  }
  if (st.page !== 'session') return;
  $('#s-clock').textContent = clock(elapsed(s));
  $('#s-live').innerHTML = statsHtml(e);
}
const BASE_TITLE = document.title;
function updateTitle() {
  const s = sess();
  document.title = s.start ? `⏱ ${clock(elapsed(s))} · Waktool` : BASE_TITLE;
  $('#live-dot').hidden = !s.start;
}

function doneHtml(d) {
  return `<div class="panel done">
    <div class="panel-head"><h3>Session terminée · ${clock(d.ms)}</h3><button type="button" class="lnk" data-sa="dismiss">Fermer</button></div>
    <div class="kpis big">
      <div class="kpi"><span>XP gagnée</span><b>${fmt(d.xp)}</b><small>${esc(d.res)}${d.counted ? ' · compté' : ' · estimé'}</small></div>
      <div class="kpi"><span>Niveau</span><b>${d.from} → ${d.to}</b></div>
      <div class="kpi"><span>Ressources</span><b>${fmt(d.qty)}</b></div>
      <div class="kpi"><span>Kamas estimés</span><b class="kph">${d.kamas ? fmtK(d.kamas) : '—'}</b></div>
    </div>
    ${d.applied ? '<p class="meta pos">✓ XP appliquée à ta progression.</p>' : `<button type="button" class="gbtn" data-sa="apply">Appliquer l’XP à ma progression (${esc((getJob(d.job) || {}).label)} ${d.from} → ${d.to})</button>`}
  </div>`;
}

function bump(kind, n) {
  const s = sess();
  if (kind === 'p' && !PLANTABLE.includes(s.job)) return;
  s.cnt[kind] = Math.max(0, s.cnt[kind] + n);
  if (!s.start && n > 0 && !s.acc) s.start = Date.now(); // compter démarre le chrono
  setSess(s);
  if (st.page === 'session') renderSession();
}

$('#page-session').addEventListener('click', async e => {
  const a = e.target.closest('[data-sa]'), hd = e.target.closest('[data-hdel]'), sc = e.target.closest('[data-sc]');
  if (sc) { const [k, n] = sc.dataset.sc.split(':'); bump(k, +n); return; }
  if (hd) {
    const h = jget('sessions', []) || []; h.splice(+hd.dataset.hdel, 1);
    store.set('sessions', JSON.stringify(h)); changed(); renderSession(); return;
  }
  if (!a) return;
  const s = sess();
  if (a.dataset.sa === 'start') { s.start = Date.now(); s.done = null; s.notified = false; }
  if (a.dataset.sa === 'pause') { s.acc = elapsed(s); s.start = null; }
  if (a.dataset.sa === 'reset') { s.acc = 0; s.start = null; s.cnt = { h: 0, p: 0 }; s.notified = false; }
  if (a.dataset.sa === 'notify') {
    if (!s.notify && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Notifications refusées par le navigateur.'); return; }
    }
    s.notify = !s.notify;
  }
  if (a.dataset.sa === 'stop') {
    const ms = elapsed(s), c = sessCtx(s), est = estimate(c, s, ms);
    if (est && est.actions > 0) {
      s.done = { t: Date.now(), ms, job: c.j.key, res: c.r.name, mode: c.mode, counted: counted(s), xp: Math.round(est.xp), qty: est.qty, kamas: est.kamas,
        from: est.from, to: est.after.level, xpAfter: est.after.xp, applied: false };
      const h = jget('sessions', []) || [];
      h.push({ t: s.done.t, ms, job: c.j.key, res: c.r.name, mode: c.mode, counted: counted(s), actions: Math.round(est.actions), xp: s.done.xp, kamas: est.kamas, applied: false });
      store.set('sessions', JSON.stringify(h.slice(-100)));
    }
    s.acc = 0; s.start = null; s.cnt = { h: 0, p: 0 }; s.notified = false;
  }
  if (a.dataset.sa === 'apply' && s.done && !s.done.applied) {
    store.set(lvlKey(s.done.job), String(s.done.to));
    store.set('xp.' + s.done.job, String(s.done.xpAfter));
    s.done.applied = true;
    const h = jget('sessions', []) || [];
    const last = h.filter(x => x.t === s.done.t).pop();
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
  s[el.dataset.s] = ['res', 'mode'].includes(el.dataset.s) ? el.value : +el.value;
  if (el.dataset.s === 'res') s.prod = null;
  setSess(s); renderSession();
});
// raccourcis clavier : Espace = +1 récolte, P = +1 plantation (hors champs de saisie)
document.addEventListener('keydown', e => {
  if (st.page !== 'session' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, select, textarea, button, [contenteditable]')) return;
  if (e.code === 'Space') { e.preventDefault(); bump('h', 1); }
  else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); bump('p', 1); }
});
// le chrono continue en arrière-plan (autre page / onglet)
if (sess().start) tick = setInterval(liveTick, 1000);

export { sess, renderSession };
