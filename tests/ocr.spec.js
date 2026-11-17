// Import de captures réelles du jeu (Ctrl+V) : niveaux, XP actuelle, prix HDV
const { test, expect } = require('@playwright/test');
const { seed, pasteImage, trackErrors } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const levelsOf = page => page.$$eval('dialog input[type=number][name]', a => Object.fromEntries(a.map(i => [i.name, i.value])));

test('fenêtre Métiers → niveaux', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page); await page.reload();
  await pasteImage(page, 'metiers-liste.png');
  expect(await levelsOf(page)).toEqual({ paysan: '0', forestier: '0', herboriste: '14', mineur: '0', pecheur: '0', trappeur: '10' });
  await page.click('#imp-ok');
  expect(await page.evaluate(() => localStorage.getItem('waktool.lvl.herboriste'))).toBe('14');
  expect(errs).toEqual([]);
});

test('fenêtre de détail Herboriste → niveaux + XP actuelle 1 633', async ({ page }) => {
  await seed(page); await page.reload();
  await pasteImage(page, 'detail-herboriste.png');
  const lv = await levelsOf(page);
  expect(lv.herboriste).toBe('16');
  expect(lv.trappeur).toBe('10');
  expect(Object.keys(lv).every(k => ['paysan', 'forestier', 'herboriste', 'mineur', 'pecheur', 'trappeur'].includes(k))).toBe(true); // pas de faux niveaux d'artisanat
  await expect(page.locator('.imp-xp')).toContainText('Herboriste niv. 16');
  expect(await page.inputValue('#imp-xpv')).toBe('1633');
  await page.click('#imp-ok');
  expect(await page.evaluate(() => localStorage.getItem('waktool.xp.herboriste'))).toBe('1633');
});

test('fenêtre de détail Trappeur → XP actuelle 528', async ({ page }) => {
  await seed(page); await page.reload();
  await pasteImage(page, 'detail-trappeur.png');
  await expect(page.locator('.imp-xp')).toContainText('Trappeur niv. 10');
  expect(await page.inputValue('#imp-xpv')).toBe('528');
});

test('Hôtel des ventes → 9 prix exacts', async ({ page }) => {
  await seed(page); await page.reload();
  await pasteImage(page, 'hdv-paysan.png');
  const rows = await page.$$eval('dialog tbody tr', a => Object.fromEntries(a.map(r => [r.children[1].innerText.trim(), r.querySelector('input[type=number]').value])));
  expect(rows).toEqual({
    'Avoine Spectaculaire': '735', 'Bulbe Radin': '179', 'Cawotte': '12', 'Cawotte Magique': '7792', 'Champignon Chalant': '3095',
    'Champignon Marbré': '888', 'Cheh': '185', "Epi de Blé d'Or": '4493', 'Fibre de Seigle': '61',
  });
  await page.click('#imp-ok');
  const n = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('waktool.prices'))).length);
  expect(n).toBe(9);
});
