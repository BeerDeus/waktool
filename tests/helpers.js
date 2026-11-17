// Outils partagés par les tests
const fs = require('fs');
const path = require('path');

// erreurs JS de la page (on ignore le réseau externe : Firebase/Google peuvent être indisponibles en CI)
function trackErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/gstatic|googleapis|firebase|ERR_|Failed to load resource/i.test(m.text())) errs.push(m.text());
  });
  return errs;
}

// état de départ : localStorage vide + valeurs données (clés sans le préfixe « waktool. »)
async function seed(page, values = {}) {
  await page.goto('/');
  await page.evaluate(v => {
    localStorage.clear();
    for (const [k, x] of Object.entries(v)) localStorage.setItem('waktool.' + k, typeof x === 'string' ? x : JSON.stringify(x));
  }, values);
}

// importe un module ES du site dans la page (même version que celle chargée par index.html)
async function mod(page, name) {
  return page.evaluateHandle(async n => {
    const src = document.querySelector('script[src*="assets/js/main.js"]').src;
    return import(src.replace('main.js', n + '.js'));
  }, name);
}

// colle une image (comme Ctrl+V) et attend la fenêtre de résultat
async function pasteImage(page, file) {
  const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', file)).toString('base64');
  await page.evaluate(b => {
    const bin = Uint8Array.from(atob(b), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'capture.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, b64);
  await page.waitForSelector('#imp-ok', { timeout: 90_000 });
}

module.exports = { trackErrors, seed, mod, pasteImage };
