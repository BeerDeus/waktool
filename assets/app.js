(() => {
  const D = window.WAKFU_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem('waktool.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('waktool.' + k, v); } catch { /* ignore */ } },
  };
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  $('#ver').textContent = D.version ? `v${D.version}` : '';

  // ---------------------------------------------------------------- XP métiers
  // XP pour passer de n à n+1 : 150n + 75 (total pour atteindre t : 75t²) — vérifié en jeu.
  // XP de base d'une récolte : 196, identique quel que soit le niveau de la ressource (vérifié Herboriste/Trappeur).
  // Écart > 10 niveaux : XP réduite (courbe en cosinus), 0 à partir de 20 niveaux d'écart.
  const XP = {
    base: 196,
    confirmed: ['herboriste', 'trappeur'],
    rare: { herboriste: 10, trappeur: 4 }, // multiplicateur observé des ressources rares
    need: n => 150 * n + 75,
    total: t => 75 * t * t,
    mult(diff) {
      if (diff <= 10) return 1;
      if (diff >= 20) return 0;
      return (1 + Math.cos(Math.PI * (diff - 10) / 10)) / 2;
    },
    // durée d'une action : 3 s (6 s mineur/pêcheur) − 0,05 s (0,1 s) par niveau au-dessus, min 1,5 s (3 s)
    duration(job, diff) {
      const slow = job === 'mineur' || job === 'pecheur';
      return slow ? Math.max(3, 6 - 0.1 * diff) : Math.max(1.5, 3 - 0.05 * diff);
    },
  };
  const fmt = n => Math.round(n).toLocaleString('fr-FR');
  const fmtDur = s => {
    if (!isFinite(s)) return '∞';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  };
  const sec = d => (Math.round(d * 10 + 1e-6) / 10).toFixed(1).replace('.', ',');
  const bonusPct = () => Math.max(0, +(store.get('bonus') || 0));

  let cur = location.hash.slice(1) || store.get('job') || D.jobs[0].key;
  if (!D.jobs.some(j => j.key === cur)) cur = D.jobs[0].key;

  const tabs = $('#tabs');
  tabs.innerHTML = D.jobs.map(j => `
    <button class="tab" role="tab" data-k="${j.key}" style="--c:${j.color}">
      <img src="${j.icon}" alt="">${esc(j.label)}
    </button>`).join('');
  tabs.addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) select(b.dataset.k);
  });

  const q = $('#q'), lvl = $('#lvl'), only = $('#only');
  const lvlKey = k => 'lvl.' + (k || cur);
  const listeners = [];
  const changed = () => listeners.forEach(f => f());
  only.checked = store.get('only') === '1';
  q.addEventListener('input', renderList);
  only.addEventListener('input', () => { store.set('only', only.checked ? '1' : '0'); renderList(); changed(); });
  lvl.addEventListener('input', () => { store.set(lvlKey(), lvl.value); renderList(); renderSide(); renderTabs(); changed(); });

  function renderTabs() {
    tabs.querySelectorAll('.tab').forEach(b => {
      const v = store.get(lvlKey(b.dataset.k));
      let s = b.querySelector('.tlvl');
      if (!s) { s = document.createElement('span'); s.className = 'tlvl'; b.append(s); }
      s.textContent = v || '';
      s.hidden = !v;
    });
  }

  // API utilisée par auth.js (sync Firestore)
  window.waktool = {
    getState() {
      const levels = {};
      D.jobs.forEach(j => {
        const v = store.get(lvlKey(j.key));
        if (v !== null && v !== '') levels[j.key] = +v;
      });
      const progress = {};
      D.jobs.forEach(j => {
        const xp = store.get('xp.' + j.key), tg = store.get('target.' + j.key);
        const o = {};
        if (xp !== null && xp !== '') o.xp = +xp;
        if (tg !== null && tg !== '') o.target = +tg;
        if (Object.keys(o).length) progress[j.key] = o;
      });
      return { levels, progress, prefs: { only: only.checked, bonus: bonusPct() } };
    },
    applyState(s) {
      D.jobs.forEach(j => {
        const v = s.levels && s.levels[j.key];
        if (v !== undefined && v !== null) store.set(lvlKey(j.key), String(v));
      });
      if (s.prefs && typeof s.prefs.only === 'boolean') {
        only.checked = s.prefs.only;
        store.set('only', only.checked ? '1' : '0');
      }
      if (s.prefs && typeof s.prefs.bonus === 'number') store.set('bonus', String(s.prefs.bonus));
      Object.entries(s.progress || {}).forEach(([k, o]) => {
        if (o && typeof o.xp === 'number') store.set('xp.' + k, String(o.xp));
        if (o && typeof o.target === 'number') store.set('target.' + k, String(o.target));
      });
      lvl.value = store.get(lvlKey()) || '';
      renderTabs();
      render();
    },
    // modification par l'utilisateur (import) : applique et déclenche la sauvegarde
    setLevels(levels) {
      this.applyState({ levels });
      changed();
    },
    onChange(f) { listeners.push(f); },
  };

  const icon = (it, cls = '') => it.icon
    ? `<img src="${it.icon}" alt="" loading="lazy" class="${cls}" title="${esc(it.name)}">`
    : `<span class="noimg ${cls}"></span>`;

  const recipeHtml = r => r ? `
    <details class="recipe"><summary>Recette ${esc(r.job_label || '')} niv. ${r.level}</summary>
      <div class="ings">${r.ingredients.map(i => `<span class="ing">${icon(i)}${i.qty}× ${esc(i.name)}</span>`).join('')}</div>
    </details>` : '';

  function job() { return D.jobs.find(j => j.key === cur); }

  function select(k) {
    cur = k;
    store.set('job', k);
    history.replaceState(null, '', '#' + k);
    lvl.value = store.get(lvlKey()) || '';
    render();
  }

  function render() {
    const j = job();
    document.documentElement.style.setProperty('--c', j.color);
    tabs.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.k === cur));
    const max = Math.max(...j.resources.map(r => r.level));
    $('#job-head').innerHTML = `
      <img src="${j.icon}" alt="">
      <div><h2>${esc(j.label)}</h2>
      <p>${j.resources.length} ${j.key === 'trappeur' ? 'familles de monstres' : 'ressources'} · niv. 0 → ${max}</p></div>`;
    renderList();
    renderSide();
  }

  function renderList() {
    const j = job();
    const term = norm(q.value.trim());
    const my = lvl.value === '' ? null : +lvl.value;
    const rows = j.resources.filter(r => {
      if (only.checked && my !== null && r.level > my) return false;
      if (!term) return true;
      const hay = [r.name, ...(r.zones || []), ...(r.zones_en || []), ...[...(r.normal || []), ...(r.rare || []), ...(r.seed || [])].map(i => i.name)].join(' ');
      return norm(hay).includes(term);
    });
    const list = $('#list');
    if (!rows.length) { list.innerHTML = '<p class="empty">Aucune ressource.</p>'; return; }
    const tpl = $('#tpl-res');
    list.replaceChildren(...rows.map(r => {
      const n = tpl.content.firstElementChild.cloneNode(true);
      if (my !== null && r.level > my) n.classList.add('locked');
      $('.res-lvl', n).innerHTML = `<small>niv.</small>${r.level}`;
      const app = r.appearance || (r.normal && r.normal[0] && r.normal[0].icon) || (r.seed && r.seed[0] && r.seed[0].icon);
      $('.res-app', n).innerHTML = app ? `<img src="${app}" alt="${esc(r.name)}" loading="lazy">` : '';
      $('h3', n).innerHTML = esc(r.name) + (r.family_en && r.family_en !== r.name ? ` <span class="en-name">${esc(r.family_en)}</span>` : '');
      $('.zones', n).innerHTML = (r.zones || []).map(z => `<li>${esc(z)}</li>`).join('') +
        (r.zones_en || []).map(z => `<li class="en" title="Nom anglais (wiki), zone récente">${esc(z)} (EN)</li>`).join('') +
        (r.hint ? `<li class="en">${esc(r.hint)}</li>` : '');
      const drop = (arr, cls, lbl) => (arr || []).map(i => `<span class="drop ${cls}" title="${lbl}">${icon(i)}${esc(i.name)}</span>`).join('');
      $('.drops', n).innerHTML = drop(r.normal, '', 'Ressource') + drop(r.rare, 'rare', 'Ressource rare') +
        drop(r.seed, 'seed', j.key === 'forestier' ? 'Bouture' : 'Graine');
      if (my !== null && r.level <= my) {
        const m = XP.mult(my - r.level);
        const per = Math.round(XP.base * m * (1 + bonusPct() / 100));
        const cls = m === 1 ? 'full' : m > 0 ? 'part' : 'none';
        const nb = per ? Math.ceil(Math.max(1, XP.need(my) - curXp()) / per) : null;
        const x = document.createElement('div');
        x.className = 'xpline ' + cls;
        x.innerHTML = m === 0 ? 'Plus d’XP (20 niveaux d’écart ou plus)'
          : `<b>${fmt(per)} XP</b> / action${m < 1 ? ` (${Math.round(m * 100)} %)` : ''} · ${sec(XP.duration(j.key, my - r.level))} s` +
            ` · <span title="Actions pour atteindre le niveau ${my + 1}">${fmt(nb)} actions → niv. ${my + 1}</span>`;
        $('.res-body', n).append(x);
      }
      return n;
    }));
  }

  const curXp = () => Math.max(0, +(store.get('xp.' + cur) || 0));

  // meilleure ressource (XP max, puis action la plus rapide) disponible au niveau L
  function bestAt(j, L) {
    const ok = j.resources.filter(r => r.level <= L);
    if (!ok.length) return null;
    return ok.reduce((b, r) => {
      const m = XP.mult(L - r.level), d = XP.duration(j.key, L - r.level);
      const rate = m / d;
      return !b || rate > b.rate ? { r, m, d, rate } : b;
    }, null);
  }

  // simule la montée de `from` (+xp déjà acquise) à `to` en récoltant toujours la meilleure ressource
  function simulate(j, from, xp0, to) {
    let actions = 0, time = 0, xpTotal = 0;
    const k = 1 + bonusPct() / 100;
    for (let L = from; L < to; L++) {
      const need = XP.need(L) - (L === from ? xp0 : 0);
      const b = bestAt(j, L);
      if (!b || !b.m) return { actions: Infinity, time: Infinity, xp: XP.total(to) - XP.total(from) - xp0 };
      const n = Math.ceil(Math.max(0, need) / Math.round(XP.base * b.m * k));
      actions += n; time += n * b.d; xpTotal += Math.max(0, need);
    }
    return { actions, time, xp: xpTotal };
  }

  function progHtml(j, my) {
    if (my === null) return '<p class="meta">Renseigne « Mon niveau » pour voir ta progression.</p>';
    const need = XP.need(my);
    const xp = Math.min(curXp(), need - 1);
    const tg = +(store.get('target.' + j.key) || 0) || Math.min(200, (Math.floor(my / 10) + 1) * 10);
    const next = simulate(j, my, xp, my + 1);
    const goal = tg > my ? simulate(j, my, xp, tg) : null;
    const b = bestAt(j, my);
    const rare = XP.rare[j.key];
    const sure = XP.confirmed.includes(j.key);
    return `
      <div class="pbar"><span style="width:${(xp / need * 100).toFixed(1)}%"></span><em>${fmt(xp)} / ${fmt(need)} XP</em></div>
      <dl class="pstats">
        <dt>Niveau ${my + 1}</dt><dd><b>${fmt(need - xp)} XP</b> · ${fmt(next.actions)} actions · ~${fmtDur(next.time)}</dd>
        ${goal ? `<dt>Niveau ${tg}</dt><dd><b>${fmt(goal.xp)} XP</b> · ${fmt(goal.actions)} actions · ~${fmtDur(goal.time)}</dd>` : ''}
        ${b ? `<dt>Conseillé</dt><dd>${esc(b.r.name)} (niv. ${b.r.level}) · ${fmt(XP.base * b.m * (1 + bonusPct() / 100))} XP en ${sec(b.d)} s</dd>` : ''}
      </dl>
      <p class="meta">Base ${XP.base} XP par action (récolte, graine, bouture)${rare ? `, rare ≈ ×${rare}` : ''}.
        Pleine XP sur les ressources jusqu’à 10 niveaux sous le tien, baisse progressive ensuite, rien à partir de 20.
        ${sure ? '' : '<br><b>Valeur de base vérifiée en Herboriste/Trappeur, supposée identique ici.</b>'}
        Plantation non comptée.</p>`;
  }

  function bindProg(j, my) {
    const box = $('#prog');
    const out = $('#prog-out');
    const upd = () => { out.innerHTML = progHtml(j, my); renderList(); changed(); };
    box.querySelector('#p-xp').addEventListener('input', e => { store.set('xp.' + j.key, e.target.value); upd(); });
    box.querySelector('#p-tg').addEventListener('input', e => { store.set('target.' + j.key, e.target.value); upd(); });
    box.querySelector('#p-bonus').addEventListener('input', e => { store.set('bonus', e.target.value); upd(); });
  }

  function renderSide() {
    const j = job();
    const my = lvl.value === '' ? null : +lvl.value;
    const usable = j.tools.filter(t => my !== null && t.level <= my).pop();
    const next = j.tools.find(t => my !== null && t.level > my);
    const tools = j.tools.map(t => `
      <div class="it ${next === t ? 'next' : ''}">${icon(t)}
        <div><b>${esc(t.name)} <span class="badge ${usable === t ? 'cur' : ''}">niv. ${t.level}</span></b>
        <span class="bonus">+${t.bonus} % quantité récoltée</span>
        ${recipeHtml(t.recipe)}</div>
      </div>`).join('');
    const p = j.pet;
    const c = j.consumable;
    const extras = j.extras.map(e => `
      <div class="it">${icon(e)}
        <div><b>${esc(e.name)}${e.level ? ` <span class="badge">niv. ${e.level}</span>` : ''}</b>
        <span class="bonus">${esc(e.bonus)}</span><div class="meta">${esc(e.how)}</div>${recipeHtml(e.recipe)}</div>
      </div>`).join('');
    const common = D.common.map(e => `
      <div class="it">${icon(e)}
        <div><b>${esc(e.name)}</b><span class="bonus">${esc(e.bonus)}</span>
        <div class="meta">${esc(e.kind)} · ${esc(e.how)}</div></div>
      </div>`).join('');
    $('#side').innerHTML = `
      <div class="box" id="prog"><h4>Progression ${esc(j.label)}</h4>
        <div class="pin">
          <label>XP actuelle<input id="p-xp" type="number" min="0" value="${esc(store.get('xp.' + j.key) || '')}" placeholder="0"></label>
          <label>Objectif niv.<input id="p-tg" type="number" min="1" max="250" value="${esc(store.get('target.' + j.key) || '')}" placeholder="auto"></label>
          <label title="Bonus d'XP de récolte (région/volontés MdC, Havre-Monde, Sources…)">Bonus XP %<input id="p-bonus" type="number" min="0" max="500" value="${esc(store.get('bonus') || '')}" placeholder="0"></label>
        </div>
        <div id="prog-out">${progHtml(j, my)}</div>
      </div>
      <div class="box"><h4>Outils ${esc(j.label)}</h4>${tools}
        <p class="meta" style="margin:10px 0 0">Le niveau indiqué est celui de la recette (craft par le ${esc(j.label)}).</p></div>
      <div class="box"><h4>Familier</h4>
        <div class="it">${icon(p)}<div><b>${esc(p.name)}</b>
          <span class="bonus">+${p.bonus_min} % → +${p.bonus_max} % quantité récoltée</span>
          <div class="meta">Niv. 1 → 50 · obtenu dans les ${esc(p.how)}</div></div></div></div>
      <div class="box"><h4>Consommable</h4>
        <div class="it">${icon(c)}<div><b>${esc(c.name)} <span class="badge">niv. ${c.level}</span></b>
          <span class="bonus">${esc(c.bonus)} · ${esc(c.duration)}</span>
          <div class="meta">${esc(c.how)}</div>${recipeHtml(c.recipe)}</div></div></div>
      ${extras ? `<div class="box"><h4>Équipement bonus</h4>${extras}</div>` : ''}
      <div class="box"><h4>Bonus tous métiers</h4>${common}</div>`;
    bindProg(j, my);
  }

  window.addEventListener('hashchange', () => {
    const k = location.hash.slice(1);
    if (k && k !== cur && D.jobs.some(j => j.key === k)) select(k);
  });
  renderTabs();
  select(cur);
})();
