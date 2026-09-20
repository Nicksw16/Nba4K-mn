import test from 'node:test';
import assert from 'node:assert/strict';
import { createBall, stepBall, ballisticVelocity, solveLaunchVelocity, releaseBall, backspinFor } from '../src/core/sim/ball.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { COURT, hoopPos, isThreePointShot, shotZone } from '../src/core/config/court.js';
import { v3, v2 } from '../src/core/math/vec.js';

const T = DEFAULT_TUNING;

function shootAt(fromX: number, fromY: number, fromZ: number, arc: number, side: 0 | 1, aimZOffset = 0) {
  const ball = createBall();
  const hoop = hoopPos(side);
  const target = v3(hoop.x, hoop.y, hoop.z + aimZOffset);
  const from = v3(fromX, fromY, fromZ);
  const spin = backspinFor(Math.hypot(hoop.x - fromX, hoop.y - fromY));
  const vel = solveLaunchVelocity(from, target, arc, spin, T);
  releaseBall(ball, from, vel, spin, 'shot', 'x');
  let made = false;
  let rim = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const evs = stepBall(ball, 1 / 120, T);
    for (const e of evs) {
      if (e.kind === 'made') made = true;
      if (e.kind === 'rim_hit') rim++;
    }
    if (made) break;
  }
  return { made, rim, ball };
}

test('arremesso mirado no centro do aro entra', () => {
  const r = shootAt(COURT.length - 12, COURT.width / 2, 2.1, 48, 1);
  assert.equal(r.made, true, 'deveria converter mirando no centro');
});

test('arremesso de tres do topo entra quando mirado corretamente', () => {
  const hoop = hoopPos(1);
  const fromX = hoop.x - COURT.threeArcRadius - 0.3;
  assert.equal(isThreePointShot(v2(fromX, COURT.width / 2), 1), true);
  const r = shootAt(fromX, COURT.width / 2, 2.15, 47, 1);
  assert.equal(r.made, true);
});

test('arremesso curto bate na borda frontal e nao entra', () => {
  const ball = createBall();
  const hoop = hoopPos(1);
  const from = v3(hoop.x - 6, hoop.y, 2.1);
  // Mira 30 cm curto: o centro da bola chega 7 cm a frente da borda -> contato.
  const spin = backspinFor(6);
  const vel = solveLaunchVelocity(from, v3(hoop.x - 0.30, hoop.y, hoop.z), 47, spin, T);
  releaseBall(ball, from, vel, spin, 'shot', 'x');
  let made = false;
  let rim = 0;
  for (let i = 0; i < 60 * 6; i++) {
    for (const e of stepBall(ball, 1 / 120, T)) {
      if (e.kind === 'made') made = true;
      if (e.kind === 'rim_hit') rim++;
    }
  }
  assert.ok(rim > 0, 'deveria tocar o aro');
  assert.equal(made, false);
});

test('bola quica no chao perdendo energia e assenta', () => {
  const ball = createBall();
  releaseBall(ball, v3(10, 7, 2.5), v3(0, 0, 0), v3(), 'loose', 'x');
  let bounces = 0;
  let settled = false;
  for (let i = 0; i < 120 * 20; i++) {
    for (const e of stepBall(ball, 1 / 120, T)) {
      if (e.kind === 'floor_bounce') bounces++;
      if (e.kind === 'settled') settled = true;
    }
    if (settled) break;
  }
  assert.ok(bounces >= 3, `esperava varios quiques, teve ${bounces}`);
  assert.ok(settled, 'bola deveria parar');
});

test('tabela devolve a bola para dentro da quadra', () => {
  const ball = createBall();
  const side: 0 | 1 = 1;
  const planeX = COURT.length - COURT.backboardFromBaseline;
  releaseBall(ball, v3(planeX - 1.2, COURT.width / 2 + 0.4, 3.2), v3(9, 0, 1.2), v3(), 'shot', 'x');
  let hit = false;
  for (let i = 0; i < 240; i++) {
    for (const e of stepBall(ball, 1 / 120, T)) if (e.kind === 'backboard_hit') hit = true;
    if (hit) break;
  }
  assert.ok(hit, 'deveria bater na tabela');
  assert.ok(ball.vel.x < 0, 'deveria voltar para dentro da quadra');
});

test('zonas de arremesso classificam corretamente', () => {
  const hoop = hoopPos(1);
  assert.equal(shotZone(v2(hoop.x - 1, hoop.y), 1), 'rim');
  assert.equal(shotZone(v2(hoop.x - COURT.threeArcRadius - 0.5, hoop.y), 1), 'top_three');
  assert.equal(shotZone(v2(hoop.x - 0.5, 0.6), 1), 'corner_three');
});

test('arremesso muito curto e air ball: nao toca o aro', () => {
  const ball = createBall();
  const hoop = hoopPos(1);
  const from = v3(hoop.x - 6, hoop.y, 2.1);
  const spin = backspinFor(6);
  // 60 cm curto: a bola passa a frente do aro sem encostar (air ball real).
  const vel = solveLaunchVelocity(from, v3(hoop.x - 0.6, hoop.y, hoop.z), 47, spin, T);
  releaseBall(ball, from, vel, spin, 'shot', 'x');
  let rim = 0;
  let made = false;
  for (let i = 0; i < 60 * 6; i++) {
    for (const e of stepBall(ball, 1 / 120, T)) {
      if (e.kind === 'rim_hit') rim++;
      if (e.kind === 'made') made = true;
    }
  }
  assert.equal(rim, 0);
  assert.equal(made, false);
});
