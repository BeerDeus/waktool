// Waktool — module session
import { st } from './state.js?v=e4e1de4b';
import { $, changed, clock, esc, fmt, fmtK, jget, sec, sj, store } from './util.js?v=e4e1de4b';
import { XP, bestAt, bonusXp, dur, getJob, levelOf, lvlKey, price, qtyStats, xpOf } from './model.js?v=e4e1de4b';
import { renderSide } from './side.js?v=e4e1de4b';
import { go, job, renderTabs } from './main.js?v=e4e1de4b';
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
  if (!s.job || !getJob(s.job) || getJob(s.job).type !== 'harvest') { s.job = st.cur; setSess(s); }
  if (s.job !== st.cur && !s.start && !s.acc) { s.job = st.cur; s.res = null; s.prod = null; setSess(s); }
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
      if (!s2.start || st.page !== 'session') { clearInterval(tick); return; }
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

export { S_DEF, sess, setSess, elapsed, tick, sessCtx, sessEstimate, statsHtml, renderSession, doneHtml };
