// Pages : rendu sans erreur, sans débordement horizontal (PC + mobile), interactions clés
const { test, expect } = require('@playwright/test');
const { seed, trackErrors } = require('./helpers');

const STATE = {
  'lvl.paysan': '30', 'lvl.herboriste': '17', 'lvl.trappeur': '10', 'lvl.forestier': '22', 'lvl.boulanger': '12',
  'xp.paysan': '1200', 'target.paysan': '45', 'bonus.global': { region: 30 },
};
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

for (const hash of ['paysan', 'rentabilite', 'zones', 'session', 'boulanger']) {
  test(`page #${hash}`, async ({ page }) => {
    const errs = trackErrors(page);
    await seed(page, STATE);
    await page.goto('/?t=' + Date.now() + '#' + hash);
    await page.waitForTimeout(1200);
    const visible = await page.$$eval('.main > div:not([hidden])', a => a.map(x => x.id));
    expect(visible).toEqual([['rentabilite', 'zones', 'session'].includes(hash) ? 'page-' + hash : 'page-metiers']);
    await noOverflow(page);
    expect(errs).toEqual([]);
  });
}

test('sous-onglets d’un métier de récolte', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, STATE); await page.goto('/?s#paysan');
  for (const sub of ['res', 'rec', 'plan', 'prices', 'equip']) {
    await page.click(`[data-sub="${sub}"]`);
    await expect(page.locator('#list')).not.toContainText('Chargement');
    await noOverflow(page);
  }
  await page.click('[data-sub="plan"]');
  for (const strat of ['harvest', 'plant', 'craft']) {
    await page.click(`[data-strat="${strat}"]`);
    await expect(page.locator('#list .kpis')).toBeVisible();
  }
  expect(errs).toEqual([]);
});

test('session : compteurs au clavier et application de l’XP', async ({ page }) => {
  await seed(page, { ...STATE, job: 'herboriste', 'target.herboriste': '18' });
  await page.goto('/?c#session');
  for (let i = 0; i < 14; i++) await page.keyboard.press('Space');
  await page.keyboard.press('p');
  await expect(page.locator('#c-h')).toHaveText('14');
  await expect(page.locator('#c-p')).toHaveText('1');
  await page.click('[data-sa="stop"]');
  await page.click('[data-sa="apply"]');
  const r = await page.evaluate(() => [localStorage.getItem('waktool.lvl.herboriste'), localStorage.getItem('waktool.xp.herboriste')]);
  expect(r).toEqual(['18', '315']); // 15 actions × 196 XP = 2 940 → niv. 18 + 315 XP
});

test('artisanat : recettes et liste de courses détaillée', async ({ page }) => {
  await seed(page, { ...STATE, 'sub.boulanger': 'plan', 'target.boulanger': '30', 'deep.boulanger': '1' });
  await page.goto('/?a#boulanger');
  await expect(page.locator('#list')).toContainText('Intermédiaires');
  await expect(page.locator('#list .shop li').first()).toBeVisible();
});
