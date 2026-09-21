/**
 * Celular, no arquivo unico aberto do disco. Checa o que realmente quebrou em
 * uso: a acao principal fora do alcance do polegar, rolagem dentro de rolagem
 * e botao de toque colado na borda da tela.
 */
import { chromium, devices } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const file = pathToFileURL(resolve(import.meta.dirname, '..', 'COURTSIDE-LEGACY.html')).href;
const TELAS = [
  ['iPhone SE deitado', 667, 375],
  ['iPhone 12 deitado', 844, 390],
  ['Android comum', 800, 360],
  ['tablet deitado', 1024, 768],
];
const MENUS = ['main', 'builder', 'franchise', 'career', 'practice', 'settings', 'controls'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const falhas = [];

for (const [nome, w, h] of TELAS) {
  const ctx = await browser.newContext({ ...devices['iPhone 12'], viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => falhas.push(`${nome}: erro de pagina ${e.message}`));
  await page.goto(file);
  await page.waitForTimeout(1200);

  // 1. Uma unica superficie de rolagem por tela. Duas e o gesto vira loteria.
  for (const t of MENUS) {
    await page.evaluate((x) => window.courtside.go(x), t);
    await page.waitForTimeout(350);
    const n = await page.evaluate(() => [...document.querySelectorAll('#ui *')].filter((e) => {
      const c = getComputedStyle(e);
      return /auto|scroll/.test(c.overflowY) && e.scrollHeight > e.clientHeight + 1;
    }).length);
    if (n > 1) falhas.push(`${nome}/${t}: ${n} superficies de rolagem aninhadas`);
  }

  // 2. A barra de acao da tela tem que estar visivel SEM rolar.
  await page.evaluate(() => window.courtside.go('main'));
  await page.waitForTimeout(300);
  await page.tap('text=Partida rapida');
  await page.waitForTimeout(400);
  const fora = await page.evaluate(() => [...document.querySelectorAll('.screen > .toolbar button')]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.top < 0 || r.bottom > innerHeight; })
    .map((b) => (b.textContent || '').trim()));
  if (fora.length) falhas.push(`${nome}: acao fora da tela -> ${fora.join(', ')}`);

  // 3. O toque tem que iniciar a partida de verdade.
  await page.tap('text=Iniciar partida');
  await page.waitForTimeout(2500);
  const tela = await page.evaluate(() => window.courtside?.screen);
  if (tela !== 'game') falhas.push(`${nome}: toque em "Iniciar partida" nao iniciou (tela=${tela})`);

  // 4. Botao de toque colado na borda cai na faixa de gestos do sistema.
  const colados = await page.evaluate(() => [...document.querySelectorAll('.touch-btn:not([hidden])')]
    .map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || '').trim(), d: Math.round(innerWidth - r.right), b: Math.round(innerHeight - r.bottom) }; })
    .filter((x) => x.d < 10 || x.b < 10));
  if (colados.length) falhas.push(`${nome}: botoes colados na borda -> ${colados.map((c) => c.t).join(', ')}`);

  console.log(`${nome.padEnd(20)} ${w}x${h} verificado`);
  await ctx.close();
}

await browser.close();
if (falhas.length) {
  console.error('\nFALHOU:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nCelular ok: uma rolagem por tela, acao ao alcance, toque inicia partida, botoes longe da borda.');
