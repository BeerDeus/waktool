// Journal du chat (wakfu_chat.log) : lignes synthétiques au format du jeu, injectées via waktool.chatFeed,
// par un vrai fichier (worker) ou par le pont local simulé (http://127.0.0.1:47811)
const { test, expect } = require('@playwright/test');
const { seed, trackErrors } = require('./helpers');

const L = (t, msg, canal = 'Information (jeu)') => `${t},100 - [${canal}] ${msg}`;
const xp = (t, gain, rem, up = 0) => L(t, `Herboriste : +${gain} points d'XP.  ${up ? `+${up} niveau. ` : ''}Prochain niveau dans : ${rem.toLocaleString('fr-FR').replace(/ /g, ' ')}.`);
const feed = (page, lines, first = false, mod = Date.now()) => page.evaluate(([l, f, m]) => window.waktool.chatFeed(l, f, m), [lines, first, mod]);
const ls = (page, k) => page.evaluate(k => localStorage.getItem('waktool.' + k), k);
const bag = async page => (JSON.parse(await ls(page, 'stock') || 'null') || { items: {} }).items;
const guide = page => page.evaluate(() => window.waktool.goalGuide());

test('niveau exact déduit d’une montée, XP actuelle, autres canaux ignorés', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '40' });
  await page.goto('/?c#herboriste');
  await feed(page, [
    xp('16:59:40', 166, 206),
    L('16:59:41', 'Vous avez ramassé 4x Algue Narine .'),
    xp('16:59:43', 166, 40),
    L('16:59:44', 'Herboriste : +999 points d\'XP.  Prochain niveau dans : 1.', 'Commerce'), // un joueur qui écrit : ignoré
    xp('16:59:47', 166, 6849, 1), // 40 restants, +166 → 126 de trop ; 6 849 + 126 = 6 975 = 150×46 + 75
  ], true);
  expect(await ls(page, 'lvl.herboriste')).toBe('46');
  expect(await ls(page, 'xp.herboriste')).toBe('126');
  expect(await bag(page)).toEqual({}); // lecture initiale sans repère : le sac n'est pas touché
  await expect(page.locator('.tab[data-k="herboriste"] .tlvl')).toHaveText('46');
  expect(errs).toEqual([]);
});

test('en direct : sac (ramassé, planté, ingrédients, produit), crafts', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '60', stock: { t: 1, items: { 'Mucilage Narin': 5, 'Fleur de Rhodon': 18, 'Pied de Boufton': 20 } } });
  await page.goto('/?c#objectif');
  await feed(page, [xp('00:08:00', 176, 1850)], true);
  const c = '00:11:30';
  await feed(page, [
    xp('00:08:24', 176, 1674), L('00:08:24', 'Vous avez ramassé 5x Fleur de Rhodon .'),
    xp('00:08:28', 161, 1513), L('00:08:28', 'Vous avez perdu 1x Mucilage Narin .'), // plantation réussie
    L('00:08:31', 'Le plant n\'a pas pris.'), L('00:08:31', 'Vous avez perdu 1x Mucilage Narin .'), // ratée : graine perdue quand même
    xp(c, 450, 1063), xp(c, 450, 613), xp(c, 450, 163), xp(c, 450, 8938, 1), // 287 de trop : 8 938 + 287 = 9 225 = besoin du niv. 61
    L(c, 'Vous avez perdu 20x Pied de Boufton .'), L(c, 'Vous avez perdu 20x Fleur de Rhodon .'),
    L(c, 'Vous avez ramassé 4x Fil Brut .'), L(c, 'Vous avez réussi votre recette de Fil Brut.'),
  ]);
  expect(await bag(page)).toEqual({ 'Mucilage Narin': 3, 'Fleur de Rhodon': 3, 'Pied de Boufton': 0, 'Fil Brut': 4 });
  expect(await ls(page, 'lvl.herboriste')).toBe('61');
  await expect(page.locator('#g-bag')).toContainText('Fil Brut');
  expect(errs).toEqual([]);
});

test('rattrapage des lignes écrites pendant que le site était fermé', async ({ page }) => {
  const errs = trackErrors(page);
  const mod = new Date('2020-03-10T18:00:00').getTime();
  await seed(page, { 'lvl.herboriste': '46', 'chat.mark': { at: new Date('2020-03-10T17:00:00.500').getTime() } });
  await page.goto('/?c#objectif');
  await feed(page, [
    xp('16:59:59', 162, 7000), L('16:59:59', 'Vous avez ramassé 9x Algue Narine .'), // déjà traité (avant le repère)
    xp('17:30:00', 162, 6813), L('17:30:00', 'Vous avez ramassé 2x Algue Narine .'),
    xp('17:30:04', 162, 6651), L('17:30:04', 'Vous avez ramassé 5x Algue Narine .'),
  ], true, mod);
  expect(await bag(page)).toEqual({ 'Algue Narine': 7 });
  await expect(page.locator('#toasts')).toContainText('Journal rattrapé');
  expect(JSON.parse(await ls(page, 'chat.mark')).at).toBe(new Date('2020-03-10T17:30:04.100').getTime());
  expect(errs).toEqual([]);
});

test('lecture du fichier en continu (worker) : lignes ajoutées après la liaison', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '46' });
  await page.goto('/?c#objectif');
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
  await page.evaluate(async lines => {
    const f = await window.__h.getFile();
    const w = await window.__h.createWritable({ keepExistingData: true }); await w.seek(f.size); await w.write(lines.join('\r\n') + '\r\n'); await w.close();
  }, [xp('17:00:04', 162, 6651), L('17:00:04', 'Vous avez ramassé 3x Algue Narine .')]);
  await expect.poll(() => ls(page, 'xp.herboriste'), { timeout: 5000 }).toBe(String(6975 - 6651));
  expect(await bag(page)).toEqual({ 'Algue Narine': 3 });
  expect(errs).toEqual([]);
});

test('pont local (waktool-pont.cmd simulé) : connexion, lecture incrémentale, reconnexion automatique', async ({ page }) => {
  const errs = trackErrors(page);
  const chunks = [[xp('17:00:00', 162, 6813)].join('\n'), [xp('17:00:04', 162, 6651), L('17:00:04', 'Vous avez ramassé 3x Algue Narine .')].join('\n')];
  let size = chunks[0].length + 1, calls = [];
  await page.route('http://127.0.0.1:47811/**', route => {
    const from = +new URL(route.request().url()).searchParams.get('from');
    calls.push(from);
    let body = '';
    if (from < 0) body = chunks[0];
    else if (from < size) body = chunks[1];
    const next = from < 0 ? chunks[0].length + 1 : size;
    route.fulfill({ status: 200, body, headers: {
      'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Pont, X-Exists, X-Size, X-Next, X-Mod, X-Reset',
      'X-Pont': '1', 'X-Exists': '1', 'X-Size': String(size), 'X-Next': String(next), 'X-Mod': String(Date.now()), 'X-Reset': '0' } });
  });
  await seed(page, { 'lvl.herboriste': '46' });
  await page.goto('/?b#objectif');
  await expect(page.locator('#chat-box')).toContainText('Non lié');
  await page.click('[data-chat="bridge"]');
  await expect(page.locator('#chat-box')).toContainText('En direct');
  expect(await ls(page, 'xp.herboriste')).toBe(String(6975 - 6813));
  size += chunks[1].length + 1; // le jeu écrit de nouvelles lignes
  await expect.poll(() => ls(page, 'xp.herboriste'), { timeout: 5000 }).toBe(String(6975 - 6651));
  expect(await bag(page)).toEqual({ 'Algue Narine': 3 });
  expect(calls[0]).toBe(-1);
  // au rechargement : reconnexion automatique au pont
  await page.reload();
  await expect(page.locator('.live-pill')).toContainText('en direct');
  expect(errs).toEqual([]);
});

test('pont absent : message clair, pas d’erreur', async ({ page }) => {
  const errs = trackErrors(page);
  await page.route('http://127.0.0.1:47811/**', route => route.abort('connectionrefused'));
  await seed(page, { 'lvl.herboriste': '46' });
  await page.goto('/?b#objectif');
  await page.click('[data-chat="bridge"]');
  await expect(page.locator('#chat-box')).toContainText('pont injoignable');
  expect(errs.filter(e => !/127\.0\.0\.1|net::/.test(e))).toEqual([]);
});

test('assistant : la prochaine action suit le sac, s’adapte à l’XP réelle et alerte aux étapes', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '57', 'xp.herboriste': '0', 'target.herboriste': '60', 'bonus.global': { region: 30 },
    goal: { job: 'herboriste', plant: true, craft: true, travel: 0, alert: 'banner' } }); // sans trajet : le craft est rentable
  await page.goto('/?g#objectif');
  await feed(page, [xp('10:00:00', 186, 8439)], true);
  await expect.poll(async () => (await guide(page)).kind).toBe('c');
  let g = await guide(page);
  const n0 = g.N;
  // beaucoup de plantations (XP sans rien ramasser) : il reste moins d'XP → moins de crafts et d'ingrédients à récolter
  await feed(page, Array.from({ length: 20 }, (_, i) => xp('10:01:' + String(i).padStart(2, '0'), 186, 8439 - 186 * (i + 1))));
  g = await guide(page);
  expect(g.N).toBeLessThan(n0);
  // l'ingrédient en cours atteint la quantité voulue → alerte « passe à … »
  const pb = g.ing.find(o => o.name === 'Pied de Boufton');
  await page.evaluate(n => { localStorage.setItem('waktool.stock', JSON.stringify({ t: Date.now(), items: { 'Pied de Boufton': n } })); window.waktool.applyState({}); }, pb.need - 2);
  g = await guide(page);
  const need = g.ing.find(o => o.name === 'Pied de Boufton').need, have = g.ing.find(o => o.name === 'Pied de Boufton').have;
  await feed(page, [xp('10:02:00', 186, 8439 - 186 * 21), L('10:02:00', `Vous avez ramassé ${need - have + 15}x Pied de Boufton .`)]);
  await expect(page.locator('#flash')).toContainText('Assez de Pied de Boufton');
  await expect(page.locator('#flash')).toContainText('Passe à Fleur de Rhodon');
  await expect(page.locator('body')).toHaveClass(/pulse/);
  await expect(page.locator('body')).not.toHaveClass(/pulse/, { timeout: 7000 }); // 5 s de clignotement max
  await page.click('[data-flash-x]');
  await expect(page.locator('#flash')).toBeHidden();
  // objectif atteint : grosse alerte
  await feed(page, [xp('10:03:00', 30000, 9000, 3)]);
  await expect(page.locator('#flash.big')).toContainText('Objectif atteint');
  expect(errs).toEqual([]);
});

test('menu ☰ : chrono de pousse depuis la dernière plantation réussie du journal', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '64', goal: { job: 'herboriste', grow: 5 } });
  await page.goto('/?p#objectif');
  await feed(page, [xp('09:00:00', 186, 9000)], true);
  const t = new Date(Date.now() - 90e3).toTimeString().slice(0, 8), t2 = new Date(Date.now() - 60e3).toTimeString().slice(0, 8);
  await feed(page, [
    xp(t, 186, 8814), L(t, 'Vous avez perdu 1x Graine de Croton .'), // plantation réussie
    L(t2, 'Le plant n\'a pas pris.'), L(t2, 'Vous avez perdu 1x Graine de Croton .'), // échec : ignoré
  ]);
  await page.click('#menu-btn');
  await expect(page.locator('#menu-pop')).toBeVisible();
  await expect(page.locator('[data-grow="from-log"]')).toContainText(`Croton à ${t}`);
  await page.click('[data-grow-w="bad"]'); // mesure par météo défavorable
  await page.click('[data-grow="from-log"]');
  await expect(page.locator('#grow-t')).toContainText(/^1 min 3\d s$/);
  await page.click('[data-grow="s2"]');
  await page.click('[data-grow="s3"]');
  await expect(page.locator('.grow-t')).toContainText('Croton');
  await page.click('[data-grow-use="0"]');
  expect(JSON.parse(await ls(page, 'goal'))).toMatchObject({ grow: 5, growBad: 1.5 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-pop')).toBeHidden();
  expect(errs).toEqual([]);
});

test('deux PC : un journal plus ancien que la progression connue (compte) est ignoré, un compte plus ancien aussi', async ({ page }) => {
  const errs = trackErrors(page);
  const mod = new Date('2020-03-10T18:00:00').getTime();
  // progression venue du PC du boulot (via le compte) : niveau 50, mise à jour à 20:00
  await seed(page, { 'lvl.herboriste': '50', 'xp.herboriste': '1000', 'at.herboriste': String(new Date('2020-03-10T20:00:00').getTime()),
    'chat.mark': { at: new Date('2020-03-10T17:00:00').getTime() }, stock: { t: new Date('2020-03-10T20:00:00').getTime(), items: { 'Algue Narine': 50 } } });
  await page.goto('/?d#objectif');
  // journal du PC perso : s'arrête à 17:30, niveau 45 à l'époque
  await feed(page, [
    xp('16:00:00', 162, 6000), // avant le repère
    xp('17:30:00', 162, 5838), L('17:30:00', 'Vous avez ramassé 4x Algue Narine .'), // après le repère mais avant 20:00
  ], true, mod);
  expect(await ls(page, 'lvl.herboriste')).toBe('50');
  expect(await ls(page, 'xp.herboriste')).toBe('1000');
  expect(await bag(page)).toEqual({ 'Algue Narine': 50 });
  await expect(page.locator('#chat-box')).toContainText('Ignoré');
  // une nouvelle ligne en direct, elle, compte
  await feed(page, [xp('21:00:00', 186, 7000)]);
  expect(await ls(page, 'xp.herboriste')).toBe(String(7575 - 7000));
  // compte plus ancien que la progression locale : ignoré ; plus récent : appliqué
  await page.evaluate(() => window.waktool.applyState({ levels: { herboriste: 44 }, progress: { herboriste: { xp: 5, at: 1 } } }));
  expect(await ls(page, 'lvl.herboriste')).toBe('50');
  await page.evaluate(() => window.waktool.applyState({ levels: { herboriste: 52 }, progress: { herboriste: { xp: 9, at: Date.now() + 5000 } } }));
  expect(await ls(page, 'lvl.herboriste')).toBe('52');
  expect(await ls(page, 'xp.herboriste')).toBe('9');
  expect(errs).toEqual([]);
});

test('objectif : encart du niveau en cours, barre qui avance à chaque XP et repart à la montée', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '65', 'xp.herboriste': '0', 'target.herboriste': '70', goal: { job: 'herboriste' } });
  await page.goto('/?lv#objectif');
  await feed(page, [xp('10:00:00', 196, 9825 - 2729)], true); // niv. 65 : 2 729 / 9 825
  await expect(page.locator('.lvl-card')).toContainText('Niveau 65');
  await expect(page.locator('.lvl-pct')).toHaveText('27 %');
  const w = () => page.locator('.lvlbar i').evaluate(el => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
  const w0 = await w();
  await feed(page, [xp('10:00:03', 4000, 9825 - 6729)]);
  await expect(page.locator('.lvl-pct')).toHaveText('68 %');
  await expect.poll(w).toBeGreaterThan(w0 + 0.3); // la barre s'est remplie (animation)
  await feed(page, [xp('10:00:06', 4000, 9975 - 904, 1)]); // montée : 3 096 restants, 904 de trop
  await expect(page.locator('.lvl-card')).toContainText('Niveau 66');
  await expect.poll(w, { timeout: 5000 }).toBeLessThan(0.2); // repartie de zéro
  expect(errs).toEqual([]);
});

test('objectif : l’étape en cours reste verrouillée (pas de faux « Étape terminée » quand le plan se réoptimise)', async ({ page }) => {
  const errs = trackErrors(page);
  await seed(page, { 'lvl.herboriste': '57', 'xp.herboriste': '0', 'target.herboriste': '60', 'bonus.global': { region: 30 },
    goal: { job: 'herboriste', plant: true, craft: true, travel: 0, alert: 'banner' } });
  await page.goto('/?lk#objectif');
  await feed(page, [xp('10:00:00', 186, 8439)], true);
  await expect.poll(async () => (await guide(page)).kind).toBe('c');
  const k0 = (await guide(page)).key;
  // le sac change beaucoup (correction manuelle) : sans verrou, le meilleur plan pourrait changer d'étape
  await page.evaluate(() => { localStorage.setItem('waktool.stock', JSON.stringify({ t: Date.now(), items: { 'Fleur de Croton': 5000 } })); window.waktool.applyState({}); });
  await feed(page, Array.from({ length: 5 }, (_, i) => xp('10:01:0' + i, 186, 8439 - 186 * (i + 1))));
  expect((await guide(page)).key).toBe(k0);
  await expect(page.locator('#flash')).toHaveCount(0);
  // ↻ Recalculer : plan neuf, sans alerte
  await page.click('[data-g="replan"]');
  await feed(page, [xp('10:02:00', 186, 8439 - 186 * 6)]);
  await expect(page.locator('#flash')).toHaveCount(0);
  expect(errs).toEqual([]);
});
