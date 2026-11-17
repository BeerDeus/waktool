// Journal du chat (wakfu_chat.log) : lignes synthétiques au format du jeu, injectées via waktool.chatFeed
const { test, expect } = require('@playwright/test');
const { seed, trackErrors } = require('./helpers');

const L = (t, msg, canal = 'Information (jeu)') => `${t},100 - [${canal}] ${msg}`;
const xp = (t, gain, rem, up = 0) => L(t, `Herboriste : +${gain} points d'XP.  ${up ? `+${up} niveau. ` : ''}Prochain niveau dans : ${rem.toLocaleString('fr-FR').replace(/ /g, ' ')}.`);
const feed = (page, lines, first = false, mod = Date.now()) => page.evaluate(([l, f, m]) => window.waktool.chatFeed(l, f, m), [lines, first, mod]);
const ls = (page, k) => page.evaluate(k => localStorage.getItem('waktool.' + k), k);
const sess = page => page.evaluate(() => JSON.parse(localStorage.getItem('waktool.session') || 'null'));

test('niveau exact déduit d’une montée, XP actuelle, autres canaux ignorés', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '40' });
  await page.goto('/?c#herboriste');
  await feed(page, [
    xp('16:59:40', 166, 206),
    xp('16:59:43', 166, 40),
    L('16:59:44', 'Herboriste : +999 points d\'XP.  Prochain niveau dans : 1.', 'Commerce'), // un joueur qui écrit : ignoré
    xp('16:59:47', 166, 6849, 1), // 40 restants, +166 → 126 de trop ; 6 849 + 126 = 6 975 = 150×46 + 75
  ], true);
  expect(await ls(page, 'lvl.herboriste')).toBe('46');
  expect(await ls(page, 'xp.herboriste')).toBe('126');
  expect(await sess(page)).toBeNull(); // lecture initiale sans repère : pas de session
  await expect(page.locator('.tab[data-k="herboriste"] .tlvl')).toHaveText('46');
  expect(errs).toEqual([]);
});

test('en direct : session auto, récoltes / plantations, objets, objectif avec alerte', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '46', 'xp.herboriste': '0' });
  await page.goto('/?c#session');
  await feed(page, [xp('17:00:00', 162, 6813)], true); // liaison (silencieuse)
  await feed(page, [
    xp('17:00:05', 162, 6651), L('17:00:05', 'Vous avez ramassé 4x Algue Narine .'),
    xp('17:00:09', 161, 6490), L('17:00:09', 'Vous avez perdu 1x Mucilage Narin .'), // plantation réussie
    L('17:00:12', 'Le plant n\'a pas pris.'), L('17:00:12', 'Vous avez perdu 1x Mucilage Narin .'), // ratée : pas d'XP
  ]);
  let s = await sess(page);
  expect(s.job).toBe('herboriste');
  expect(s.start).toBeTruthy();
  expect(s.real).toMatchObject({ xp: 323, p: 1, fail: 1, items: { 'Algue Narine': 4 } });
  expect(s.res).toBe('Algue Narine');
  await expect(page.locator('#s-live')).toContainText('323');
  await expect(page.locator('#s-items')).toContainText('Algue Narine');

  await page.fill('[data-goal="Algue Narine"]', '6');
  await page.locator('[data-goal="Algue Narine"]').dispatchEvent('change');
  await feed(page, [xp('17:00:15', 162, 6328), L('17:00:15', 'Vous avez ramassé 3x Algue Narine .')]);
  await expect(page.locator('#toasts')).toContainText('Objectif atteint');
  s = await sess(page);
  expect(s.real.h).toBe(2); // la 1re récolte + celle-ci (classée à la ligne suivante)
  expect(s.real.items['Algue Narine']).toBe(7);
  expect(await ls(page, 'xp.herboriste')).toBe(String(6975 - 6328));

  await page.click('[data-sa="stop"]');
  await expect(page.locator('.panel.done')).toContainText('mise à jour en direct');
  expect(errs).toEqual([]);
});

test('rattrapage des lignes écrites pendant que le site était fermé', async ({ page }) => {
  const errs = trackErrors(page);
  const mod = new Date('2020-03-10T18:00:00').getTime();
  await seed(page, { 'lvl.herboriste': '46', 'chat.mark': { at: new Date('2020-03-10T17:00:00.500').getTime() } });
  await page.goto('/?c#session');
  await feed(page, [
    xp('16:59:59', 162, 7000), // déjà traité (avant le repère)
    xp('17:30:00', 162, 6813), L('17:30:00', 'Vous avez ramassé 2x Algue Narine .'),
    xp('17:30:04', 162, 6651), L('17:30:04', 'Vous avez ramassé 5x Algue Narine .'),
  ], true, mod);
  const s = await sess(page);
  expect(s.real).toMatchObject({ xp: 324, h: 2, items: { 'Algue Narine': 7 } });
  expect(s.start).toBeNull(); // dernière XP il y a plus de 15 min : session en pause
  expect(s.acc).toBe(4000); // seul le temps de jeu compte
  await expect(page.locator('#toasts')).toContainText('Journal rattrapé');
  expect(JSON.parse(await ls(page, 'chat.mark')).at).toBe(new Date('2020-03-10T17:30:04.100').getTime());
  expect(errs).toEqual([]);
});

test('lecture du fichier en continu (worker) : lignes ajoutées après la liaison', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '46' });
  await page.goto('/?c#session');
  // un vrai FileSystemFileHandle (stockage privé du navigateur) à la place du fichier choisi
  await page.evaluate(async lines => {
    const dir = await navigator.storage.getDirectory();
    const h = await dir.getFileHandle('wakfu_chat.log', { create: true });
    const w = await h.createWritable(); await w.write(lines.join('\r\n') + '\r\n'); await w.close();
    const src = document.querySelector('script[src*="assets/js/main.js"]').src;
    const m = await import(src.replace('main.js', 'chatlog.js'));
    m.chatStart(h);
    window.__h = h;
  }, [xp('17:00:00', 162, 6813)]);
  await expect(page.locator('#chat-box')).toContainText('En direct');
  expect(await ls(page, 'xp.herboriste')).toBe(String(6975 - 6813));
  await page.evaluate(async line => {
    const f = await window.__h.getFile();
    const w = await window.__h.createWritable({ keepExistingData: true }); await w.seek(f.size); await w.write(line + '\r\n'); await w.close();
  }, xp('17:00:04', 162, 6651));
  await expect.poll(() => ls(page, 'xp.herboriste'), { timeout: 5000 }).toBe(String(6975 - 6651));
  expect((await sess(page)).real.xp).toBe(162);
  expect(errs).toEqual([]);
});

test('crafts : une XP par craft, classés à part (ni récolte ni plantation), ingrédients déduits', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '60', 'prices': { 2005: [10, Date.now()] } });
  await page.goto('/?c#session');
  await feed(page, [xp('00:08:00', 176, 1850)], true);
  const craft = ['00:11:30', 450];
  await feed(page, [
    xp('00:08:24', 176, 1674), L('00:08:24', 'Vous avez ramassé 5x Fleur de Rhodon .'),
    xp(craft[0], 450, 1224), xp(craft[0], 450, 774), xp(craft[0], 450, 324), xp(craft[0], 450, 9099, 1),
    L(craft[0], 'Vous avez perdu 20x Pied de Boufton .'), L(craft[0], 'Vous avez perdu 20x Fleur de Rhodon .'),
    L(craft[0], 'Vous avez ramassé 4x Fil Brut .'), L(craft[0], 'Vous avez réussi votre recette de Fil Brut.'),
    L('00:11:41', 'Vous avez perdu 235x Algue Narine .'), L('00:11:41', 'Vous avez ramassé 47x Fil Fragile .'),
    L('00:11:41', 'Vous avez réussi votre recette de Fil Fragile.'), // recette trop basse : aucune XP
  ]);
  const s = await sess(page);
  expect(s.real).toMatchObject({ h: 1, p: 0, xp: 176 + 4 * 450, craftXp: 1800, crafted: { 'Fil Brut': 4, 'Fil Fragile': 47 }, used: { 'Fleur de Rhodon': 20, 'Algue Narine': 235 } });
  expect(await ls(page, 'lvl.herboriste')).toBe('61');
  await expect(page.locator('#s-live')).toContainText('dont 1 800 en craft');
  await expect(page.locator('#s-items')).toContainText('fabriqué');
  expect(errs).toEqual([]);
});
