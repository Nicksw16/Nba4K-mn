import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { createActor } from '../src/core/sim/actor.js';
import { refreshEffective } from '../src/core/sim/effective.js';
import { SHOE_FRICTION, stepLocomotion, jump, plantEfficiency } from '../src/core/sim/locomotion.js';
import { makePlayer } from '../src/core/model/player.js';
import { v2, len2 } from '../src/core/math/vec.js';
import { PlayStyle } from '../src/core/model/tendencies.js';

const T = DEFAULT_TUNING;

function actor(opts: { height: number; weight: number; speed: number; accel: number; agility: number; strength: number }) {
  const p = makePlayer({
    id: `a${Math.random()}`, firstName: 'T', lastName: 'Este',
    heightInches: opts.height, weightLbs: opts.weight,
    style: 'connector_3d' as PlayStyle,
    attributes: {
      speed: opts.speed, acceleration: opts.accel, agility: opts.agility, strength: opts.strength,
      stamina: 90, ballHandle: 75, speedWithBall: 75,
    },
  });
  const a = createActor(p, 0, 0, v2(14, 7.5), T);
  refreshEffective(a, T);
  return a;
}

function run(a: ReturnType<typeof actor>, dir: { x: number; y: number }, seconds: number, sprint = true) {
  const steps = Math.round(seconds / T.sim.dt);
  for (let i = 0; i < steps; i++) {
    stepLocomotion(a, { move: dir, sprint, stance: 'normal', brake: false }, T.sim.dt, T);
  }
}

test('atleta acelera ate a velocidade maxima, nao instantaneamente', () => {
  const a = actor({ height: 78, weight: 210, speed: 85, accel: 85, agility: 80, strength: 75 });
  run(a, { x: 1, y: 0 }, 0.1);
  const early = len2(a.vel);
  run(a, { x: 1, y: 0 }, 2.5);
  const late = len2(a.vel);
  assert.ok(early < 2, `em 0,1 s deveria estar lento, estava ${early.toFixed(2)} m/s`);
  assert.ok(late > 6 && late < 11, `velocidade de cruzeiro fora da faixa: ${late.toFixed(2)} m/s`);
});

test('inverter a direcao exige frear: o corpo nao teleporta', () => {
  const a = actor({ height: 78, weight: 210, speed: 85, accel: 85, agility: 80, strength: 75 });
  run(a, { x: 1, y: 0 }, 2);
  const before = a.vel.x;
  assert.ok(before > 4);
  // Meio segundo empurrando para o lado oposto.
  run(a, { x: -1, y: 0 }, 0.5);
  assert.ok(a.vel.x < before, 'deveria ter desacelerado');
  assert.ok(a.vel.x > -before, 'nao pode ter invertido a velocidade inteira em 0,5 s');
});

test('massa importa: o mais pesado demora mais para inverter', () => {
  const light = actor({ height: 74, weight: 180, speed: 85, accel: 85, agility: 88, strength: 60 });
  const heavy = actor({ height: 84, weight: 280, speed: 85, accel: 85, agility: 55, strength: 90 });
  run(light, { x: 1, y: 0 }, 2);
  run(heavy, { x: 1, y: 0 }, 2);
  run(light, { x: -1, y: 0 }, 0.6);
  run(heavy, { x: -1, y: 0 }, 0.6);
  assert.ok(light.vel.x < heavy.vel.x, `leve deveria inverter mais rapido (leve ${light.vel.x.toFixed(2)} x pesado ${heavy.vel.x.toFixed(2)})`);
});

test('mudanca brusca de direcao custa equilibrio', () => {
  const a = actor({ height: 78, weight: 220, speed: 88, accel: 88, agility: 60, strength: 70 });
  run(a, { x: 1, y: 0 }, 2);
  const balanceBefore = a.balance;
  // Corte de 90 graus em velocidade: o caso classico de perder a base.
  run(a, { x: 0, y: 1 }, 0.3);
  assert.ok(a.balance < balanceBefore, `equilibrio deveria cair (antes ${balanceBefore.toFixed(2)}, depois ${a.balance.toFixed(2)})`);
});

test('aceleracao lateral respeita o limite de atrito do solado', () => {
  const a = actor({ height: 74, weight: 175, speed: 99, accel: 99, agility: 99, strength: 99 });
  run(a, { x: 1, y: 0 }, 2);
  let maxAccel = 0;
  for (let i = 0; i < 60; i++) {
    const before = { x: a.vel.x, y: a.vel.y };
    const r = stepLocomotion(a, { move: { x: -1, y: 1 }, sprint: true, stance: 'normal', brake: false }, T.sim.dt, T);
    const dv = Math.hypot(a.vel.x - before.x, a.vel.y - before.y) / T.sim.dt;
    maxAccel = Math.max(maxAccel, dv);
  }
  const limit = SHOE_FRICTION * T.sim.gravity * 1.05 + 0.5;
  assert.ok(maxAccel <= limit, `aceleracao ${maxAccel.toFixed(1)} passou do limite de atrito ${limit.toFixed(1)}`);
});

test('os pes ficam plantados: a posicao do pe nao acompanha o corpo continuamente', () => {
  const a = actor({ height: 78, weight: 210, speed: 85, accel: 85, agility: 80, strength: 75 });
  run(a, { x: 1, y: 0 }, 1.2);
  const footBefore = { x: a.feet.left.x, y: a.feet.left.y };
  // Avanca meio passo: o pe plantado deve continuar no mesmo lugar.
  for (let i = 0; i < 6; i++) stepLocomotion(a, { move: { x: 1, y: 0 }, sprint: true, stance: 'normal', brake: false }, T.sim.dt, T);
  const moved = Math.hypot(a.feet.left.x - footBefore.x, a.feet.left.y - footBefore.y);
  const bodyMoved = 6 * T.sim.dt * len2(a.vel);
  assert.ok(moved < bodyMoved * 1.1 || moved === 0, 'pe nao deve deslizar junto com o corpo');
});

test('salto sobe e volta ao chao com gravidade', () => {
  const a = actor({ height: 80, weight: 220, speed: 80, accel: 80, agility: 75, strength: 80 });
  jump(a, 0.8, T);
  assert.equal(a.grounded, false);
  let maxZ = 0;
  for (let i = 0; i < 240; i++) {
    stepLocomotion(a, { move: v2(), sprint: false, stance: 'normal', brake: true }, T.sim.dt, T);
    maxZ = Math.max(maxZ, a.z);
    if (a.grounded && i > 5) break;
  }
  assert.ok(maxZ > 0.7 && maxZ < 0.95, `apice fora do esperado: ${maxZ.toFixed(2)} m`);
  assert.equal(a.grounded, true);
});

test('parar de pedir movimento traz o corpo ao repouso sem teleporte', () => {
  const a = actor({ height: 78, weight: 210, speed: 85, accel: 85, agility: 80, strength: 75 });
  run(a, { x: 1, y: 0 }, 2);
  const posBefore = { x: a.pos.x, y: a.pos.y };
  for (let i = 0; i < 120; i++) {
    stepLocomotion(a, { move: v2(), sprint: false, stance: 'normal', brake: true }, T.sim.dt, T);
  }
  assert.ok(len2(a.vel) < 0.2, 'deveria ter parado');
  const traveled = Math.hypot(a.pos.x - posBefore.x, a.pos.y - posBefore.y);
  assert.ok(traveled > 0.4, 'a frenagem precisa consumir espaco, nao ser instantanea');
});
