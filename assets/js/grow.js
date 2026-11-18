// Waktool — menu ☰ (en-tête) : chrono de pousse. Départ = dernière plantation réussie lue dans le journal du chat
// (ou maintenant), puis « stade 2 » / « stade 3 » cliqués quand la plante change en jeu. Le temps mesuré peut devenir
// le temps de pousse utilisé par l'assistant d'objectif.
import { $, changed, esc, jget, store } from './util.js?v=fd9ef4d8';
import { HARVEST } from './model.js?v=fd9ef4d8';
import { goal, setGoal, refreshObjectif } from './goal.js?v=fd9ef4d8';

const RES_BY_SEED = {};
HARVEST.forEach(j => j.resources.forEach(r => (r.seed || []).forEach(it => { if (it && it.name) RES_BY_SEED[it.name] = { j, r }; })));

const run = () => jget('grow.run', null); // { start, src: 'journal'|'manuel', seed, res, lvl, s2 }
const setRun = o => store.set('grow.run', JSON.stringify(o));
const measures = () => jget('grow.measures', []) || [];
let lastPlant = jget('grow.lastPlant', null), failNext = false, wSel = null;
const pickW = () => wSel || (goal().weather === 'bad' ? 'bad' : 'ok');

// événements du journal (appelé par goal.js) : « Le plant n'a pas pris. » précède la graine perdue d'un échec
function growEvent(ev) {
  if (ev.type === 'fail') { failNext = true; return; }
  if (ev.type !== 'plant') return;
  if (failNext) { failNext = false; return; }
  const o = RES_BY_SEED[ev.name];
  lastPlant = { at: ev.ts || Date.now(), seed: ev.name, res: o ? o.r.name : '', lvl: o ? o.r.level : null };
  store.set('grow.lastPlant', JSON.stringify(lastPlant));
  if (isOpen()) render();
}

const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
const hhmm = t => new Date(t).toLocaleTimeString('fr-FR');
const btn = $('#menu-btn'), pop = $('#menu-pop');
const isOpen = () => !pop.hidden;

function html() {
  const r = run(), m = measures(), g = goal(), now = Date.now();
  const lp = lastPlant && now - lastPlant.at < 3 * 3600e3 ? lastPlant : null;
  let body;
  if (!r) {
    const w = pickW();
    body = `<p class="meta">Plante une graine (sans plant sauvage de la même espèce à côté), lance le chrono, puis clique quand la plante change de stade en jeu.</p>
      <div class="seg grow-w" role="group" aria-label="Météo pour la plante">${[['ok', '☀ Météo favorable'], ['bad', '☁ Défavorable']].map(([v, l]) => `<button type="button" data-grow-w="${v}" class="${w === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${lp ? `<button type="button" class="gbtn small" data-grow="from-log">▶ Depuis la plantation de ${esc(lp.res || lp.seed)} à ${hhmm(lp.at)}</button>` : '<p class="meta">Aucune plantation récente lue dans le journal.</p>'}
      <button type="button" class="lnk" data-grow="now">▶ Démarrer maintenant</button>`;
  } else {
    const el = now - r.start;
    body = `<p class="grow-clock"><b id="grow-t">${mmss(el)}</b><small>${r.res ? esc(r.res) : 'plante'} · ${r.w === 'bad' ? '☁ météo défavorable' : '☀ météo favorable'} · départ ${hhmm(r.start)}${r.src === 'journal' ? ' (journal)' : ''}</small></p>
      <div class="grow-btns">
        ${r.s2 ? `<span class="pos">Stade 2 : ${mmss(r.s2)}</span>` : '<button type="button" class="gbtn small" data-grow="s2">Stade 2 atteint (couper)</button>'}
        <button type="button" class="gbtn small" data-grow="s3">Stade 3 atteint (graines)</button>
      </div>
      <button type="button" class="lnk" data-grow="cancel">Annuler</button>`;
  }
  const list = m.length ? `<table class="grow-t"><thead><tr><th>Plante</th><th>Stade 2</th><th>Stade 3</th><th></th></tr></thead><tbody>${m.slice().reverse().map((x, i) => `<tr>
      <td>${x.w === 'bad' ? '☁' : '☀'} ${esc(x.res || '—')}${x.lvl !== null && x.lvl !== undefined ? ` <small>niv. ${x.lvl}</small>` : ''}</td><td>${x.s2 ? mmss(x.s2) : '—'}</td><td>${mmss(x.s3)}</td>
      <td><button type="button" class="lnk" data-grow-use="${m.length - 1 - i}" title="Utiliser comme temps de pousse de l’assistant">utiliser</button> <button type="button" class="lnk" data-grow-del="${m.length - 1 - i}" title="Supprimer">✕</button></td></tr>`).join('')}</tbody></table>` : '';
  return `<h4>Chrono de pousse</h4>${body}${list}<p class="meta">Temps de pousse de l’assistant : <b>☀ ${+g.grow || 0} min · ☁ ${+g.growBad || 0} min</b> (Objectif › Réglages).</p>`;
}
let tick = null;
function render() {
  pop.innerHTML = html();
  clearInterval(tick); tick = null;
  if (run()) tick = setInterval(() => { const t = $('#grow-t'), r = run(); if (t && r) t.textContent = mmss(Date.now() - r.start); }, 1000);
}
function toggle(open = pop.hidden) {
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', open);
  if (open) render(); else { clearInterval(tick); tick = null; }
}
btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
pop.addEventListener('click', e => {
  e.stopPropagation();
  const a = e.target.closest('[data-grow]'), u = e.target.closest('[data-grow-use]'), d = e.target.closest('[data-grow-del]'), w = e.target.closest('[data-grow-w]');
  if (w) wSel = w.dataset.growW;
  else if (a) {
    const k = a.dataset.grow, r = run();
    if (k === 'from-log' && lastPlant) setRun({ start: lastPlant.at, src: 'journal', res: lastPlant.res, lvl: lastPlant.lvl, w: pickW() });
    else if (k === 'now') setRun({ start: Date.now(), src: 'manuel', res: lastPlant && Date.now() - lastPlant.at < 600e3 ? lastPlant.res : '', lvl: lastPlant ? lastPlant.lvl : null, w: pickW() });
    else if (k === 'cancel') store.set('grow.run', '');
    else if (k === 's2' && r) setRun({ ...r, s2: Date.now() - r.start });
    else if (k === 's3' && r) {
      const m = measures();
      m.push({ res: r.res, lvl: r.lvl ?? null, w: r.w || 'ok', s2: r.s2 || null, s3: Date.now() - r.start, t: Date.now() });
      store.set('grow.measures', JSON.stringify(m.slice(-20)));
      store.set('grow.run', '');
    }
  } else if (u) {
    const x = measures()[+u.dataset.growUse];
    if (x) { setGoal({ [x.w === 'bad' ? 'growBad' : 'grow']: Math.round(x.s3 / 30000) / 2 }); changed(); refreshObjectif(); }
  } else if (d) {
    const m = measures(); m.splice(+d.dataset.growDel, 1); store.set('grow.measures', JSON.stringify(m));
  }
  render();
});
document.addEventListener('click', e => { if (isOpen() && !e.target.closest('#menu-pop, #menu-btn')) toggle(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) toggle(false); });

export { growEvent };
