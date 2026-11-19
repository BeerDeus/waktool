// Calculs : XP (valeurs relevées en jeu), courbe de niveau, plans, zones
const { test, expect } = require('@playwright/test');
const { seed, mod } = require('./helpers');

test.beforeEach(async ({ page }) => { await seed(page, { 'bonus.global': { region: 30 } }); await page.reload(); });

test('XP par action = valeurs vues en jeu (bonus 30 %)', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(M => ({
    pleine: M.XP.per(10, 30), ecart12: M.XP.per(12, 30), ecart16: M.XP.per(16, 30),
    rareHerbo16: M.XP.per(16, 30, 1500), rareHerbo12: M.XP.per(12, 30, 1500), rareHerbo7: M.XP.per(7, 30, 1500), rareTrap: M.XP.per(10, 30, 600),
    sansBonus: M.XP.per(0, 0), ecart20: M.XP.per(20, 30),
  }));
  expect(r).toEqual({ pleine: 196, ecart12: 176, ecart16: 68, rareHerbo16: 683, rareHerbo12: 1756, rareHerbo7: 1951, rareTrap: 781, sansBonus: 150, ecart20: 0 });
});

test('courbe d’XP : 150 × niveau + 75 (2 475 au niv. 16, 1 575 au niv. 10)', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(M => [M.XP.need(16), M.XP.need(10), M.XP.total(100), M.addXp(16, 1633, 1000)]);
  expect(r).toEqual([2475, 1575, 750000, { level: 17, xp: 158 }]);
});

test('plan de montée : fini et cohérent (récolte, champ perso)', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(M => {
    const j = M.getJob('herboriste');
    const a = M.harvestPlan(j, 17, 0, 40, 'harvest'), b = M.harvestPlan(j, 17, 0, 40, 'plant');
    return { xp: a.xp, okA: isFinite(a.time) && a.actions > 0, okB: isFinite(b.time) && b.actions > a.actions };
  });
  expect(r.xp).toBe(75 * (40 * 40 - 17 * 17));
  expect(r.okA).toBe(true);
  expect(r.okB).toBe(true); // le champ perso demande plus d'actions (plantations + graines)
});

test('index des zones normalisé', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(M => {
    const z = M.zonesIndex();
    return { n: z.length, brakmar: z.filter(x => /^Brakmar$/i.test(x.region)).length, kelba: z.some(x => x.name === 'Landes de Kelba' && x.region === 'Kelba') };
  });
  expect(r.n).toBeGreaterThan(80);
  expect(r.brakmar).toBe(0); // fusionné avec « Brâkmar »
  expect(r.kelba).toBe(true);
});

test('synchronisation compte : applyState complet sans erreur', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const r = await page.evaluate(() => {
    try {
      window.waktool.applyState({
        levels: { paysan: 30, herboriste: 17 },
        progress: { paysan: { xp: 1200, target: 45, bonus: { pet: 'job', petLvl: 40, conso: true } } },
        prices: { 4442: [12, Date.now()] },
        phist: { 4442: [Date.now() - 864e5, 10, Date.now(), 12] },
        prefs: { only: true, bonuses: { region: 30, wakfu: 20 }, theme: 'dark', pins: ['boulanger'], goal: { job: 'paysan', travel: 5, t: Date.now() }, stock: { t: Date.now(), items: { 'Blé': 12 } } },
      });
      const s = window.waktool.getState();
      return { ok: true, lvl: s.levels.paysan, region: s.prefs.bonuses.region, pet: s.progress.paysan.bonus.pet, pins: s.prefs.pins, hist: s.phist[4442].length, goal: s.prefs.goal.job, ble: s.prefs.stock.items['Blé'] };
    } catch (e) { return { ok: false, err: String(e) }; }
  });
  expect(r).toEqual({ ok: true, lvl: 30, region: 30, pet: 'job', pins: ['boulanger'], hist: 4, goal: 'paysan', ble: 12 });
  expect(errs).toEqual([]);
});

test('objectif : plan avec trajets, stock utilisé d’abord, moins de changements de spot quand le trajet est long', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(async M => {
    await M.loadRecipes('herboriste');
    const j = M.getJob('herboriste');
    const a = M.goalPlan(j, 55, 0, 75, {}, { plant: true, craft: true, travel: 0 });
    const b = M.goalPlan(j, 55, 0, 75, {}, { plant: true, craft: true, travel: 1800 });
    const c = M.goalPlan(j, 55, 0, 60, { 'Fleur de Rhodon': 500, 'Pied de Boufton': 500 }, { plant: true, craft: true, travel: 180 });
    const d = M.goalPlan(j, 55, 0, 60, {}, { plant: true, craft: true, travel: 180 });
    const xpOk = p => Math.abs(p.steps.reduce((s, x) => s + x.xp, 0) - p.xp) < 1;
    return { xp: a.xp, xpOk: xpOk(a) && xpOk(b), spotsA: a.travels, spotsB: b.travels, finite: isFinite(a.time) && isFinite(b.time),
      first: c.steps[0].key, stockUsed: c.steps[0].ing.every(o => o.fromStock > 0), faster: c.farm < d.farm };
  });
  expect(r.xp).toBe(75 * (75 * 75 - 55 * 55));
  expect(r.xpOk).toBe(true);
  expect(r.finite).toBe(true);
  expect(r.spotsB).toBeLessThanOrEqual(r.spotsA); // trajet long : on change moins de cible
  expect(r.first).toMatch(/^c:/); // ingrédients en sac : on commence par crafter
  expect(r.stockUsed).toBe(true);
  expect(r.faster).toBe(true);
});

test('objectif : plan fini pour chaque métier de récolte', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(async M => {
    const out = {};
    for (const j of M.HARVEST) {
      await M.loadRecipes(j.key);
      const p = M.goalPlan(j, 20, 0, 60, {}, { plant: true, craft: true, travel: 180 });
      out[j.key] = isFinite(p.time) && p.steps.length > 0 && p.blocked === null;
    }
    return out;
  });
  expect(Object.values(r).every(Boolean)).toBe(true);
});

test('objectif : ressources dans la même zone = un seul spot (Croton + Edelweiss → Fil Solide sans trajet)', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(async M => {
    await M.loadRecipes('herboriste');
    const j = M.getJob('herboriste'), R = n => j.resources.find(x => x.name === n);
    const p = M.goalPlan(j, 64, 0, 70, {}, { plant: true, craft: true, travel: 180 });
    return { same: M.spotGroups([R('Croton'), R('Edelweiss')]).length, diff: M.spotGroups([R('Rhodon'), R('Croton')]).length,
      steps: p.steps.map(s => (s.kind === 'g' ? s.r.name : s.rec.res.item.name)), travels: p.travels };
  });
  expect(r.same).toBe(1);
  expect(r.diff).toBe(2);
  expect(r.steps).toEqual(['Croton', 'Fil Solide']);
  expect(r.travels).toBe(1);
});

test('objectif : pousse des plants (attente à l’arrivée, plafond de plants) et graines sur chaque plant', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(async M => {
    await M.loadRecipes('herboriste');
    const j = M.getJob('herboriste'), R = j.resources.find(x => x.name === 'Croton'), q = M.qtyStats(j).avg;
    const base = M.goalPlan(j, 64, 0, 70, {}, { travel: 180 });
    const few = M.goalPlan(j, 64, 0, 70, {}, { travel: 180, field: { wild: 10, cap: 30 } });
    return {
      idleDefault: M.spotIdle(j, [R], 64, q), idleFew: M.spotIdle(j, [R], 64, q, { ...M.FIELD_DEF, wild: 10, cap: 30 }),
      bound: M.plantCycle(j, R, 64, q, { ...M.FIELD_DEF, cap: 5 }).growBound, free: M.plantCycle(j, R, 64, q).growBound,
      seeds: M.plantCycle(j, R, 64, q).seedActs, slower: few.time > base.time, idlePlan: few.idle > 0,
    };
  });
  expect(r.idleDefault).toBe(0); // 40 sauvages + ~86 plantations : les premiers plants ont poussé avant la fin
  expect(r.idleFew).toBeGreaterThan(0);
  expect(r.bound).toBe(true); // 5 plants seulement : on attend la pousse
  expect(r.free).toBe(false);
  expect(r.seeds).toBe(1);
  expect(r.slower).toBe(true);
  expect(r.idlePlan).toBe(true);
});

test('météo (données du jeu) : chance de plantation 70 % / 56 % et temps de pousse selon la plante', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(M => {
    const P = M.getJob('paysan'), H = M.getJob('herboriste');
    const ble = P.resources.find(x => x.name === 'Blé'), croton = H.resources.find(x => x.name === 'Croton'), algue = H.resources.find(x => x.name === 'Algue Narine');
    const g = M.bg(), set = w => localStorage.setItem('waktool.bonus.global', JSON.stringify({ ...g, weather: w }));
    const out = { rain: [ble.rain, croton.rain, algue.rain] };
    set(null); out.none = [M.weatherOk(ble), M.plantChance(ble)];
    set(1); out.sun = [M.weatherOk(ble), M.plantChance(ble), M.weatherOk(algue), M.plantChance(algue)];
    out.grow = [M.growOf(ble, { grow: 300, growBad: 600 }), M.growOf(algue, { grow: 300, growBad: 600 })];
    return out;
  });
  expect(r.rain).toEqual([1, 1, 3]); // Blé ☀ (comme en jeu), Croton ☀, Algue Narine 🌧
  expect(r.none).toEqual([null, 0.7]);
  expect(r.sun[0]).toBe(true); expect(r.sun[1]).toBeCloseTo(0.7);
  expect(r.sun[2]).toBe(false); expect(r.sun[3]).toBeCloseTo(0.56);
  expect(r.grow).toEqual([300, 600]);
});

test('objectif : étape imposée (verrou) jusqu’à son niveau de fin, puis plan libre', async ({ page }) => {
  const m = await mod(page, 'model');
  const r = await m.evaluate(async M => {
    await M.loadRecipes('herboriste');
    const j = M.getJob('herboriste');
    const free = M.goalPlan(j, 57, 0, 64, {}, { travel: 180 });
    const forced = M.goalPlan(j, 57, 0, 64, {}, { travel: 180, force: { key: 'g:Roseau', until: 59 } });
    return { free: free.steps[0].key, f0: forced.steps[0].key, f0to: forced.steps[0].to, next: forced.steps[1] && forced.steps[1].key };
  });
  expect(r.free).not.toBe('g:Roseau');
  expect(r.f0).toBe('g:Roseau');
  expect(r.f0to).toBe(59);
  expect(r.next).toBeTruthy();
});
