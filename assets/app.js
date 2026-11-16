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
  const lvlKey = () => 'lvl.' + cur;
  [q, only].forEach(el => el.addEventListener('input', renderList));
  lvl.addEventListener('input', () => { store.set(lvlKey(), lvl.value); renderList(); renderSide(); });

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
      return n;
    }));
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
  }

  window.addEventListener('hashchange', () => {
    const k = location.hash.slice(1);
    if (k && k !== cur && D.jobs.some(j => j.key === k)) select(k);
  });
  select(cur);
})();
