// Import des niveaux de métiers depuis une capture de la fenêtre Métiers (J).
// Ctrl+V d'une image, glisser-déposer ou sélection de fichier ; OCR local (Tesseract.js, self-hosted).
(() => {
  const W = window.waktool;
  const D = window.WAKFU_DATA;
  const BASE = (window.WAKTOOL_TESS_BASE || 'vendor/tesseract/');
  const ALLJ = W.jobs();
  const JOBS = ALLJ.map(j => ({ key: j.key, label: j.label, icon: j.icon, n: norm(j.label).replace(/[^a-z]/g, '') }));

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
      // métier : un mot (ou deux mots accolés, ex. « Maître d'Armes ») proche d'un nom de métier
      let best = null;
      const ws = t.split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
      const cands = [...ws, ...ws.slice(1).map((w, i) => ws[i] + w), ...ws.slice(2).map((w, i) => ws[i] + ws[i + 1] + w)];
      for (const w of cands.filter(w => w.length >= 4)) {
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
    const passes = [], wordsPasses = [];
    let text = '';
    for (const [i, pass] of PASSES.entries()) {
      const { data } = await w.recognize(await preprocess(bmp, pass));
      let lines = (data.lines || []).map(l => l.text.trim()).filter(Boolean);
      // mots avec position (x en px de l'image prétraitée) pour lire les colonnes (HDV)
      wordsPasses.push((data.lines || []).map(l => (l.words || []).map(wd => ({ t: wd.text, x0: wd.bbox.x0, x1: wd.bbox.x1, y0: wd.bbox.y0, y1: wd.bbox.y1 }))));
      if (!lines.length) lines = data.text.split('\n');
      if (!text) text = lines.join('\n');
      passes.push(lines);
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
    const scale = Math.max(1, Math.min(4, 1400 / Math.max(bmp.width, bmp.height)));
    return { levels, unsure, text, passes, wordsPasses, bmp, scale };
  }

  // ---------------------------------------------------------------- prix HDV
  // Lecture par colonnes : le prix est le nombre sous l'en-tête « Prix » (sinon le nombre le plus à droite),
  // chaque case de prix est relue agrandie en chiffres seuls, puis vote entre toutes les lectures.
  const clean = s => norm(s).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const isNum = t => /^\d[\d .,]*[^\w]?$/.test(t.trim()); // « 735 », « 7792 », « 165* » ; pas « E3 »
  const digits = t => t.replace(/\D/g, '');

  async function readCell(bmp, sc, box, thr) {
    const pad = 5 * sc, padR = 1.5 * sc; // peu de marge à droite : le symbole ₭ suit le nombre
    const sx = Math.max(0, (box.x0 - pad) / sc), sy = Math.max(0, (box.y0 - pad) / sc);
    const sw = Math.min(bmp.width - sx, (box.x1 - box.x0 + pad + padR) / sc), sh = Math.min(bmp.height - sy, (box.y1 - box.y0 + 2 * pad) / sc);
    const k = 70 / sh;
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = x.getImageData(0, 0, c.width, c.height), p = img.data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) sum += p[i] + p[i + 1] + p[i + 2];
    const dark = sum / (p.length / 4) / 3 < 128;
    for (let i = 0; i < p.length; i += 4) {
      let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      if (dark) g = 255 - g;
      if (thr) g = g < thr ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = g;
    }
    x.putImageData(img, 0, 0);
    const w = await getWorker();
    await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
    try {
      const { data } = await w.recognize(c);
      return digits(data.text);
    } finally {
      await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
    }
  }

  function matchItem(items, text) {
    if (text.length < 3) return null;
    let best = null;
    for (const it of items) if (text.includes(it.n) && (!best || it.n.length > best.n.length)) best = it;
    if (best) return best;
    let bd = Infinity;
    for (const it of items) {
      if (Math.abs(it.n.length - text.length) > 3) continue;
      const d = lev(text, it.n);
      if (d <= Math.max(1, Math.floor(it.n.length / 6)) && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  async function parsePrices(res, onStep) {
    const items = (await W.allItems()).map(it => ({ ...it, n: clean(it.name) })).filter(it => it.n.length >= 3);
    // colonne « Prix » (centre x), tolérance = 12 % de la largeur de l'image prétraitée
    let px = null;
    res.wordsPasses.forEach(ps => ps.forEach(l => l.forEach(w => { if (clean(w.t) === 'prix') px = (w.x0 + w.x1) / 2; })));
    const tol = 0.12 * res.bmp.width * res.scale;
    const found = new Map(); // id -> { it, reads: [], box }
    for (const ps of res.wordsPasses) {
      let pending = null;
      for (const l of ps) {
        // nombres, en recollant « 15 » + « 600 » quand l'écart est petit (séparateur de milliers)
        const nums = [];
        for (const w of l) {
          if (!isNum(w.t) || !digits(w.t)) continue;
          const prev = nums[nums.length - 1];
          if (prev && digits(w.t).length === 3 && w.x0 - prev.x1 < 0.8 * (w.y1 - w.y0) && l.indexOf(w) === l.indexOf(prev.last) + 1) {
            nums[nums.length - 1] = { ...prev, t: digits(prev.t) + digits(w.t), x1: w.x1, last: w };
          } else nums.push({ ...w, last: w });
        }
        const text = clean(l.filter(w => !isNum(w.t)).map(w => w.t).join(' '));
        let pw = null;
        if (nums.length) {
          pw = px === null ? nums[nums.length - 1]
            : nums.reduce((a, b) => (Math.abs((b.x0 + b.x1) / 2 - px) < Math.abs((a.x0 + a.x1) / 2 - px) ? b : a));
          if (px !== null && Math.abs((pw.x0 + pw.x1) / 2 - px) > tol) pw = null;
        }
        const it = matchItem(items, text) || (pw ? pending : null);
        if (!it) continue;
        if (!pw) { pending = it; continue; }
        pending = null;
        if (!found.has(it.id)) found.set(it.id, { it, reads: [], box: null });
        const f = found.get(it.id);
        f.reads.push(+digits(pw.t));
        // case à relire : partie chiffres du mot (sans le symbole ₭ éventuel)
        const frac = digits(pw.t).length / pw.t.replace(/\s/g, '').length;
        f.box ||= { x0: pw.x0, x1: pw.x0 + (pw.x1 - pw.x0) * frac, y0: pw.y0, y1: pw.y1, n: digits(pw.t).length };
      }
    }
    // case trop large (symbole ₭ collé au nombre) : largeur ramenée à nb de chiffres × largeur médiane d'un chiffre
    const dws = [...found.values()].map(f => (f.box.x1 - f.box.x0) / f.box.n).sort((a, b) => a - b);
    const dw = dws[Math.floor(dws.length / 2)];
    found.forEach(f => { if (f.box.x1 - f.box.x0 > f.box.n * dw * 1.3) f.box.x1 = f.box.x0 + f.box.n * dw * 1.12; });
    let i = 0;
    for (const f of found.values()) {
      onStep && onStep(++i / found.size);
      for (const thr of [0, 140]) {
        const v = await readCell(res.bmp, res.scale, f.box, thr);
        if (v) f.reads.push(+v, +v); // relecture ciblée : poids double
      }
    }
    if (window.WAKTOOL_DEBUG) console.log([...found.values()].map(f => f.it.name + ': ' + f.reads.join(',')).join('\n'));
    return [...found.values()].map(({ it, reads }) => {
      const c = reads.filter(n => n > 0).reduce((m, p) => m.set(p, (m.get(p) || 0) + 1), new Map());
      const sorted = [...c.entries()].sort((a, b) => b[1] - a[1]);
      if (!sorted.length) return null;
      return { it, price: sorted[0][0], unsure: sorted.length > 1 && sorted[1][1] >= sorted[0][1] / 2 };
    }).filter(Boolean);
  }

  async function showPrices(res, url) {
    const status = dlg.querySelector('.imp-status');
    const found = await parsePrices(res, p => { if (status) status.textContent = `Lecture des prix… ${Math.round(p * 100)} %`; });
    const rows = found.map(f => {
      const old = W.price(f.it.id);
      return `<tr><td><label><input type="checkbox" data-pid="${f.it.id}" checked></label></td>
        <td>${f.it.icon ? `<img src="${f.it.icon}" alt="">` : ''} ${esc(f.it.name)}</td>
        <td class="old">${old ? old.toLocaleString('fr-FR') : '—'}</td>
        <td><input type="number" min="0" data-pval="${f.it.id}" value="${f.price}" class="chg ${f.unsure ? 'unsure' : ''}">
          ${f.unsure ? '<span class="warn" title="Lecture incertaine, vérifie">?</span>' : ''}</td></tr>`;
    }).join('');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>Importer des prix HDV</h3>
        <div class="imp-body">
          <img src="${url}" alt="Capture" class="imp-shot">
          <div class="imp-res">
            <p class="imp-status">${found.length ? `${found.length} objet${found.length > 1 ? 's' : ''} reconnu${found.length > 1 ? 's' : ''}. Vérifie les prix (kamas par unité) :`
              : 'Aucun objet reconnu. Essaie une capture plus nette de la liste de l’HDV (nom + prix visibles).'}</p>
            ${found.length ? `<table><thead><tr><th></th><th>Objet</th><th>Actuel</th><th>Prix ₭</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
            <details><summary>Texte lu</summary><pre>${esc(res.text)}</pre></details>
          </div>
        </div>
        <menu>
          <button value="cancel" class="lnk">Annuler</button>
          ${found.length ? '<button value="ok" class="gbtn" id="imp-ok">Enregistrer</button>' : ''}
        </menu>
      </form>`;
    const ok = dlg.querySelector('#imp-ok');
    if (ok) ok.onclick = e => {
      e.preventDefault();
      const map = {};
      dlg.querySelectorAll('[data-pid]').forEach(c => { if (c.checked) map[c.dataset.pid] = dlg.querySelector(`[data-pval="${c.dataset.pid}"]`).value; });
      W.setPrices(map);
      dlg.close();
      URL.revokeObjectURL(url);
    };
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
        <h3>Importer une capture</h3>
        <p>Fais une capture (<kbd>Win</kbd>+<kbd>Maj</kbd>+<kbd>S</kbd>) puis <b>colle-la ici avec <kbd>Ctrl</kbd>+<kbd>V</kbd></b> :</p>
        <ul class="meta"><li><b>fenêtre Métiers</b> (touche <kbd>J</kbd>) → tes niveaux ;</li>
          <li><b>Hôtel des ventes</b> (liste avec noms et prix) → les prix, gardés en mémoire.</li></ul>
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
      if (Object.keys(res.levels).length >= 2) showResult(res, url);
      else { status.textContent = 'Recherche des objets et des prix…'; await showPrices(res, url); }
    } catch (e) {
      console.error(e);
      status.textContent = 'Échec de l’analyse : ' + e.message;
      prog.remove();
    }
  }

  function showResult(res, url) {
    const cur = W.getState().levels || {};
    const n = Object.keys(res.levels).length;
    // métiers d'artisanat : affichés seulement s'ils sont lus sur la capture
    const rows = JOBS.filter(j => ALLJ.find(x => x.key === j.key).type === 'harvest' || res.levels[j.key] !== undefined).map(j => {
      const v = res.levels[j.key];
      const old = cur[j.key];
      const diff = v !== undefined && v !== old;
      const unsure = res.unsure.includes(j.key);
      return `<tr class="${v === undefined ? 'miss' : ''}">
        <td><img src="${j.icon}" alt=""> ${esc(j.label)}</td>
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
