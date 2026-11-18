// Pages : rendu sans erreur, sans débordement horizontal (PC + mobile), interactions clés
const { test, expect } = require('@playwright/test');
const { seed, trackErrors } = require('./helpers');

const STATE = {
  'lvl.paysan': '30', 'lvl.herboriste': '17', 'lvl.trappeur': '10', 'lvl.forestier': '22', 'lvl.boulanger': '12',
  'xp.paysan': '1200', 'target.paysan': '45', 'bonus.global': { region: 30 },
};
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

for (const hash of ['paysan', 'rentabilite', 'zones', 'objectif', 'boulanger']) {
  test(`page #${hash}`, async ({ page }) => {
    const errs = trackErrors(page);
    await seed(page, STATE);
    await page.goto('/?t=' + Date.now() + '#' + hash);
    await page.waitForTimeout(1200);
    const visible = await page.$$eval('.main > div:not([hidden])', a => a.map(x => x.id));
    expect(visible).toEqual([['rentabilite', 'zones', 'objectif'].includes(hash) ? 'page-' + hash : 'page-metiers']);
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

test('objectif : niveau, cible, plan, sac modifiable, affichage compact', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { ...STATE, goal: { job: 'herboriste' } });
  await page.goto('/?o#session'); // ancienne adresse → Objectif
  await expect(page.locator('#page-objectif')).toBeVisible();
  await page.fill('[data-g="lvl"]', '55');
  await page.press('[data-g="lvl"]', 'Enter');
  await page.fill('[data-g="to"]', '62');
  await page.press('[data-g="to"]', 'Enter');
  await expect(page.locator('.next-txt b')).toContainText(/Récolte|Crafte/);
  await expect(page.locator('.steps li').first()).toBeVisible();
  await expect(page.locator('.hero-prog-r b')).toHaveText('62');
  const tile = page.locator('#g-bag [data-stock]').first();
  await tile.fill('17'); await tile.press('Enter');
  const name = await page.locator('#g-bag [data-stock]').first().getAttribute('data-stock');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('waktool.stock'))).items[name]).toBe(17);
  await noOverflow(page);
  await page.click('[data-view="compact"]');
  await expect(page.locator('#page-objectif')).toHaveClass(/compact/);
  await expect(page.locator('#g-steps')).toBeHidden(); // replié
  await noOverflow(page);
  await page.click('[data-view="full"]');
  await expect(page.locator('#g-steps')).toBeVisible();
  expect(errs).toEqual([]);
});

test('artisanat : recettes et liste de courses détaillée', async ({ page }) => {
  await seed(page, { ...STATE, 'sub.boulanger': 'plan', 'target.boulanger': '30', 'deep.boulanger': '1' });
  await page.goto('/?a#boulanger');
  await expect(page.locator('#list')).toContainText('Intermédiaires');
  await expect(page.locator('#list .shop li').first()).toBeVisible();
});

test('changer de niveau remet l’XP actuelle à 0 (saisie et import)', async ({ page }) => {
  await seed(page, { ...STATE, 'xp.paysan': '1200', 'xp.herboriste': '500', 'lvl.herboriste': '17' });
  await page.goto('/?x#paysan');
  await page.fill('[data-jc="lvl"]', '31');
  await page.press('[data-jc="lvl"]', 'Enter');
  await expect(page.locator('[data-jc="xp"]')).toHaveValue('0');
  expect(await page.evaluate(() => localStorage.getItem('waktool.xp.paysan'))).toBe('0');
  // import : seul le niveau qui change voit son XP remise à 0
  await page.evaluate(() => window.waktool.setLevels({ herboriste: 17, trappeur: 11 }));
  const r = await page.evaluate(() => [localStorage.getItem('waktool.xp.herboriste'), localStorage.getItem('waktool.xp.trappeur')]);
  expect(r).toEqual(['500', '0']);
  // la synchronisation du compte ne touche pas à l'XP
  await page.evaluate(() => window.waktool.applyState({ levels: { paysan: 32 }, progress: { paysan: { xp: 777, at: Date.now() + 1000 } } }));
  expect(await page.evaluate(() => localStorage.getItem('waktool.xp.paysan'))).toBe('777');
});

test('filtre « Donne de l’XP seulement » (ressources et recettes)', async ({ page }) => {
  await seed(page, STATE); // Paysan 30 : ressources niv. 0 à 10 ne donnent plus d'XP, > 30 trop hautes
  await page.goto('/?f#paysan');
  await page.click('[data-sub="res"]');
  await page.check('#xponly');
  const lv = await page.$$eval('#list .res .res-lvl', a => a.map(x => +x.textContent.replace(/\D/g, '')));
  expect(lv.length).toBeGreaterThan(0);
  expect(lv.every(l => l > 10 && l <= 30)).toBe(true);
  await page.click('[data-sub="rec"]');
  await expect(page.locator('#list')).not.toContainText('Chargement');
  const rl = await page.$$eval('#list .rec .res-lvl', a => a.map(x => +x.textContent.replace(/\D/g, '')));
  expect(rl.every(l => l > 10 && l <= 30)).toBe(true);
  await expect(page.locator('#list .xpline.none')).toHaveCount(0);
});

test('objectif : zones communes avec l’étape suivante (Croton puis Fil Solide avec Edelweiss)', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '64', 'xp.herboriste': '0', 'target.herboriste': '70', goal: { job: 'herboriste', travel: 3 }, 'bonus.global': { region: 30 } });
  await page.goto('/?zz#objectif');
  await expect(page.locator('.next-txt')).toContainText('Va plutôt ici : Edelweiss y pousse aussi');
  await expect(page.locator('.next-txt .zone')).not.toContainText('Flaqueux'); // zone sans Edelweiss écartée
  await expect(page.locator('.steps li').first()).toContainText('+ Edelweiss ensuite');
  expect(errs).toEqual([]);
});

test('objectif : barre de progression depuis le départ, ↺ repart du niveau actuel', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '65', 'xp.herboriste': '2729', 'target.herboriste': '70',
    goal: { job: 'herboriste', start: { to: 70, x: 75 * 45 * 45 } } });
  await page.goto('/?pb#objectif');
  await expect(page.locator('.hero-prog-l b')).toHaveText('45');
  await expect(page.locator('.hero-prog-m')).toContainText('Niv. 65 · 2 729 / 9 825 XP · 77 %');
  await page.click('[data-g="restart"]');
  await expect(page.locator('.hero-prog-l b')).toHaveText('65');
  await expect(page.locator('.hero-prog-m')).toContainText('· 5 %'); // 2 729 / 50 625
  expect(errs).toEqual([]);
});
