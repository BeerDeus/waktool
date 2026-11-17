// Waktool — journal du chat Wakfu (wakfu_chat.log) lu en direct, dans le navigateur uniquement.
// Seules les lignes « [Information (jeu)] » sont lues (XP de métier, objets ramassés, plantations) :
// les canaux de discussion (Commerce, Guilde, messages privés…) sont ignorés et rien n'est envoyé nulle part.
import { st } from './state.js?v=ce18e5b8';
import { $, changed, esc, fmt, norm, sj, store } from './util.js?v=ce18e5b8';
import { ALL, HARVEST, PLANTABLE, XP, allItems, getJob, levelOf, lvlKey, resOfItem, xpOf } from './model.js?v=ce18e5b8';
import { job, renderTabs } from './main.js?v=ce18e5b8';
import { renderJobCard } from './metiers.js?v=ce18e5b8';
import { refreshSession, sess, setSess } from './session.js?v=ce18e5b8';

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
  const o = ITEMS[it.name] ||= { id: it.id, icon: it.icon, job: j.key, seed: false };
  if (k === 'seed') o.seed = true;
}))));

// produits fabriqués : id / icône pris dans les recettes (chargées à la première ligne de craft)
const CRAFTED = {};
function learnCrafted(name) {
  if (CRAFTED[name] || ITEMS[name]) return;
  allItems().then(list => {
    const it = list.find(x => x.name === name);
    if (it) { CRAFTED[name] = { id: it.id, icon: it.icon }; refreshSession(); }
  });
}

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
const C_DEF = { auto: true, sound: true, lvlup: true, idle: 0 };
const cfg = () => sj.get('chat', C_DEF);
const setCfg = o => sj.set('chat', { ...cfg(), ...o });
const ui = { state: 'off', name: '', err: '', lastLine: 0, lastXp: null, summary: null, lines: 0 };
let lastRem = {}; // dernier « prochain niveau dans » lu, par métier (pour déduire le niveau exact à la montée)
let lastEvt = 0, idleWarned = false;
const supported = () => 'showOpenFilePicker' in window && 'Worker' in window;

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

// ================================================================ alertes : notification + son + bandeau
let actx = null;
function initAudio() { try { actx ||= new AudioContext(); actx.resume(); } catch { /* pas de son */ } }
function beep() {
  if (!cfg().sound || !actx) return;
  try {
    const t = actx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t + i * 0.13); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.13 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.13 + 0.25);
      o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.3);
    });
  } catch { /* ignore */ }
}
function toast(title, body) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}`;
  el.addEventListener('click', () => el.remove());
  box.append(el);
  setTimeout(() => el.remove(), 9000);
}
function alertUser(title, body) {
  toast(title, body);
  beep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Waktool : ' + title, { body, icon: 'img/app/icon-192.png', tag: 'waktool-' + title }); } catch { /* ignore */ }
  }
}

// ================================================================ session (comptage réel)
// Une ligne d'XP n'est classée qu'avec la suite :
//   récolte    : XP → « ramassé Nx objet »
//   plantation : XP → « perdu 1x graine »
//   craft      : XP × n (une par craft, aucune si la recette est trop basse) → « perdu » ingrédients → « ramassé » produit → « réussi votre recette »
let pend = [], gots = [], used = [];
function resolve(kind) {
  if (!pend.length && kind !== 'craft') return;
  const s = sess();
  if (s.real) {
    if (kind === 'p') { s.real.p += 1; s.real.h += pend.length - 1; }
    else if (kind === 'h') s.real.h += pend.length;
    s.cnt = { h: s.real.h, p: s.real.p };
    setSess(s);
  }
  pend = []; gots = []; used = [];
}
function sessionEvent(ev, info, mode, notes) {
  if (ev.type === 'plant') { resolve('p'); return; }
  if (ev.type === 'xp' && gots.length) resolve('h');
  const s = sess(), c = cfg();
  if (ev.type === 'xp') {
    if (getJob(ev.job).type !== 'harvest') return;
    // rattrapage : un trou de plus de 15 min entre deux XP = pause (le chrono ne compte que le temps de jeu)
    if (mode === 'replay' && s.start && s.real && s.lastTs && ev.ts - s.lastTs > GAP) { s.acc += s.lastTs - s.start; s.start = ev.ts; }
    if (!s.start) {
      const fresh = !s.acc && !s.real && !(s.cnt.h + s.cnt.p);
      if (!c.auto || (!fresh && s.job !== ev.job)) return;
      if (fresh) { s.job = ev.job; s.res = null; s.prod = null; s.done = null; s.notified = false; s.goalsHit = {}; s.autoRes = true; }
      s.start = mode === 'replay' ? ev.ts : Date.now();
    }
    if (s.job !== ev.job) return;
    s.real ||= { xp: 0, h: 0, p: 0, fail: 0, items: {}, L0: info.oldL, x0: info.oldX };
    if (s.real.L0 === null) s.real.L0 = info.L;
    s.real.xp += ev.gain;
    s.lastTs = ev.ts;
    setSess(s);
    pend.push(ev);
    return;
  }
  if (!s.start || !s.real) return;
  if (ev.type === 'fail') { s.real.fail += 1; setSess(s); return; }
  if (ev.type === 'used') { used.push(ev); return; }
  if (ev.type === 'craft') {
    // produit fabriqué (déjà compté dans « ramassé ») + ingrédients consommés + XP de craft
    const R = s.real, prod = gots.filter(g => g.name === ev.name).reduce((a, g) => a + g.n, 0);
    R.crafted ||= {}; R.used ||= {};
    R.crafted[ev.name] = (R.crafted[ev.name] || 0) + prod;
    used.forEach(u => { R.used[u.name] = (R.used[u.name] || 0) + u.n; });
    R.craftXp = (R.craftXp || 0) + pend.reduce((a, e) => a + e.gain, 0);
    R.crafts = (R.crafts || 0) + 1;
    learnCrafted(ev.name);
    setSess(s);
    resolve('craft');
    return;
  }
  if (ev.type === 'got') {
    gots.push(ev);
    s.real.items[ev.name] = (s.real.items[ev.name] || 0) + ev.n;
    const it = ITEMS[ev.name];
    if (s.autoRes && it && it.job === s.job && !it.seed) {
      const r = resOfItem(getJob(s.job), it.id);
      if (r) { s.res = r.name; s.prod = it.id; s.autoRes = false; }
    }
    const goal = (s.goals || {})[ev.name];
    s.goalsHit ||= {};
    if (goal && !s.goalsHit[ev.name] && s.real.items[ev.name] >= goal) {
      s.goalsHit[ev.name] = true;
      notes.push(['Objectif atteint 🎯', `${fmt(s.real.items[ev.name])} × ${ev.name} (objectif ${fmt(goal)})`]);
    }
    setSess(s);
  }
}

// ================================================================ horodatage des lignes
// Le journal ne donne que l'heure : on reconstruit la date en remontant depuis la date de modification
// du fichier (passage de minuit = l'heure « remonte » de plus d'une heure).
function stamp(lines, mod) {
  const out = new Array(lines.length).fill(null), day = new Date(mod);
  day.setHours(0, 0, 0, 0);
  let base = day.getTime(), prev = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(\d\d):(\d\d):(\d\d)[,.](\d{1,3})/.exec(lines[i]);
    if (!m) continue;
    const tod = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0');
    if (prev === null) { if (base + tod > mod + 60000) base -= 864e5; } else if (tod > prev + 3600e3) base -= 864e5;
    prev = tod;
    out[i] = base + tod;
  }
  return out;
}
const GAP = 15 * 60000;
// repère : date de la dernière ligne traitée, pour rattraper ce qui s'est passé pendant que le site était fermé
const MARK = () => sj.get('chat.mark', { at: 0 });

// ================================================================ traitement d'un lot de lignes
// first = lecture initiale du fichier : avant le repère, on met seulement à jour niveaux / XP (sans session ni alerte) ;
// après le repère (site fermé ou fichier pas encore lié), on rattrape tout : session, objets, objectifs, puis un résumé.
// mod = date de modification du fichier (horodatage).
function feed(lines, first = false, mod = Date.now()) {
  const touched = new Map(), ts = stamp(lines, mod), mark = MARK(), notes = [];
  const rep = { n: 0, xp: 0, from: null, ups: {} };
  let lastTs = 0;
  lines.forEach((line, i) => {
    const ev = parseLine(line);
    if (ts[i]) lastTs = ts[i];
    if (!ev) return;
    ev.ts = ts[i] || Date.now();
    const mode = !first ? 'live' : mark.at && ev.ts > mark.at ? 'replay' : 'silent';
    ui.lines++;
    if (mode === 'replay') { rep.n++; rep.from ??= ev.ts; }
    if (ev.type === 'xp') {
      const info = applyXp(ev, mode !== 'silent');
      touched.set(info.k, info);
      if (mode === 'silent') return;
      lastEvt = mode === 'live' ? Date.now() : ev.ts; idleWarned = false;
      sessionEvent(ev, info, mode, notes);
      const j = getJob(info.k);
      if (mode === 'replay') {
        rep.xp += ev.gain;
        if (info.oldL !== null && info.L > info.oldL) { rep.ups[info.k] ??= info.oldL; }
        return;
      }
      if (info.oldL !== null && info.L > info.oldL) {
        const tg = +(store.get('target.' + info.k) || 0), s = sess();
        if (tg && info.L >= tg && !(s.job === info.k && s.notified)) {
          if (s.job === info.k) { s.notified = true; setSess(s); }
          notes.push(['Objectif de niveau atteint 🎉', `${j.label} niveau ${info.L}`]);
        } else if (cfg().lvlup) notes.push(['Niveau supérieur ⬆', `${j.label} niveau ${info.L}`]);
      }
    } else if (mode !== 'silent') sessionEvent(ev, null, mode, notes);
  });
  // fin de lot : XP suivie d'une ressource récoltable = récolte (un produit de craft attend sa ligne « réussi »)
  if (pend.length && gots.length && gots.every(g => ITEMS[g.name])) resolve('h');
  if (lastTs) sj.set('chat.mark', { at: Math.max(lastTs, mark.at) });
  if (first) {
    ui.summary = [...touched.values()].map(i => ({ k: i.k, L: levelOf(i.k), xp: xpOf(i.k), exact: i.exact }));
    if (rep.n) {
      // fin du rattrapage : session mise en pause si la dernière XP date un peu
      const s = sess();
      if (s.start && s.real && s.lastTs && Date.now() - s.lastTs > GAP) { s.acc += s.lastTs - s.start; s.start = null; setSess(s); }
      const ups = Object.entries(rep.ups).map(([k, l0]) => `${getJob(k).label} ${l0} → ${levelOf(k)}`).join(', ');
      ui.replay = { n: rep.n, xp: rep.xp, from: rep.from, ups };
      notes.unshift(['Journal rattrapé', `Depuis ${new Date(rep.from).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} : +${fmt(rep.xp)} XP${ups ? ' · ' + ups : ''}`]);
    }
  }
  if (notes.length) {
    // une seule alerte sonore par lot ; les suivantes en bandeau
    alertUser(...notes[0]);
    notes.slice(1, 4).forEach(n => toast(...n));
  }
  if (touched.size) progressChanged([...touched.keys()]);
  if (!first || touched.size) refreshSession();
}

// rendu léger après une mise à jour de progression ; synchro du compte au plus toutes les 30 s
let syncT = null;
function progressChanged(keys) {
  renderTabs();
  const a = document.activeElement;
  if (st.page === 'metiers' && keys.includes(st.cur) && !(a && a.closest('#job-head'))) renderJobCard(job());
  if (!syncT) syncT = setTimeout(() => { syncT = null; changed(); }, 30000);
}

// ================================================================ fichier : liaison, worker, reprise
let worker = null;
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

function start(h) {
  worker ||= new Worker(new URL('./chatworker.js', import.meta.url));
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'lines') {
      ui.err = ''; ui.name = m.name; ui.lastLine = Date.now();
      if (m.first) { lastRem = {}; pend = []; gots = []; used = []; ui.state = 'on'; }
      feed(m.lines, m.first, m.mod);
      if (m.first) refreshSession();
    } else if (m.type === 'reset') { lastRem = {}; pend = []; gots = []; used = []; }
    else if (m.type === 'error') {
      ui.err = m.name === 'NotFoundError' ? 'fichier introuvable (jeu fermé ?)' : m.name === 'NotAllowedError' ? 'accès refusé' : m.msg;
      if (m.name === 'NotAllowedError') ui.state = 'paused';
      refreshSession();
    }
  };
  ui.state = 'loading'; ui.name = h.name; ui.lines = 0;
  worker.postMessage({ cmd: 'start', handle: h });
}
function stop() { if (worker) worker.postMessage({ cmd: 'stop' }); ui.state = 'off'; }

async function link() {
  initAudio();
  let h;
  try {
    [h] = await window.showOpenFilePicker({ id: 'wakfu-chat', types: [{ description: 'Journal du chat Wakfu', accept: { 'text/plain': ['.log', '.txt'] } }] });
  } catch { return; } // annulé
  if (!/chat/i.test(h.name) && !confirm(`« ${h.name} » ne ressemble pas au journal du chat (wakfu_chat.log). Continuer ?`)) return;
  await saveHandle(h);
  start(h);
  refreshSession();
}
async function resume() {
  initAudio();
  const h = await getHandle();
  if (!h) { ui.state = 'off'; refreshSession(); return; }
  try { if (await h.requestPermission({ mode: 'read' }) === 'granted') { start(h); refreshSession(); } } catch { /* ignore */ }
}
async function unlink() { stop(); await dropHandle(); ui.summary = null; refreshSession(); }

// au chargement : icônes / prix des produits fabriqués de la session en cours
setTimeout(() => Object.keys((sess().real || {}).crafted || {}).forEach(learnCrafted), 0);

// au chargement : reprise automatique si le navigateur a gardé l'autorisation
(async () => {
  if (!supported()) return;
  const h = await getHandle();
  if (!h) return;
  ui.name = h.name;
  try {
    if (await h.queryPermission({ mode: 'read' }) === 'granted') start(h);
    else { ui.state = 'paused'; refreshSession(); }
  } catch { ui.state = 'paused'; }
})();

// inactivité : plus d'XP depuis N minutes alors que la session tourne
setInterval(() => {
  const m = cfg().idle, s = sess();
  if (!m || ui.state !== 'on' || !s.start || !s.real || !lastEvt || idleWarned) return;
  if (Date.now() - lastEvt > m * 60000) { idleWarned = true; alertUser('Plus d’XP depuis ' + m + ' min', 'La ressource est peut-être épuisée.'); }
}, 15000);

// ================================================================ panneau (page Session)
function chatPanelHtml() {
  const c = cfg();
  const head = '<h4>Journal du chat <small>· lecture en direct de <code>wakfu_chat.log</code></small></h4>';
  if (!supported()) {
    return `<div class="panel chat-box" id="chat-box">${head}<p class="meta">La lecture en direct demande <b>Chrome</b> ou <b>Edge</b> sur PC (accès aux fichiers). Tu peux continuer à compter avec les boutons ci-dessous.</p></div>`;
  }
  const ago = ui.lastLine ? Math.round((Date.now() - ui.lastLine) / 1000) : null;
  const lx = ui.lastXp, lj = lx && getJob(lx.job);
  const status = ui.state === 'on' ? `<span class="chat-on">● En direct</span> · ${esc(ui.name)}${ago !== null ? ` · lu il y a ${ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' min'}` : ''}`
    : ui.state === 'loading' ? 'Lecture du fichier…'
      : ui.state === 'paused' ? `En pause · ${esc(ui.name)} (le navigateur redemande l’accès)` : 'Non lié';
  const sum = ui.summary && ui.summary.length ? `<p class="meta">Progression lue dans le journal : ${ui.summary.map(x => {
    const j = getJob(x.k);
    return `<b>${esc(j.label)}</b> ${x.L === null ? '(niveau inconnu : renseigne-le ou attends une montée)' : `${x.L} · ${fmt(x.xp)} / ${fmt(XP.need(x.L))} XP`}`;
  }).join(' · ')}</p>` : '';
  const last = lx && ui.state === 'on' ? `<p class="meta">Dernière XP : ${esc(lj.label)} +${fmt(lx.gain)}${lx.L !== null ? ` · niveau ${lx.L} · plus que ${fmt(lx.rem)} XP` : ''}</p>` : '';
  const btns = ui.state === 'off'
    ? '<button type="button" class="gbtn" data-chat="link">🔗 Lier le journal du chat</button>'
    : `${ui.state === 'paused' ? '<button type="button" class="gbtn" data-chat="resume">▶ Reprendre la lecture</button>' : ''}<button type="button" class="lnk" data-chat="unlink">Délier</button>`;
  return `<div class="panel chat-box ${ui.state === 'on' ? 'on' : ''}" id="chat-box">
    <div class="panel-head">${head}<div class="chat-btns">${btns}</div></div>
    <p class="chat-status">${status}${ui.err ? ` · <span class="warn-txt">${esc(ui.err)}</span>` : ''}</p>
    ${ui.state === 'off' ? `<p class="meta">Choisis le fichier <code>wakfu_chat.log</code> (colle <code>%APPDATA%\\zaap\\gamesLogs\\wakfu\\logs</code> dans la barre d’adresse de la fenêtre).
      Le site lit alors ton XP, ton niveau exact, tes récoltes, plantations et objets ramassés au fil du jeu. Seules les lignes « Information (jeu) » sont lues : les discussions sont ignorées et rien n’est envoyé.</p>` : ''}
    ${sum}${last}
    <div class="chat-opts">
      <label class="chk"><input type="checkbox" data-chatcfg="auto" ${c.auto ? 'checked' : ''}> Démarrer la session à la première XP</label>
      <label class="chk"><input type="checkbox" data-chatcfg="lvlup" ${c.lvlup ? 'checked' : ''}> Alerte à chaque niveau</label>
      <label class="chk"><input type="checkbox" data-chatcfg="sound" ${c.sound ? 'checked' : ''}> Son</label>
      <label class="chk">Alerte sans XP depuis <select data-chatcfg="idle">${[0, 2, 3, 5, 10].map(m => `<option value="${m}" ${c.idle === m ? 'selected' : ''}>${m ? m + ' min' : 'jamais'}</option>`).join('')}</select></label>
      ${'Notification' in window && Notification.permission !== 'granted' ? '<button type="button" class="lnk" data-chat="notif">🔔 Autoriser les notifications</button>' : ''}
    </div>
  </div>`;
}

async function chatClick(a) {
  const k = a.dataset.chat;
  if (k === 'link') await link();
  else if (k === 'resume') await resume();
  else if (k === 'unlink') await unlink();
  else if (k === 'notif') { initAudio(); await Notification.requestPermission(); refreshSession(); }
}
function chatCfgChange(el) {
  const k = el.dataset.chatcfg;
  setCfg({ [k]: el.type === 'checkbox' ? el.checked : +el.value });
  if (k === 'sound' && el.checked) { initAudio(); beep(); }
}
// fin de session : la dernière XP non classée compte comme une récolte
const endSession = () => resolve('h');

export { parseLine, feed, start as chatStart, chatPanelHtml, chatClick, chatCfgChange, endSession, ITEMS, CRAFTED, ui as chatUi };
