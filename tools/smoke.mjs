/**
 * Teste de fumaca do cliente no navegador.
 * Requer: npm i -D playwright-core e um Chromium local.
 *   node tools/smoke.mjs  (com `npm run serve` rodando em outra aba)
 */
import { chromium } from 'playwright-core';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const title = await page.textContent('.brand h1');
console.log('titulo:', title);
const cards = await page.$$eval('.card h3', (n) => n.map((x) => x.textContent));
console.log('menu:', cards.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/shot-menu.png' });

// Abrir partida rapida e iniciar o jogo
await page.click('text=Partida rapida');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/claude-0/shot-quickplay.png' });
await page.click('text=Iniciar partida');
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/claude-0/shot-game.png' });

const state = await page.evaluate(() => {
  const app = window.courtside;
  return {
    screen: app.screen,
    phase: app.sim?.phase,
    period: app.sim?.period,
    clock: app.sim?.clock,
    score: app.sim ? [app.sim.score(0), app.sim.score(1)] : null,
    events: app.sim?.events.all().length,
  };
});
console.log('estado do jogo:', JSON.stringify(state));

// Builder
await page.evaluate(() => window.courtside.go('builder'));
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/claude-0/shot-builder.png' });
const budget = await page.textContent('.panel .value');
console.log('builder ok, orcamento:', budget);

// Franquia
await page.evaluate(() => window.courtside.go('franchise'));
await page.waitForTimeout(400);
await page.click('text=Comecar temporada');
await page.waitForTimeout(800);
await page.click('text=Simular 7 dias');
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/claude-0/shot-franchise.png' });
const standings = await page.$$eval('table tbody tr td', (n) => n.slice(0, 7).map((x) => x.textContent));
console.log('classificacao (linha 1):', standings.join(' '));

await browser.close();
console.log(errors.length ? `ERROS:\n${errors.join('\n')}` : 'sem erros de console');
