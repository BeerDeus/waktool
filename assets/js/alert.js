// Waktool — alertes visibles à l'écran (pas de notifications système) : gros bandeau + bord qui pulse + son
import { $, esc, sj } from './util.js?v=30e09915';

const soundOn = () => sj.get('chat', { sound: true }).sound;
let actx = null;
function initAudio() { try { actx ||= new AudioContext(); actx.resume(); } catch { /* pas de son */ } }
function beep(big = false) {
  if (!soundOn() || !actx) return;
  try {
    const t = actx.currentTime, notes = big ? [523, 659, 784, 1047, 1319] : [660, 880, 1320];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), at = t + i * 0.13;
      o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      o.start(at); o.stop(at + 0.32);
    });
  } catch { /* ignore */ }
}
// le navigateur n'autorise le son qu'après une action de l'utilisateur
['pointerdown', 'keydown'].forEach(e => document.addEventListener(e, initAudio, { once: true, capture: true }));

// petit message en bas à droite (informations secondaires)
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

// titre de l'onglet qui clignote tant que la page est en arrière-plan
const BASE_TITLE = document.title;
let blinkT = null;
function blinkTitle(msg) {
  clearInterval(blinkT); blinkT = null;
  if (!document.hidden) return;
  let on = false;
  blinkT = setInterval(() => { on = !on; document.title = on ? `⚡ ${msg}` : BASE_TITLE; }, 1000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && blinkT) { clearInterval(blinkT); blinkT = null; document.title = BASE_TITLE; } });

// alerte importante : bord de l'écran qui pulse + son, et selon le style choisi (page Objectif > Réglages) :
//   edge = discrète (barre en bas, se ferme seule après 15 s ; par défaut) ; banner = bandeau en haut ; full = plein écran
// Le bord de l'écran clignote 5 s au plus.
let pulseT = null, autoT = null;
const PULSE_MS = 5000;
const alertStyle = () => sj.get('goal', { alert: 'edge' }).alert || 'edge';
function flash(title, body = '', { big = false, sound = true } = {}) {
  const style = big ? (alertStyle() === 'edge' ? 'banner' : alertStyle()) : alertStyle();
  let el = $('#flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash'; el.setAttribute('role', 'alert');
    el.addEventListener('click', e => { if (e.target.closest('[data-flash-x]') || el.classList.contains('full')) dismissFlash(); });
    document.body.append(el);
  }
  el.className = `flash ${style}${big ? ' big' : ''}`;
  el.innerHTML = `<div class="flash-txt"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}</div><button type="button" class="flash-ok" data-flash-x>OK</button>`;
  el.hidden = false;
  const b = document.body;
  b.classList.remove('pulse', 'pulse-big', 'pulse-card');
  void b.offsetWidth; // relance l'animation
  b.classList.add(big ? 'pulse-big' : 'pulse');
  if (style === 'edge') b.classList.add('pulse-card');
  clearTimeout(pulseT); pulseT = setTimeout(() => b.classList.remove('pulse', 'pulse-big', 'pulse-card'), PULSE_MS); // 5 s de clignotement max
  clearTimeout(autoT);
  if (style === 'edge') autoT = setTimeout(dismissFlash, 15000);
  if (sound) beep(big);
  blinkTitle(title);
}
function dismissFlash() {
  const el = $('#flash');
  if (el) el.hidden = true;
  document.body.classList.remove('pulse', 'pulse-big', 'pulse-card');
}

export { initAudio, beep, toast, flash, dismissFlash };
