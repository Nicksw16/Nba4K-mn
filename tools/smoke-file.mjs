/**
 * Testa o arquivo unico aberto direto do disco (file://), que e o que
 * acontece quando a pessoa da dois cliques. Sem servidor nenhum.
 */
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const errors = [];
const requests = [];
const file = pathToFileURL(resolve(import.meta.dirname, '..', 'COURTSIDE-LEGACY.html')).href;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// Qualquer requisicao alem do proprio arquivo quebra o "abrir offline".
page.on('request', (r) => { if (r.url() !== file) requests.push(r.url()); });

console.log('abrindo:', file);
await page.goto(file);
await page.waitForTimeout(1500);

console.log('titulo:', await page.textContent('.brand h1'));
const menu = await page.$$eval('.card h3', (n) => n.map((x) => x.textContent));
console.log('menu:', menu.join(' | '));

// Partida completa
await page.click('text=Partida rapida');
await page.waitForTimeout(400);
await page.click('text=Iniciar partida');
await page.waitForTimeout(5000);
const state = await page.evaluate(() => {
  const s = window.courtside.sim;
  return { tela: window.courtside.screen, fase: s?.phase, relogio: s?.clock?.toFixed(1), eventos: s?.events.all().length };
});
console.log('partida:', JSON.stringify(state));
await page.screenshot({ path: '/tmp/claude-0/f-game.png' });

// Builder (usa evaluateBuild)
await page.evaluate(() => window.courtside.go('builder'));
await page.waitForTimeout(500);
const badges = await page.$$eval('.badge b', (n) => n.length);
console.log('builder: badges listadas =', badges);

// Franquia (simula dias)
await page.evaluate(() => window.courtside.go('franchise'));
await page.waitForTimeout(300);
await page.click('text=Comecar temporada');
await page.waitForTimeout(700);
await page.click('text=Simular 7 dias');
await page.waitForTimeout(1200);
const row = await page.$$eval('table tbody tr td', (n) => n.slice(0, 5).map((x) => x.textContent));
console.log('franquia:', row.join(' '));

// Carreira: usa import() dinamico — o ponto que um bundle pode quebrar.
await page.evaluate(() => window.courtside.go('career'));
await page.waitForTimeout(400);
const careerOk = await page.$$eval('.panel h2', (n) => n.map((x) => x.textContent).join(' | '));
console.log('carreira:', careerOk);

// Salvamento em file:// (origem opaca costuma bloquear localStorage)
const saveOk = await page.evaluate(() => {
  try {
    window.courtside.saveSettings();
    return 'ok';
  } catch (e) { return `falhou: ${e.message}`; }
});
console.log('salvar ajustes:', saveOk);

await browser.close();
console.log('requisicoes externas:', requests.length === 0 ? 'nenhuma (100% offline)' : requests.join(', '));
console.log(errors.length ? `ERROS:\n${errors.join('\n')}` : 'sem erros de console');
