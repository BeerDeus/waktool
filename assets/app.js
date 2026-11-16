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
  // XP pour passer de n à n+1 : 150n + 75 (total pour atteindre t : 75t²).
  // XP de base d'une action : 150 (rare : ×10 Herboriste, ×4 Trappeur), quel que soit le niveau de la ressource.
  // Écart > 10 niveaux : courbe en cosinus arrondie à 2,5 % (97,5 / 90 / 80 / 65 / 50 / 35 / 20 / 10 / 2,5), 0 dès 20.
  // XP affichée = ⌈⌊base × baisse⌋ × (1 + bonus)⌉, bonus en float32 — vérifié sur 7 valeurs en jeu (bonus 30 %).
  const XP = {
    base: 150,
    confirmed: ['herboriste', 'trappeur'],
    rare: { herboriste: 10, trappeur: 4 },
    need: n => 150 * n + 75,
    total: t => 75 * t * t,
    mult(diff) {
      if (diff <= 10) return 1;
      if (diff >= 20) return 0;
      return Math.round((1 + Math.cos(Math.PI * (diff - 10) / 10)) / 2 * 40) / 40;
    },
    per(diff, bonus, base = 150) {
      return Math.ceil(Math.floor(base * this.mult(diff)) * (1 + Math.fround(bonus / 100)));
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

  // ---------------------------------------------------------------- bonus actifs
  const sj = {
    get(k, d) { try { return { ...d, ...(JSON.parse(store.get(k)) || {}) }; } catch { return { ...d }; } },
    set(k, v) { store.set(k, JSON.stringify(v)); },
  };
  const G_DEF = { region: null, temp: null, climMalus: 50, havre: false, stasis: 0, turbo: false, xpExtra: 0, speed: 0,
    sceau: false, potion: false, pacte: 0, mdc: 0, captchat: 0, qtyExtra: 0 };
  const J_DEF = { tool: 'auto', pet: '', petLvl: 50, conso: false, casque: false, sacs: 0, gateau: false };
  const REGION = [
    { v: -10, stars: 0, img: 'img/ui/region-0.png', label: 'Aucune volonté respectée' },
    { v: 10, stars: 1, img: 'img/ui/region-1.png', label: 'Volontés partiellement respectées' },
    { v: 30, stars: 2, img: 'img/ui/region-2.png', label: 'Toutes les volontés respectées' },
  ];
  const bg = () => sj.get('bonus.global', G_DEF);
  const bjob = k => sj.get('bonus.' + (k || cur), J_DEF);
  const myLevel = () => (lvl.value === '' ? null : +lvl.value);

  function bonusXp() {
    const g = bg();
    return (g.region ?? 0) + (g.havre ? 10 : 0) + (+g.stasis || 0) + (g.turbo ? 100 : 0) + (+g.xpExtra || 0);
  }
  const bonusPct = bonusXp;
  const speedMult = () => 1 + (+bg().speed || 0) / 100;
  // météo : hors de la plage de température idéale de la plante, les actions sont ralenties
  // (Paysan / Forestier / Herboriste uniquement ; ampleur du ralentissement réglable, non publiée)
  function climate(r) {
    const t = bg().temp;
    if (!r || !r.temp || t === null || t === '' || isNaN(+t)) return null;
    return +t < r.temp[0] ? 'cold' : +t > r.temp[1] ? 'hot' : 'ok';
  }
  const climK = r => (['hot', 'cold'].includes(climate(r)) ? 1 + (+bg().climMalus || 0) / 100 : 1);
  const dur = (job, diff, r) => XP.duration(job, diff) * climK(r) / speedMult();

  function activeTool(j, b, my) {
    if (b.tool === 'none') return null;
    if (b.tool === 'auto') return my === null ? null : j.tools.filter(t => t.level <= my).pop() || null;
    return j.tools.find(t => t.name === b.tool) || null;
  }

  // détail des bonus de quantité (en %)
  function qtyParts(j) {
    const g = bg(), b = bjob(j.key), my = myLevel(), parts = [];
    const t = activeTool(j, b, my);
    if (t) parts.push([t.name, t.bonus]);
    const pl = Math.max(1, Math.min(50, +b.petLvl || 1));
    if (b.pet === 'job') parts.push([`${j.pet.name} niv. ${pl}`, +(10 + 0.8 * pl).toFixed(1)]);
    if (b.pet === 'noxine') parts.push([`Noxine niv. ${pl}`, +(5 + 0.4 * pl).toFixed(1)]);
    if (b.conso) parts.push([j.consumable.name, 15]);
    if (b.casque && j.key === 'mineur') parts.push(['Casque de la Mine', 25]);
    if (b.sacs && (j.key === 'mineur' || j.key === 'trappeur')) parts.push([`${j.key === 'mineur' ? 'Sac du Greuvard' : 'Sac à Pipi'} ×${b.sacs}`, 10 * b.sacs]);
    if (b.gateau && j.key === 'paysan') parts.push(['Gâteau de riz', 15]);
    if (g.sceau) parts.push(['Sceau des Compagnons', 50]);
    if (g.potion) parts.push(['Potion de récolte', 50]);
    if (+g.pacte) parts.push([+g.pacte === 25 ? 'Pacte prudent' : 'Pacte opportuniste', +g.pacte]);
    if (+g.qtyExtra) parts.push(['Autre', +g.qtyExtra]);
    if (+g.captchat) parts.push([`Malédiction Capt'chat ×${g.captchat}`, -33 * g.captchat]);
    return parts;
  }
  // quantité par récolte : jet de base 1–3 (1–4 si ressources en surplus vs volontés), × (1 + bonus)
  function qtyStats(j) {
    const pct = qtyParts(j).reduce((a, p) => a + p[1], 0);
    const k = Math.max(0, 1 + pct / 100);
    const maxRoll = +bg().mdc === 33 ? 4 : 3;
    return { pct, min: Math.floor(k), max: Math.ceil(maxRoll * k), avg: (1 + maxRoll) / 2 * k };
  }

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
      D.jobs.forEach(j => {
        const raw = store.get('bonus.' + j.key);
        if (raw) (progress[j.key] ||= {}).bonus = bjob(j.key);
      });
      return { levels, progress, prefs: { only: only.checked, bonuses: bg() } };
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
      if (s.prefs && s.prefs.bonuses && typeof s.prefs.bonuses === 'object') sj.set('bonus.global', { ...G_DEF, ...s.prefs.bonuses });
      else if (s.prefs && s.prefs.bonus === 30 && !store.get('bonus.global')) sj.set('bonus.global', { ...G_DEF, region: 30 });
      Object.entries(s.progress || {}).forEach(([k, o]) => {
        if (o && typeof o.xp === 'number') store.set('xp.' + k, String(o.xp));
        if (o && typeof o.target === 'number') store.set('target.' + k, String(o.target));
        if (o && o.bonus && typeof o.bonus === 'object') sj.set('bonus.' + k, { ...J_DEF, ...o.bonus });
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
      const cl = climate(r);
      if (r.temp) {
        const lbl = { ok: 'température idéale', hot: 'trop chaud : actions ralenties', cold: 'trop froid : actions ralenties' }[cl] || 'plage de température idéale';
        $('h3', n).insertAdjacentHTML('beforeend', ` <span class="temp ${cl || ''}" title="${lbl}">${cl === 'hot' ? '▲' : cl === 'cold' ? '▼' : '●'} ${r.temp[0]} à ${r.temp[1]} °C</span>`);
      }
      $('.zones', n).innerHTML = (r.zones || []).map(z => `<li>${esc(z)}</li>`).join('') +
        (r.zones_en || []).map(z => `<li class="en" title="Nom anglais (wiki), zone récente">${esc(z)} (EN)</li>`).join('') +
        (r.hint ? `<li class="en">${esc(r.hint)}</li>` : '');
      const drop = (arr, cls, lbl) => (arr || []).map(i => `<span class="drop ${cls}" title="${lbl}">${icon(i)}${esc(i.name)}</span>`).join('');
      $('.drops', n).innerHTML = drop(r.normal, '', 'Ressource') + drop(r.rare, 'rare', 'Ressource rare') +
        drop(r.seed, 'seed', j.key === 'forestier' ? 'Bouture' : 'Graine');
      if (my !== null && r.level <= my) {
        const m = XP.mult(my - r.level);
        const per = XP.per(my - r.level, bonusPct());
        const cls = m === 1 ? 'full' : m > 0 ? 'part' : 'none';
        const nb = per ? Math.ceil(Math.max(1, XP.need(my) - curXp()) / per) : null;
        const x = document.createElement('div');
        x.className = 'xpline ' + cls;
        x.innerHTML = m === 0 ? 'Plus d’XP (20 niveaux d’écart ou plus)'
          : `<b>${fmt(per)} XP</b> / action${m < 1 ? ` (${(m * 100).toLocaleString('fr-FR')} %)` : ''} · ${sec(dur(j.key, my - r.level, r))} s` +
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
      const m = XP.mult(L - r.level), d = dur(j.key, L - r.level, r);
      const rate = m / d;
      return !b || rate > b.rate ? { r, m, d, rate } : b;
    }, null);
  }

  // simule la montée de `from` (+xp déjà acquise) à `to` en récoltant toujours la meilleure ressource
  function simulate(j, from, xp0, to) {
    let actions = 0, time = 0, xpTotal = 0;
    for (let L = from; L < to; L++) {
      const need = XP.need(L) - (L === from ? xp0 : 0);
      const b = bestAt(j, L);
      if (!b || !b.m) return { actions: Infinity, time: Infinity, xp: XP.total(to) - XP.total(from) - xp0 };
      const n = Math.ceil(Math.max(0, need) / XP.per(L - b.r.level, bonusPct()));
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
        ${b ? `<dt>Conseillé</dt><dd>${esc(b.r.name)} (niv. ${b.r.level}) · ${fmt(XP.per(my - b.r.level, bonusPct()))} XP en ${sec(b.d)} s</dd>` : ''}
      </dl>
      <p class="meta">Base ${XP.base} XP par action (récolte, graine, bouture)${rare ? `, rare ×${rare}` : ''}, ${bonusXp() >= 0 ? '+' : ''}${bonusXp()} % de bonus actifs.
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
  }

  function bonusHtml(j) {
    const g = bg(), b = bjob(j.key), my = myLevel();
    const q = qtyStats(j), parts = qtyParts(j);
    const chk = (id, on, label, extra = '') => `<label class="bchk"><input type="checkbox" data-b="${id}" ${on ? 'checked' : ''}> ${label}${extra}</label>`;
    const sel = (id, val, opts) => `<select data-b="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const auto = activeTool(j, { ...b, tool: 'auto' }, my);
    const xpb = bonusXp();
    const best = my === null ? null : bestAt(j, my);
    const perH = best ? 3600 / best.d : 0;
    return `
      <div class="bsum">
        <div><span>XP</span><b class="${xpb < 0 ? 'neg' : ''}">${xpb >= 0 ? '+' : ''}${xpb} %</b></div>
        <div><span>Quantité</span><b class="${q.pct < 0 ? 'neg' : ''}">${q.pct >= 0 ? '+' : ''}${+q.pct.toFixed(1)} %</b></div>
        <div><span>Par récolte</span><b>${q.min}–${q.max}</b><small>moy. ${q.avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</small></div>
        ${best ? `<div title="${esc(best.r.name)}, ${sec(best.d)} s par action"><span>Par heure*</span><b>${fmt(perH * q.avg)}</b><small>${fmt(perH * XP.per(my - best.r.level, xpb))} XP</small></div>` : ''}
      </div>
      <div class="bgrp"><h5>Bonus de région <small>(volontés du Maître de clan)</small></h5>
        <div class="region">${REGION.map(r => `
          <button type="button" data-region="${r.v}" class="${g.region === r.v ? 'on' : ''}" title="${r.label}">
            <img src="${r.img}" alt=""><span>${'★'.repeat(r.stars)}${'☆'.repeat(2 - r.stars)}</span><b>${r.v > 0 ? '+' : ''}${r.v} %</b>
          </button>`).join('')}
        </div>
      </div>
      <div class="bgrp"><h5>Météo <small>(température de la zone, touche X en jeu)</small></h5>
        ${j.resources.some(r => r.temp) ? `
        <label class="bchk">Température <input type="number" data-b="g:temp" value="${g.temp ?? ''}" placeholder="—" min="-40" max="60"> °C
          ${g.temp !== null && g.temp !== '' ? climCount(j, my) : ''}</label>
        <label class="bchk">Ralentissement hors plage <input type="number" data-b="g:climMalus" value="${+g.climMalus || 0}" min="0" max="300"> %
          <em class="warn-txt" title="Valeur non publiée par Ankama : à ajuster selon tes mesures en jeu">estimation</em></label>`
        : '<p class="meta">La météo n’a pas d’effet sur ce métier.</p>'}
      </div>
      <details class="bmore" ${store.get('ui.bmore') === '0' ? '' : 'open'}><summary>Équipement, consommables et autres bonus</summary>
      <div class="bgrp"><h5>Autres bonus d’XP</h5>
        ${chk('havre', g.havre, 'Havre-Monde', ' <em>+10 %</em>')}
        <label class="bchk">Source de Stasis ${sel('stasis', g.stasis, [[0, 'non'], [10, '+10 %'], [20, '+20 %']])}</label>
        ${chk('turbo', g.turbo, 'Turbo Craft 30', ' <em>+100 %</em>')}
        <label class="bchk">Autre ${'<input type="number" data-b="xpExtra" value="' + (+g.xpExtra || '') + '" placeholder="0"> %'}</label>
      </div>
      <div class="bgrp"><h5>Quantité récoltée</h5>
        <label class="bchk">Outil ${sel('tool', b.tool, [['auto', `Auto (${auto ? auto.name + ' +' + auto.bonus + ' %' : 'aucun'})`], ['none', 'Aucun'], ...j.tools.map(t => [t.name, `${t.name} +${t.bonus} % (niv. ${t.level})`])])}</label>
        <label class="bchk">Familier ${sel('pet', b.pet, [['', 'Aucun'], ['job', `${j.pet.name} (+10→50 %)`], ['noxine', 'Noxine (+5→25 %)']])}
          ${b.pet ? `niv. <input type="number" data-b="petLvl" min="1" max="50" value="${+b.petLvl || 50}">` : ''}</label>
        ${chk('conso', b.conso, j.consumable.name, ' <em>+15 %</em>')}
        ${j.key === 'mineur' ? chk('casque', b.casque, 'Casque de la Mine', ' <em>+25 %</em>') : ''}
        ${j.key === 'mineur' || j.key === 'trappeur' ? `<label class="bchk">${j.key === 'mineur' ? 'Sac du Greuvard' : 'Sac à Pipi'} ${sel('sacs', b.sacs, [[0, '0'], [1, '×1'], [2, '×2'], [3, '×3']])} <em>+10 % chacun</em></label>` : ''}
        ${j.key === 'paysan' ? chk('gateau', b.gateau, 'Gâteau de riz', ' <em>+15 %</em>') : ''}
        ${chk('g:sceau', g.sceau, 'Sceau des Compagnons', ' <em>+50 %</em>')}
        ${chk('g:potion', g.potion, 'Potion de récolte', ' <em>+50 %</em>')}
        <label class="bchk">Pacte ${sel('g:pacte', g.pacte, [[0, 'aucun'], [25, 'prudent +25 %'], [50, 'opportuniste +50 %']])}</label>
        <label class="bchk">Volontés ${sel('g:mdc', g.mdc, [[0, 'quantité normale'], [33, 'ressource en surplus (jet 1–4)'], [66, 'ressource en manque (+66 % graines)']])}</label>
        <label class="bchk">Capt’chat perdus ${sel('g:captchat', g.captchat, [0, 1, 2, 3, 4, 5, 6].map(n => [n, n ? `${n} (−${33 * n} %)` : '0']))}</label>
        <label class="bchk">Autre ${'<input type="number" data-b="g:qtyExtra" value="' + (+g.qtyExtra || '') + '" placeholder="0"> %'}</label>
      </div>
      <div class="bgrp"><h5>Vitesse</h5>
        <label class="bchk">Potion ${sel('g:speed', g.speed, [[0, 'aucune'], [50, 'Récolteur Véloce +50 %'], [100, 'Artipotion Exceptionnelle +100 %']])}</label>
      </div>
      ${parts.length ? `<details class="meta"><summary>Détail quantité</summary>${parts.map(([n, v]) => `${esc(n)} : ${v > 0 ? '+' : ''}${v} %`).join('<br>')}</details>` : ''}
      </details>
      <p class="meta">Les bonus d’une même catégorie s’additionnent. Turbo Craft et les potions de vitesse ne se cumulent pas.
        ${+g.pacte ? '<br>Pacte : une partie des récoltes part dans l’inventaire PvP.' : ''}
        ${best ? '<br>* En boucle sur ' + esc(best.r.name) + ', sans déplacements.' : ''}</p>`;
  }

  function climCount(j, my) {
    const rs = j.resources.filter(r => r.temp && (my === null || r.level <= my));
    const c = { ok: 0, hot: 0, cold: 0 };
    rs.forEach(r => c[climate(r)]++);
    return `<span class="ccount"><span class="temp ok">● ${c.ok}</span> <span class="temp hot">▲ ${c.hot}</span> <span class="temp cold">▼ ${c.cold}</span></span>`;
  }

  // les clés globales sont préfixées par « g: » ou listées ici
  const GLOBAL_KEYS = ['havre', 'stasis', 'turbo', 'xpExtra'];
  function bindBonus(j) {
    const box = $('#bonus');
    const refresh = () => {
      $('#bonus-body').innerHTML = bonusHtml(j);
      $('#prog-out').innerHTML = progHtml(j, myLevel());
      renderList(); changed();
    };
    box.addEventListener('toggle', e => {
      if (e.target.matches('details.bmore')) store.set('ui.bmore', e.target.open ? '1' : '0');
    }, true);
    box.addEventListener('click', e => {
      const r = e.target.closest('[data-region]');
      if (!r) return;
      const g = bg(), v = +r.dataset.region;
      g.region = g.region === v ? null : v;
      sj.set('bonus.global', g); refresh();
    });
    box.addEventListener('change', e => {
      const el = e.target.closest('[data-b]');
      if (!el) return;
      let key = el.dataset.b;
      const global = key.startsWith('g:') || GLOBAL_KEYS.includes(key);
      key = key.replace(/^g:/, '');
      const val = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' && !isNaN(+el.value) && el.value !== '' ? +el.value : (el.type === 'number' ? +el.value || 0 : el.value));
      if (global) {
        const g = bg(); g[key] = val;
        if (key === 'temp') g.temp = el.value === '' ? null : +el.value;
        if (key === 'turbo' && val) g.speed = 0;      // non cumulables
        if (key === 'speed' && val) g.turbo = false;
        sj.set('bonus.global', g);
      } else {
        const b = bjob(j.key); b[key] = val; sj.set('bonus.' + j.key, b);
      }
      refresh();
    });
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
      <div class="box" id="prog" data-box="prog"><h4>Progression ${esc(j.label)}</h4>
        <div class="pin">
          <label>XP actuelle<input id="p-xp" type="number" min="0" value="${esc(store.get('xp.' + j.key) || '')}" placeholder="0"></label>
          <label>Objectif niv.<input id="p-tg" type="number" min="1" max="250" value="${esc(store.get('target.' + j.key) || '')}" placeholder="auto"></label>
        </div>
        <div id="prog-out">${progHtml(j, my)}</div>
      </div>
      <div class="box" id="bonus" data-box="bonus"><h4>Bonus actifs</h4><div id="bonus-body">${bonusHtml(j)}</div></div>
      <div class="box" data-box="tools"><h4>Outils ${esc(j.label)}</h4>${tools}
        <p class="meta" style="margin:10px 0 0">Le niveau indiqué est celui de la recette (craft par le ${esc(j.label)}).</p></div>
      <div class="box" data-box="pet"><h4>Familier</h4>
        <div class="it">${icon(p)}<div><b>${esc(p.name)}</b>
          <span class="bonus">+${p.bonus_min} % → +${p.bonus_max} % quantité récoltée</span>
          <div class="meta">Niv. 1 → 50 · obtenu dans les ${esc(p.how)}</div></div></div></div>
      <div class="box" data-box="conso"><h4>Consommable</h4>
        <div class="it">${icon(c)}<div><b>${esc(c.name)} <span class="badge">niv. ${c.level}</span></b>
          <span class="bonus">${esc(c.bonus)} · ${esc(c.duration)}</span>
          <div class="meta">${esc(c.how)}</div>${recipeHtml(c.recipe)}</div></div></div>
      ${extras ? `<div class="box" data-box="extras"><h4>Équipement bonus</h4>${extras}</div>` : ''}
      <div class="box" data-box="common"><h4>Bonus tous métiers</h4>${common}</div>`;
    bindProg(j, my);
    bindBonus(j);
    // blocs repliables (clic sur le titre), état mémorisé
    $('#side').querySelectorAll('.box[data-box]').forEach(box => {
      const k = 'ui.box.' + box.dataset.box;
      box.classList.toggle('collapsed', store.get(k) === '0');
      const h = box.querySelector('h4');
      h.setAttribute('role', 'button'); h.tabIndex = 0;
      const tg = () => { box.classList.toggle('collapsed'); store.set(k, box.classList.contains('collapsed') ? '0' : '1'); };
      h.onclick = tg;
      h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tg(); } };
    });
  }

  window.addEventListener('hashchange', () => {
    const k = location.hash.slice(1);
    if (k && k !== cur && D.jobs.some(j => j.key === k)) select(k);
  });
  renderTabs();
  select(cur);
})();
