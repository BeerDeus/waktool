// Waktool — lecture en continu de wakfu_chat.log (worker : pas ralenti quand l'onglet est en arrière-plan)
// Mode fichier : reçoit un FileSystemFileHandle, relit uniquement la fin du fichier chaque seconde et renvoie les lignes complètes.
// Mode pont : envoie juste un « tick » par seconde (la page interroge alors le pont local).
const FIRST_MAX = 5e6; // à la liaison : on relit au plus les 5 derniers Mo
let h = null, off = 0, rest = '', dec = new TextDecoder('utf-8'), busy = false, iv = null;

async function poll(first = false) {
  if (busy || !h) return;
  busy = true;
  try {
    const f = await h.getFile();
    if (f.size < off) { off = 0; rest = ''; dec = new TextDecoder('utf-8'); postMessage({ type: 'reset' }); } // fichier recréé / vidé
    if (f.size > off || first) {
      const start = first ? Math.max(0, f.size - FIRST_MAX) : off;
      const txt = dec.decode(await f.slice(start, f.size).arrayBuffer(), { stream: true });
      off = f.size;
      const lines = (rest + txt).split(/\r?\n/);
      rest = lines.pop();
      if (first && start > 0) lines.shift(); // première ligne coupée
      postMessage({ type: 'lines', lines, first, name: f.name, size: f.size, mod: f.lastModified });
    } else postMessage({ type: 'idle' });
  } catch (e) {
    postMessage({ type: 'error', name: e && e.name, msg: String(e && e.message || e) });
  }
  busy = false;
}

onmessage = async e => {
  const m = e.data || {};
  clearInterval(iv); iv = null;
  if (m.cmd === 'start') {
    h = m.handle; off = 0; rest = ''; dec = new TextDecoder('utf-8');
    await poll(true);
    if (h === m.handle) iv = setInterval(poll, 1000);
  } else if (m.cmd === 'tick') {
    h = null;
    iv = setInterval(() => postMessage({ type: 'tick' }), m.ms || 1000);
  } else if (m.cmd === 'stop') h = null;
};
