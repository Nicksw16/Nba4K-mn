/**
 * Teste de fumaca em celular: viewport pequeno, toque emulado, controles.
 * Requer `npm run serve` rodando e playwright-core instalado.
 */
import { chromium, devices } from 'playwright-core';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
// Celular deitado, como o jogo pede.
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://127.0.0.1:8081/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const mobileDetected = await page.evaluate(() => window.courtside.isMobile);
console.log('detectou celular:', mobileDetected);
await page.screenshot({ path: '/tmp/claude-0/m-menu.png' });

// Entrar em partida rapida
await page.tap('text=Partida rapida');
await page.waitForTimeout(400);
await page.tap('text=Iniciar partida');
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/claude-0/m-game.png' });

const controls = await page.evaluate(() => {
  const layer = document.querySelector('.touch-layer');
  const visible = layer && getComputedStyle(layer).display !== 'none';
  const btns = [...document.querySelectorAll('.touch-btn')]
    .filter((b) => !b.hidden)
    .map((b) => b.textContent.trim());
  return { visible, btns, mode: window.courtside.touch.mode };
});
console.log('controles visiveis:', controls.visible, '| modo:', controls.mode, '| botoes:', controls.btns.join(' '));

// Espera a bola ficar viva: em bola morta o atleta anda sozinho ate a posicao
// e o comando do usuario nao vale, entao medir ali nao diz nada.
await page.waitForFunction(() => window.courtside.sim?.phase === 'live', null, { timeout: 15000 });

// Analogico flutuante: aparece enquanto o dedo esta na tela (nao depois).
const before = await page.evaluate(() => {
  const a = window.courtside.sim.userActor();
  return a ? { x: a.pos.x, y: a.pos.y } : null;
});
const stickShown = await page.evaluate(() => {
  const layer = document.querySelector('.touch-layer');
  const send = (type, x, y) => layer.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch',
  }));
  send('pointerdown', 180, 260);
  send('pointermove', 260, 260);
  return !document.querySelector('.touch-stick').hidden;
});
console.log('analogico apareceu com o dedo na tela:', stickShown);
await page.waitForTimeout(1200);
const after = await page.evaluate(() => {
  const a = window.courtside.sim.userActor();
  return a ? { x: a.pos.x, y: a.pos.y, speed: Math.hypot(a.vel.x, a.vel.y) } : null;
});
const moved = before && after ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
console.log(`atleta andou ${moved.toFixed(2)} m com o analogico (velocidade ${after?.speed.toFixed(2)} m/s)`);
if (moved < 1) errors.push(`analogico nao moveu o atleta: ${moved.toFixed(2)} m`);

// Arremesso: pressionar ARR, arrastar para baixo, soltar
await page.evaluate(() => window.courtside.touch.setMode('offense'));
const shootBox = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.touch-btn')].find((x) => x.textContent.trim() === 'ARR' && !x.hidden);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
// Garante contexto de ataque para testar o arremesso.
await page.evaluate(() => window.courtside.touch.setMode('offense'));
await page.waitForTimeout(80);
if (shootBox) {
  const meter = await page.evaluate(({ x, y }) => {
    const layer = document.querySelector('.touch-layer');
    const send = (type, cx, cy) => layer.dispatchEvent(new PointerEvent(type, {
      pointerId: 2, clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerType: 'touch',
    }));
    send('pointerdown', x, y);
    send('pointermove', x, y + 70);
    return true;
  }, shootBox);
  await page.waitForTimeout(260);
  // O HUD so mostra o medidor quando o atleta controlado esta com a bola.
  // Aqui checamos o COMANDO gerado pelo toque, que e o que o motor consome.
  const shot = await page.evaluate(() => {
    const cmd = { move: { x: 0, y: 0 }, sprint: false, shootStick: 0, shootHeld: false, shootReleased: false,
      passRequested: false, lobRequested: false, driveRequested: false, stealRequested: false,
      blockRequested: false, postUp: false, callScreen: false, switchPlayer: false, timeout: false, intentionalFoul: false };
    window.courtside.touch.apply(cmd, 0.016);
    return { stick: cmd.shootStick, held: cmd.shootHeld };
  });
  console.log(`arremesso: shootStick=${shot.stick.toFixed(2)} segurando=${shot.held}`);
  if (!(shot.stick > 0.4 && shot.held)) errors.push(`arrastar ARR nao carregou o arremesso: ${shot.stick}`);
  await page.screenshot({ path: '/tmp/claude-0/m-shot.png' });
}

await browser.close();
console.log(errors.length ? `ERROS:\n${errors.join('\n')}` : 'sem erros de console');
