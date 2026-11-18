// Waktool — journal du chat Wakfu (wakfu_chat.log) lu en direct, dans le navigateur uniquement.
// Seules les lignes « [Information (jeu)] » sont lues (XP de métier, objets ramassés / perdus, plantations, crafts) :
// les canaux de discussion (Commerce, Guilde, messages privés…) sont ignorés et rien n'est envoyé nulle part.
// Deux sources :
//   - le pont local (waktool-pont.cmd, PowerShell) qui sert le journal sur http://127.0.0.1:47811 ;
//     Chrome interdit en effet aux sites d'ouvrir un fichier du dossier AppData (liste de blocage de l'API File System Access) ;
//   - un fichier choisi à la main (copie du journal hors d'AppData, ou autre navigateur).
import { st } from './state.js?v=502a2738';
import { $, changed, esc, fmt, norm, sj, store } from './util.js?v=502a2738';
import { ALL, HARVEST, XP, getJob, levelOf, lvlKey, xpOf } from './model.js?v=502a2738';
import { job, renderTabs } from './main.js?v=502a2738';
import { renderJobCard } from './metiers.js?v=502a2738';
import { initAudio, beep, toast } from './alert.js?v=502a2738';
import { goalAfterFeed, goalEvent, refreshObjectif } from './goal.js?v=502a2738';

// ================================================================ analyse d'une ligne
const N = '([\\d\\s\\u00a0\\u202f]+)';
const RE_LINE = /^(\d\d:\d\d:\d\d)[,.]\d+ - \[([^\]]+)\] (.*)$/;
const RE_XP = new RegExp(`^(.+?) : \\+${N} points d'XP\\.\\s*(?:\\+(\\d+) niveaux?\\.\\s*)?Prochain niveau dans : ${N}\\.`);
const RE_GOT = /^Vous avez ramassé (\d+)x (.+?)\s*\.$/;
const RE_LOST = /^Vous avez perdu (\d+)x (.+?)\s*\.$/;
const RE_FAIL = /^Le plant n'a pas pris/;
const RE_CRAFT = /^Vous avez réussi votre recette de (.+?)\.?$/;
const int = s => +String(s).replace(/\D/g, '');

const JOB_BY_LABEL = Object.fromEntries(ALL.map(j => [norm(j.label), j.key]));
const ITEMS = {}; // nom → { id, icon, job, seed }
HARVEST.forEach(j => j.resources.forEach(r => ['normal', 'rare', 'seed'].forEach(k => (r[k] || []).forEach(it => {
  if (!it || !it.name) return;
  const o = ITEMS[it.name] ||= { id: it.id, icon: it.icon, name: it.name, job: j.key, seed: false };
  if (k === 'seed') o.seed = true;
}))));

function parseLine(line) {
  const m = RE_LINE.exec(line);
  if (!m || m[2] !== 'Information (jeu)') return null;
  const t = m[3];
  let x;
  if ((x = RE_XP.exec(t))) {
    const k = JOB_BY_LABEL[norm(x[1].trim())];
    return k ? { type: 'xp', job: k, gain: int(x[2]), up: +(x[3] || 0), rem: int(x[4]), time: m[1] } : null;
  }
  if ((x = RE_GOT.exec(t))) return { type: 'got', n: +x[1], name: x[2].trim(), time: m[1] };
  if ((x = RE_LOST.exec(t))) {
    const it = ITEMS[x[2].trim()], n = +x[1];
    return { type: it && it.seed && n === 1 ? 'plant' : 'used', n, name: x[2].trim(), time: m[1] }; // 1 graine = plantation, sinon ingrédient
  }
  if ((x = RE_CRAFT.exec(t))) return { type: 'craft', name: x[1].trim(), time: m[1] };
  if (RE_FAIL.test(t)) return { type: 'fail', time: m[1] };
  return null;
}

// ================================================================ réglages + état
const C_DEF = { sound: true, lvlup: true };
const cfg = () => sj.get('chat', C_DEF);
const setCfg = o => sj.set('chat', { ...cfg(), ...o });
const ui = { state: 'off', src: null, name: '', err: '', lastLine: 0, lastXp: null, summary: null, lines: 0 };
let lastRem = {}; // dernier « prochain niveau dans » lu, par métier (pour déduire le niveau exact à la montée)
const resetParse = () => { lastRem = {}; };

// ================================================================ progression (niveau + XP actuelle)
function applyXp(ev, live) {
  const k = ev.job, prev = lastRem[k], oldL = levelOf(k), oldX = xpOf(k);
  lastRem[k] = ev.rem;
  let L = oldL, exact = false;
  if (ev.up) {
    // montée : besoin du nouveau niveau = reste + (gain − reste d'avant) → niveau exact
    if (prev !== undefined && ev.up === 1) {
      const l = (ev.rem + ev.gain - prev - 75) / 150;
      if (Number.isInteger(l) && l >= 1 && l < 300) { L = l; exact = true; }
    }
    if (!exact && live && L !== null) L += ev.up;
  }
  if (L !== null && ev.rem > XP.need(L)) L = Math.ceil((ev.rem - 75) / 150); // niveau enregistré trop bas
  if (L !== null) {
    store.set(lvlKey(k), String(L));
    store.set('xp.' + k, String(Math.max(0, XP.need(L) - ev.rem)));
  }
  ui.lastXp = { job: k, L, rem: ev.rem, gain: ev.gain };
  return { k, L, oldL, oldX, exact };
}

// ================================================================ horodatage des lignes
// Le journal ne donne que l'heure : on reconstruit la date en remontant depuis un instant de référence
// (passage de minuit = l'heure « remonte » de plus d'une heure).
function stamp(lines, ref) {
  const out = new Array(lines.length).fill(null), day = new Date(ref);
  day.setHours(0, 0, 0, 0);
  let base = day.getTime(), prev = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(\d\d):(\d\d):(\d\d)[,.](\d{1,3})/.exec(lines[i]);
    if (!m) continue;
    const tod = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0');
    if (prev === null) { if (base + tod > ref + 60000) base -= 864e5; } else if (tod > prev + 3600e3) base -= 864e5;
    prev = tod;
    out[i] = base + tod;
  }
  return out;
}
// Windows ne met pas toujours à jour la date de modification tant que le jeu garde le fichier ouvert :
// si elle date de moins de 24 h, la dernière ligne est entre elle et maintenant → on part de maintenant.
const refTime = mod => (Date.now() - mod < 864e5 ? Math.max(mod, Date.now()) : mod);
// repère : date de la dernière ligne traitée, pour rattraper ce qui s'est passé pendant que le site était fermé
const MARK = () => sj.get('chat.mark', { at: 0 });

// ================================================================ traitement d'un lot de lignes
// first = lecture initiale du fichier : avant le repère, on met seulement à jour niveaux / XP (sans toucher au sac) ;
// après le repère (site fermé), on rattrape tout (sac compris) puis un résumé. mod = date de modification du fichier.
function feed(lines, first = false, mod = Date.now()) {
  const touched = new Map(), ts = stamp(lines, refTime(mod)), mark = MARK(), notes = [];
  const rep = { n: 0, xp: 0, from: null, ups: {} };
  let lastTs = 0;
  lines.forEach((line, i) => {
    const ev = parseLine(line);
    if (ts[i]) lastTs = ts[i];
    if (!ev) return;
    ev.ts = ts[i] || Date.now();
    const mode = !first ? 'live' : mark.at && ev.ts > mark.at ? 'replay' : 'silent';
    ui.lines++;
    if (mode === 'silent') { if (ev.type === 'xp') touched.set(ev.job, applyXp(ev, false)); return; }
    goalEvent(ev, mode);
    if (mode === 'replay') { rep.n++; rep.from ??= ev.ts; }
    if (ev.type !== 'xp') return;
    const info = applyXp(ev, true);
    touched.set(info.k, info);
    const up = info.oldL !== null && info.L > info.oldL;
    if (mode === 'replay') { rep.xp += ev.gain; if (up) rep.ups[info.k] ??= info.oldL; return; }
    if (up && cfg().lvlup) notes.push([`${getJob(info.k).label} niveau ${info.L} ⬆`, `${fmt(XP.need(info.L) - ev.rem)} / ${fmt(XP.need(info.L))} XP`]);
  });
  if (lastTs) sj.set('chat.mark', { at: Math.max(lastTs, mark.at) });
  if (first) {
    ui.summary = [...touched.values()].map(i => ({ k: i.k, L: levelOf(i.k), xp: xpOf(i.k), exact: i.exact }));
    if (rep.n) {
      const ups = Object.entries(rep.ups).map(([k, l0]) => `${getJob(k).label} ${l0} → ${levelOf(k)}`).join(', ');
      notes.unshift(['Journal rattrapé', `Depuis ${new Date(rep.from).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} : +${fmt(rep.xp)} XP${ups ? ' · ' + ups : ''}`]);
    }
  }
  notes.slice(0, 4).forEach(n => toast(...n));
  if (touched.size) progressChanged([...touched.keys()]);
  goalAfterFeed(first);
}

// rendu léger après une mise à jour de progression ; synchro du compte au plus toutes les 30 s
let syncT = null;
function progressChanged(keys) {
  renderTabs();
  const a = document.activeElement;
  if (st.page === 'metiers' && keys.includes(st.cur) && !(a && a.closest('#job-head'))) renderJobCard(job());
  if (!syncT) syncT = setTimeout(() => { syncT = null; changed(); }, 30000);
}

// ================================================================ sources
// worker : relit le fichier choisi (mode fichier) ou donne le tempo (mode pont) sans être ralenti en arrière-plan
let worker = null;
function getWorker() {
  worker ||= new Worker(new URL('./chatworker.js', import.meta.url));
  worker.onmessage = onWorker;
  return worker;
}
function onWorker(e) {
  const m = e.data;
  if (m.type === 'tick') { pollBridge(); return; }
  if (ui.src !== 'file') return;
  if (m.type === 'lines') {
    ui.err = ''; ui.name = m.name;
    if (m.lines.length) ui.lastLine = Date.now();
    if (m.first) { resetParse(); ui.state = 'on'; }
    feed(m.lines, m.first, m.mod);
    if (m.first) refreshChat();
  } else if (m.type === 'reset') resetParse();
  else if (m.type === 'error') {
    ui.err = m.name === 'NotFoundError' ? 'fichier introuvable (jeu fermé ?)' : m.name === 'NotAllowedError' ? 'accès refusé' : `${m.name || 'Erreur'} : ${m.msg}`;
    if (m.name === 'NotAllowedError') ui.state = 'paused';
    refreshChat();
  }
}
function stopAll() {
  if (worker) worker.postMessage({ cmd: 'stop' });
  ui.src = null; ui.state = 'off'; ui.err = '';
}

// ---------------------------------------------------------------- pont local (waktool-pont.cmd)
const BRIDGE = 'http://127.0.0.1:47811';
let bOff = -1, bBusy = false, bFails = 0, bSkip = 0;
function startBridge() {
  stopAll();
  store.set('chat.src', 'bridge');
  ui.src = 'bridge'; ui.state = 'loading'; ui.name = 'pont Waktool'; ui.lines = 0;
  bOff = -1; bFails = 0; bSkip = 0;
  getWorker().postMessage({ cmd: 'tick', ms: 1000 });
  pollBridge();
}
async function pollBridge() {
  if (ui.src !== 'bridge' || bBusy) return;
  if (bSkip > 0) { bSkip--; return; } // pont injoignable : on réessaie toutes les 5 s
  bBusy = true;
  try {
    const r = await fetch(`${BRIDGE}/log?from=${bOff}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`le pont répond ${r.status}`);
    const H = k => r.headers.get('X-' + k);
    const txt = await r.text(), first = bOff < 0, was = ui.state;
    if (H('Exists') === '0') {
      ui.state = 'on'; ui.err = 'wakfu_chat.log introuvable : lance Wakfu une fois (ou vérifie le chemin affiché par le pont)';
      if (was !== 'on') refreshChat();
    } else {
      if (H('Reset') === '1') resetParse();
      bOff = +H('Next');
      const lines = txt ? txt.split(/\r?\n/).filter(Boolean) : [];
      ui.state = 'on'; ui.err = ''; bFails = 0;
      if (lines.length) ui.lastLine = Date.now();
      if (first) resetParse();
      if (first || lines.length) feed(lines, first, +H('Mod') || Date.now());
      if (first || was !== 'on') refreshChat();
    }
  } catch (e) {
    bFails++; bSkip = 4;
    const was = ui.state + ui.err;
    ui.state = 'wait';
    ui.err = 'pont injoignable : lance waktool-pont.cmd (et autorise « réseau local » si Chrome le demande)';
    if (bFails === 1 || was !== ui.state + ui.err) refreshChat();
  }
  bBusy = false;
}

// ---------------------------------------------------------------- fichier choisi à la main
const supportedFile = () => 'showOpenFilePicker' in window && 'Worker' in window;
const idb = (mode, fn) => new Promise((res, rej) => {
  const r = indexedDB.open('waktool', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const tx = r.result.transaction('kv', mode), q = fn(tx.objectStore('kv'));
    tx.oncomplete = () => { res(q && q.result); r.result.close(); };
    tx.onerror = () => rej(tx.error);
  };
});
const getHandle = () => idb('readonly', s => s.get('chatHandle')).catch(() => null);
const saveHandle = h => idb('readwrite', s => s.put(h, 'chatHandle')).catch(() => {});
const dropHandle = () => idb('readwrite', s => s.delete('chatHandle')).catch(() => {});

function startFile(h) {
  stopAll();
  store.set('chat.src', 'file');
  ui.src = 'file'; ui.state = 'loading'; ui.name = h.name; ui.lines = 0;
  getWorker().postMessage({ cmd: 'start', handle: h });
}
async function linkFile() {
  initAudio();
  let h;
  try {
    [h] = await window.showOpenFilePicker({ id: 'wakfu-chat', types: [{ description: 'Journal du chat Wakfu', accept: { 'text/plain': ['.log', '.txt'] } }] });
  } catch (e) {
    // AbortError = fenêtre fermée… ou fichier refusé par Chrome (dossier AppData = « fichiers système »)
    ui.err = `${e && e.name || 'Erreur'} : ${e && e.message || e}` + (e && e.name === 'AbortError'
      ? ' — si tu as choisi le fichier dans AppData, c’est Chrome qui le bloque : utilise le pont.' : '');
    refreshChat();
    return;
  }
  if (!/chat/i.test(h.name) && !confirm(`« ${h.name} » ne ressemble pas au journal du chat (wakfu_chat.log). Continuer ?`)) return;
  await saveHandle(h);
  startFile(h);
  refreshChat();
}
async function resumeFile() {
  initAudio();
  const h = await getHandle();
  if (!h) { ui.state = 'off'; refreshChat(); return; }
  try { if (await h.requestPermission({ mode: 'read' }) === 'granted') { startFile(h); refreshChat(); } } catch (e) { ui.err = `${e.name} : ${e.message}`; refreshChat(); }
}
async function unlink() {
  stopAll(); store.set('chat.src', '');
  await dropHandle();
  ui.summary = null; refreshChat();
}

// au chargement : reprise automatique de la dernière source
(async () => {
  const src = store.get('chat.src');
  if (src === 'bridge') { startBridge(); return; }
  if (src !== 'file' || !supportedFile()) return;
  const h = await getHandle();
  if (!h) return;
  ui.name = h.name; ui.src = 'file';
  try {
    if (await h.queryPermission({ mode: 'read' }) === 'granted') startFile(h);
    else { ui.state = 'paused'; refreshChat(); }
  } catch { ui.state = 'paused'; }
})();

// ================================================================ panneau (page Objectif)
const refreshChat = () => refreshObjectif();
function chatPanelHtml() {
  const c = cfg(), on = ui.state === 'on';
  const ago = ui.lastLine ? Math.round((Date.now() - ui.lastLine) / 1000) : null;
  const status = on ? `<span class="chat-on">● En direct</span> · ${esc(ui.name)}${ago !== null ? ` · dernière ligne il y a ${ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' min'}` : ''}`
    : ui.state === 'loading' ? 'Connexion…'
      : ui.state === 'wait' ? '<span class="warn-txt">○ En attente du pont</span>'
        : ui.state === 'paused' ? `En pause · ${esc(ui.name)} (le navigateur redemande l’accès)` : 'Non lié';
  const sum = on && ui.summary && ui.summary.length ? `<p class="meta">Lu dans le journal : ${ui.summary.map(x => {
    const j = getJob(x.k);
    return `<b>${esc(j.label)}</b> ${x.L === null ? '(niveau inconnu : renseigne-le ou attends une montée)' : `${x.L} · ${fmt(x.xp)} / ${fmt(XP.need(x.L))} XP`}`;
  }).join(' · ')}</p>` : '';
  const btns = ui.src ? `${ui.state === 'paused' ? '<button type="button" class="gbtn small" data-chat="resume">▶ Reprendre</button>' : ''}<button type="button" class="lnk" data-chat="unlink">Délier</button>` : '';
  const setup = ui.src && ui.state !== 'wait' ? '' : `
    <ol class="bridge-steps">
      <li><div><a class="gbtn small" href="pont/waktool-pont.cmd" download="waktool-pont.cmd">⤓ Télécharger le pont</a></div>
        <span>Un petit script Windows (PowerShell, rien à installer) qui lit <code>wakfu_chat.log</code> pour le site.</span></li>
      <li><div><b>Double-clique</b> sur <code>waktool-pont.cmd</code> et laisse la fenêtre ouverte.</div>
        <span>Si Windows affiche « Windows a protégé votre ordinateur » : <i>Informations complémentaires → Exécuter quand même</i>. Il propose de se lancer tout seul au démarrage de Windows.</span></li>
      <li><div><button type="button" class="gbtn small" data-chat="bridge">🔗 Connecter</button></div>
        <span>Chrome demande l’accès aux « appareils du réseau local » : <b>Autoriser</b> (le pont n’écoute que sur ton PC).</span></li>
    </ol>
    <details class="more"><summary>Autre méthode : choisir un fichier</summary>
      <p class="meta">Chrome refuse d’ouvrir un fichier du dossier AppData (« fichiers système ») : ça ne marche qu’avec une copie du journal placée ailleurs.</p>
      ${supportedFile() ? '<button type="button" class="gbtn small" data-chat="link">Choisir un fichier…</button>' : '<p class="meta">Demande Chrome ou Edge sur PC.</p>'}
    </details>`;
  return `<section class="panel chat-box ${on ? 'on' : ''}" id="chat-box">
    <div class="panel-head"><h4>Journal du chat</h4><div class="chat-btns">${btns}</div></div>
    <p class="chat-status">${status}${ui.err ? ` · <span class="warn-txt">${esc(ui.err)}</span>` : ''}</p>
    ${setup}${sum}
    <div class="chat-opts">
      <label class="chk"><input type="checkbox" data-chatcfg="sound" ${c.sound ? 'checked' : ''}> Son des alertes</label>
      <label class="chk"><input type="checkbox" data-chatcfg="lvlup" ${c.lvlup ? 'checked' : ''}> Message à chaque niveau</label>
    </div>
    <p class="meta">Seules les lignes « Information (jeu) » sont lues (XP, objets ramassés / utilisés, plantations, crafts) : les discussions sont ignorées et rien n’est envoyé.</p>
  </section>`;
}

async function chatClick(a) {
  const k = a.dataset.chat;
  initAudio();
  if (k === 'bridge') { startBridge(); refreshChat(); } else if (k === 'link') await linkFile();
  else if (k === 'resume') await resumeFile();
  else if (k === 'unlink') await unlink();
}
function chatCfgChange(el) {
  const k = el.dataset.chatcfg;
  setCfg({ [k]: el.type === 'checkbox' ? el.checked : +el.value });
  if (k === 'sound' && el.checked) { initAudio(); beep(); }
}

export { parseLine, feed, startFile as chatStart, startBridge, chatPanelHtml, chatClick, chatCfgChange, ITEMS, ui as chatUi, BRIDGE };
