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
        prefs: { only: true, bonuses: { region: 30, wakfu: 20 }, theme: 'dark', pins: ['boulanger'], sessions: [{ t: 1, ms: 60000, job: 'paysan', res: 'Blé', xp: 100 }] },
      });
      const s = window.waktool.getState();
      return { ok: true, lvl: s.levels.paysan, region: s.prefs.bonuses.region, pet: s.progress.paysan.bonus.pet, pins: s.prefs.pins, hist: s.phist[4442].length, sessions: s.prefs.sessions.length };
    } catch (e) { return { ok: false, err: String(e) }; }
  });
  expect(r).toEqual({ ok: true, lvl: 30, region: 30, pet: 'job', pins: ['boulanger'], hist: 4, sessions: 1 });
  expect(errs).toEqual([]);
});
