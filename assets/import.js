// Import des niveaux de métiers depuis une capture de la fenêtre Métiers (J).
// Ctrl+V d'une image, glisser-déposer ou sélection de fichier ; OCR local (Tesseract.js, self-hosted).
(() => {
  const W = window.waktool;
  const D = window.WAKFU_DATA;
  const BASE = (window.WAKTOOL_TESS_BASE || 'vendor/tesseract/');
  const JOBS = D.jobs.map(j => ({ key: j.key, label: j.label, n: norm(j.label) }));

  function norm(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[m][n];
  }

  // ---------------------------------------------------------------- OCR
  let tessLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (!tessLoading) {
      tessLoading = new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = BASE + 'tesseract.min.js';
        s.onload = ok;
        s.onerror = () => ko(new Error('Chargement de Tesseract impossible'));
        document.head.append(s);
      });
    }
    return tessLoading;
  }

  let workerP = null;
  async function getWorker(onProgress) {
    await loadTesseract();
    if (!workerP) {
      const abs = new URL(BASE, location.href).href;
      workerP = window.Tesseract.createWorker('fra', 1, {
        workerPath: abs + 'worker.min.js',
        corePath: abs,
        langPath: abs,
        logger: m => onProgress && onProgress(m),
      }).then(async w => {
        await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        return w;
      });
    }
    return workerP;
  }

  // agrandit, passe en niveaux de gris et inverse (texte clair sur fond sombre -> noir sur blanc)
  async function preprocess(bmp, O) {
    const scale = Math.max(1, Math.min(4, 1400 / Math.max(bmp.width, bmp.height)));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, 0, 0, c.width, c.height);
    const img = x.getImageData(0, 0, c.width, c.height);
    const p = img.data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) sum += 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const dark = sum / (p.length / 4) < 128;
    for (let i = 0; i < p.length; i += 4) {
      let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      if (dark) g = 255 - g;
      if (O.thr) g = g < O.thr ? g * 0.6 : 255; // renforce le contraste
      p[i] = p[i + 1] = p[i + 2] = g;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  const DIGIT_FIX = { o: '0', O: '0', D: '0', Q: '0', l: '1', I: '1', '|': '1', i: '1', '!': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9', G: '6' };

  function parseLevels(lines) {
    const found = {};
    for (const raw of lines) {
      const t = norm(raw).replace(/[^a-z0-9.|!' ]/g, ' ');
      // métier : un mot proche (distance <= 2) d'un nom de métier de récolte
      let best = null;
      for (const w of t.split(/\s+/).filter(w => w.length >= 4)) {
        for (const j of JOBS) {
          const d = lev(w, j.n);
          if (d <= Math.max(1, Math.floor(j.n.length / 4)) && (!best || d < best.d)) best = { j, d };
        }
      }
      if (!best) continue;
      // niveau : "Niv. 14" (tolérant aux confusions OCR), sinon nombre en fin de ligne
      const m = raw.match(/n[il1|!][vuy]\s*[.,:]?\s*([0-9oODQlI|i!SsBZzgG]{1,3})/i) || raw.match(/([0-9]{1,3})\s*$/);
      if (!m) continue;
      const lvl = parseInt(m[1].replace(/./g, ch => DIGIT_FIX[ch] ?? ch), 10);
      if (Number.isFinite(lvl) && lvl >= 0 && lvl <= 250 && !(best.j.key in found)) found[best.j.key] = lvl;
    }
    return found;
  }

  // 3 passes (prétraitements différents) + vote majoritaire par métier
  const PASSES = [{ thr: 120 }, { thr: 180 }, {}];

  async function recognize(blob, onProgress) {
    const bmp = await createImageBitmap(blob);
    const w = await getWorker(onProgress);
    const votes = {};
    let text = '';
    for (const [i, pass] of PASSES.entries()) {
      const { data } = await w.recognize(await preprocess(bmp, pass));
      let lines = (data.lines || []).map(l => l.text.trim()).filter(Boolean);
      if (!lines.length) lines = data.text.split('\n');
      if (!text) text = lines.join('\n');
      for (const [k, v] of Object.entries(parseLevels(lines))) (votes[k] ||= []).push(v);
      onProgress && onProgress({ status: 'pass', progress: (i + 1) / PASSES.length });
    }
    const levels = {}, unsure = [];
    for (const [k, vs] of Object.entries(votes)) {
      const count = vs.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map());
      const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      levels[k] = best;
      if (n < PASSES.length) unsure.push(k);
    }
    return { levels, unsure, text };
  }
  W.recognizeScreenshot = recognize; // utile pour les tests

  // ---------------------------------------------------------------- UI
  const dlg = document.createElement('dialog');
  dlg.className = 'imp';
  document.body.append(dlg);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function openHelp() {
    dlg.innerHTML = `
      <form method="dialog">
        <h3>Importer mes niveaux</h3>
        <p>Ouvre la fenêtre <b>Métiers</b> en jeu (touche <kbd>J</kbd>), fais une capture
          (<kbd>Win</kbd>+<kbd>Maj</kbd>+<kbd>S</kbd>) puis <b>colle-la ici avec <kbd>Ctrl</kbd>+<kbd>V</kbd></b>.</p>
        <label class="imp-drop" id="imp-drop">
          <input type="file" accept="image/*" hidden id="imp-file">
          <span>Ctrl+V, glisse une image ici ou clique pour choisir un fichier</span>
        </label>
        <menu><button value="cancel" class="lnk">Fermer</button></menu>
      </form>`;
    dlg.querySelector('#imp-file').onchange = e => e.target.files[0] && handle(e.target.files[0]);
    bindDrop(dlg.querySelector('#imp-drop'));
    if (!dlg.open) dlg.showModal();
  }

  async function handle(blob) {
    const url = URL.createObjectURL(blob);
    dlg.innerHTML = `
      <form method="dialog">
        <h3>Importer mes niveaux</h3>
        <div class="imp-body">
          <img src="${url}" alt="Capture" class="imp-shot">
          <div class="imp-res"><p class="imp-status">Analyse de la capture…</p><progress max="1" value="0"></progress></div>
        </div>
        <menu><button value="cancel" class="lnk">Annuler</button></menu>
      </form>`;
    if (!dlg.open) dlg.showModal();
    const prog = dlg.querySelector('progress');
    const status = dlg.querySelector('.imp-status');
    try {
      const res = await recognize(blob, m => {
        if (m.status === 'pass') { status.textContent = 'Lecture du texte…'; prog.value = m.progress; }
        else if (/load/.test(m.status)) status.textContent = 'Chargement du moteur OCR (1re fois)…';
      });
      showResult(res, url);
    } catch (e) {
      console.error(e);
      status.textContent = 'Échec de l’analyse : ' + e.message;
      prog.remove();
    }
  }

  function showResult(res, url) {
    const cur = W.getState().levels || {};
    const n = Object.keys(res.levels).length;
    const rows = JOBS.map(j => {
      const v = res.levels[j.key];
      const old = cur[j.key];
      const diff = v !== undefined && v !== old;
      const unsure = res.unsure.includes(j.key);
      return `<tr class="${v === undefined ? 'miss' : ''}">
        <td><img src="${D.jobs.find(x => x.key === j.key).icon}" alt=""> ${esc(j.label)}</td>
        <td class="old">${old ?? '—'}</td>
        <td><input type="number" min="0" max="250" name="${j.key}" value="${v ?? ''}" placeholder="—"
          class="${diff ? 'chg' : ''} ${unsure ? 'unsure' : ''}" ${unsure ? 'title="Lecture incertaine, vérifie"' : ''}>
          ${unsure ? '<span class="warn" title="Lecture incertaine, vérifie">?</span>' : ''}</td>
      </tr>`;
    }).join('');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>Importer mes niveaux</h3>
        <div class="imp-body">
          <img src="${url}" alt="Capture" class="imp-shot">
          <div class="imp-res">
            <p class="imp-status">${n ? `${n} métier${n > 1 ? 's' : ''} détecté${n > 1 ? 's' : ''}. Vérifie et corrige si besoin :`
              : 'Aucun niveau détecté. Saisis-les à la main ou essaie une capture plus nette.'}</p>
            <table><thead><tr><th>Métier</th><th>Actuel</th><th>Importé</th></tr></thead><tbody>${rows}</tbody></table>
            <details><summary>Texte lu</summary><pre>${esc(res.text)}</pre></details>
          </div>
        </div>
        <menu>
          <button value="cancel" class="lnk">Annuler</button>
          <button value="ok" class="gbtn" id="imp-ok">Enregistrer</button>
        </menu>
      </form>`;
    dlg.querySelectorAll('input[type=number]').forEach(i => i.addEventListener('input', () => i.classList.add('chg')));
    dlg.querySelector('#imp-ok').onclick = e => {
      e.preventDefault();
      const levels = {};
      dlg.querySelectorAll('input[type=number]').forEach(i => { if (i.value !== '') levels[i.name] = +i.value; });
      W.setLevels(levels);
      dlg.close();
      URL.revokeObjectURL(url);
    };
  }

  function bindDrop(el) {
    ['dragenter', 'dragover'].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => el.addEventListener(t, () => el.classList.remove('over')));
    el.addEventListener('drop', e => {
      e.preventDefault();
      const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
      if (f) handle(f);
    });
  }

  // Ctrl+V n'importe où sur la page
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    handle(item.getAsFile());
  });
  // glisser-déposer d'une image n'importe où
  document.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.type.startsWith('image/'))) e.preventDefault(); });
  document.addEventListener('drop', e => {
    const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (f) { e.preventDefault(); handle(f); }
  });

  const btn = document.getElementById('import-btn');
  if (btn) btn.onclick = openHelp;
})();
