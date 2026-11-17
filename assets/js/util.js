// Waktool — module util
const D = window.WAKFU_DATA;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('waktool.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('waktool.' + k, v); } catch { /* ignore */ } },
};
const sj = {
  get(k, d) { try { return { ...d, ...(JSON.parse(store.get(k)) || {}) }; } catch { return { ...d }; } },
  set(k, v) { store.set(k, JSON.stringify(v)); },
};
const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v ?? d; } catch { return d; } };
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const fmt1 = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const fmtDur = s => {
  if (!isFinite(s)) return '∞';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
const clock = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const sec = d => (Math.round(d * 10 + 1e-6) / 10).toFixed(1).replace('.', ',');
const fmtK = n => (Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' M'
  : Math.abs(n) >= 1e4 ? Math.round(n / 1e3).toLocaleString('fr-FR') + ' k' : fmt(n)) + ' ₭';
const ago = ts => { const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? 'aujourd’hui' : d === 1 ? 'hier' : `il y a ${d} j`; };
const icon = (it, cls = '') => it && it.icon
  ? `<img src="${it.icon}" alt="" loading="lazy" class="${cls}" title="${esc(it.name)}">`
  : `<span class="noimg ${cls}"></span>`;

$('#ver').textContent = D.version ? `v${D.version}` : '';
const listeners = [];
const changed = () => listeners.forEach(f => f());

export { $, D, esc, store, sj, jget, norm, fmt, fmt1, fmtDur, clock, sec, fmtK, ago, icon, listeners, changed };
