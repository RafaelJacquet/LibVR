// Génère les aperçus des lieux (vignettes des cartes « Lieux ») : vue depuis le point
// d'apparition de chaque map, sans interface. Nécessite le serveur local lancé.
//   node server.mjs 8099 &   puis   node tools/previews.cjs [chromium] [playwright-core]
// Écrit le fichier `preview` de chaque entrée de MAPS (src/config.js).
const path = require('path');
const fs = require('fs');
const CHROME = process.argv[2] || path.join(process.env.HOME, '.cache/ms-playwright/chromium-1124/chrome-linux/chrome');
const PW = process.argv[3] || 'playwright-core';
const { chromium } = require(PW);
const ROOT = path.join(__dirname, '..');
const URL = 'http://localhost:8099/';

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 640 } });
  p.setDefaultTimeout(120000);
  p.on('pageerror', (e) => console.log('Erreur page :', e.message));
  await p.goto(URL);
  await p.addStyleTag({ content: '.chrome, #loader { display: none !important; }' });
  await p.waitForFunction(() => window.app && window.app.env.current, null, { timeout: 120000 });
  const maps = await p.evaluate(() => app.places.cards.map((c) => ({ id: c.map.id, preview: c.map.preview })));
  for (let i = 0; i < maps.length; i++) {
    if (i > 0) {
      await p.evaluate((k) => app.goTo(app.places.cards[k].map), i);
      await p.waitForFunction((k) => app.mode === 'scene' && app.places.currentId === app.places.cards[k].map.id, i);
    }
    // vue légèrement plongeante, sans message d'accueil ni bouton « regard »
    await p.evaluate(() => {
      app.hint.hide(); app.hint.root.visible = false; app.gaze.root.scale.setScalar(0.0001);
      app.desktop.yaw = 0.35; app.desktop.pitch = 0.12;
    });
    await p.waitForTimeout(4000);
    await p.evaluate(() => { app.hint.root.visible = false; });
    const out = path.join(ROOT, maps[i].preview);
    await p.screenshot({ path: out, type: 'jpeg', quality: 86, timeout: 120000, clip: { x: 0, y: 0, width: 960, height: 640 } });
    console.log('→', path.relative(ROOT, out), Math.round(fs.statSync(out).size / 1024), 'Ko');
  }
  await b.close();
})();
