import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { DEFAULT_SLIDERS } from '../src/core/config/sliders.js';
import { Rng } from '../src/core/math/rng.js';
import { createActor } from '../src/core/sim/actor.js';
import { refreshEffective } from '../src/core/sim/effective.js';
import { makePlayer } from '../src/core/model/player.js';
import { v2, v3 } from '../src/core/math/vec.js';
import { resolveContacts } from '../src/core/sim/contact.js';
import { startDribbleMove, resolveBreakPoint } from '../src/core/sim/dribble.js';
import { buildAttempt, computeContest, evaluateTiming, greenWindow, shotProbability } from '../src/core/sim/shooting.js';
import { evaluateBuild, BUILD_BUDGET } from '../src/core/model/build.js';
import { contestRebound } from '../src/core/sim/rebounding.js';
import { judgeContact } from '../src/core/sim/fouls.js';
import { compileBadges } from '../src/core/model/badges.js';
import { Attributes } from '../src/core/model/attributes.js';

const T = DEFAULT_TUNING;

function mk(id: string, team: 0 | 1, pos: { x: number; y: number }, attrs: Partial<Attributes> = {}, h = 78, w = 210) {
  const p = makePlayer({
    id, firstName: 'A', lastName: id, heightInches: h, weightLbs: w,
    style: 'connector_3d', attributes: { speed: 78, acceleration: 78, agility: 78, strength: 75, stamina: 90, ...attrs },
  });
  const a = createActor(p, team, 0, v2(pos.x, pos.y), T);
  refreshEffective(a, T);
  return a;
}

test('dois corpos nunca se atravessam', () => {
  const a = mk('a', 0, { x: 10, y: 7.5 });
  const b = mk('b', 1, { x: 10.15, y: 7.5 });
  a.vel = v2(4, 0);
  b.vel = v2(-4, 0);
  for (let i = 0; i < 40; i++) resolveContacts([a, b], T.sim.dt, T);
  const dist = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
  const min = (a.physics.radius + b.physics.radius) * 0.9;
  assert.ok(dist >= min - 0.02, `corpos sobrepostos: ${dist.toFixed(3)} m (minimo ${min.toFixed(3)})`);
});

test('no contato, o mais leve cede mais terreno', () => {
  const light = mk('leve', 0, { x: 10, y: 7.5 }, { strength: 55 }, 74, 175);
  const heavy = mk('pesado', 1, { x: 10.3, y: 7.5 }, { strength: 92 }, 84, 285);
  const lightStart = light.pos.x;
  const heavyStart = heavy.pos.x;
  light.vel = v2(3, 0);
  heavy.vel = v2(-3, 0);
  for (let i = 0; i < 30; i++) resolveContacts([light, heavy], T.sim.dt, T);
  const lightMoved = Math.abs(light.pos.x - lightStart);
  const heavyMoved = Math.abs(heavy.pos.x - heavyStart);
  assert.ok(lightMoved > heavyMoved, `leve deveria ceder mais (leve ${lightMoved.toFixed(3)} x pesado ${heavyMoved.toFixed(3)})`);
});

test('ankle breaker nao acontece contra defensor que nao se comprometeu', () => {
  const rng = new Rng('ankle');
  const attacker = mk('atacante', 0, { x: 10, y: 7.5 }, { ballHandle: 95, agility: 92, speedWithBall: 90 });
  const defender = mk('defensor', 1, { x: 11, y: 7.5 }, { lateralQuickness: 85, agility: 85 });
  attacker.hasBall = true;
  defender.weightShift = v2(0, 0); // parado, sem peso comprometido
  defender.vel = v2(0, 0);
  startDribbleMove(attacker, 'crossover', 1, v2(1, 0), T, rng);
  const result = resolveBreakPoint(attacker, defender, T);
  assert.equal(result.broken, false, 'sem compromisso de peso nao existe quebra');
  assert.ok(result.leverage < 0.2, `alavancagem deveria ser baixa: ${result.leverage.toFixed(2)}`);
});

test('ankle breaker acontece quando o defensor comprometeu o peso ao contrario', () => {
  const rng = new Rng('ankle2');
  let broke = 0;
  for (let i = 0; i < 40; i++) {
    const attacker = mk(`at${i}`, 0, { x: 10, y: 7.5 }, { ballHandle: 97, agility: 95, speedWithBall: 92 });
    const defender = mk(`df${i}`, 1, { x: 10.9, y: 7.5 }, { lateralQuickness: 55, agility: 55, discipline: 50 });
    attacker.hasBall = true;
    // O defensor jogou o peso para a ESQUERDA; o move sai para a direita.
    defender.weightShift = v2(0, -0.95);
    defender.vel = v2(0, -3.4);
    defender.balance = 0.55;
    startDribbleMove(attacker, 'misdirection_crossover', 1, v2(0, 1), T, rng);
    const result = resolveBreakPoint(attacker, defender, T);
    if (result.broken) broke++;
  }
  assert.ok(broke > 20, `com o peso comprometido a quebra deveria ser comum: ${broke}/40`);
});

test('badge de catch-and-shoot nao melhora arremesso apos drible', () => {
  const shooter = mk('atirador', 0, { x: 20, y: 7.5 }, { threePoint: 88, midRange: 85, shotIQ: 80 });
  shooter.profile.badges = { spot_sniper: 3 };
  shooter.badgeSheet = compileBadges(shooter.profile.badges);
  refreshEffective(shooter, T);
  const timing = evaluateTiming(0.5, 0.5, 0.08, 0.8);
  const noContest = { total: 0, proximity: 0, hand: 0, height: 0, timing: 0, closing: 0, label: 'aberto' as const };
  const ctx = { clutch: false, lead: 0, userControlled: false, successMultiplier: 1 };

  const cns = shotProbability(buildAttempt(shooter, 1, 'catch_and_shoot'), timing, noContest, T, ctx);
  const pullup = shotProbability(buildAttempt(shooter, 1, 'pullup'), timing, noContest, T, ctx);
  assert.ok(cns.badge > 0, 'catch-and-shoot deveria receber o bonus da badge');
  assert.equal(pullup.badge, 0, 'pull-up nao pode receber bonus de badge de catch-and-shoot');
});

test('marcacao reduz a chance e encolhe a janela verde', () => {
  const shooter = mk('s', 0, { x: 20, y: 7.5 }, { threePoint: 85, shotIQ: 80 });
  const attempt = buildAttempt(shooter, 1, 'set');
  const timing = evaluateTiming(0.5, 0.5, 0.08, 0.8);
  const open = { total: 0, proximity: 0, hand: 0, height: 0, timing: 0, closing: 0, label: 'aberto' as const };
  const heavy = { total: 0.8, proximity: 0.9, hand: 0.8, height: 0.6, timing: 0.9, closing: 0.7, label: 'total' as const };
  const ctx = { clutch: false, lead: 0, userControlled: false, successMultiplier: 1 };

  const pOpen = shotProbability(attempt, timing, open, T, ctx).final;
  const pHeavy = shotProbability(attempt, timing, heavy, T, ctx).final;
  assert.ok(pOpen > pHeavy + 0.15, `marcacao pesada deveria derrubar a chance (${pOpen.toFixed(2)} x ${pHeavy.toFixed(2)})`);

  const wOpen = greenWindow(shooter, attempt, 0, 0.8, T);
  const wHeavy = greenWindow(shooter, attempt, 0.8, 0.8, T);
  assert.ok(wHeavy < wOpen, `janela deveria encolher sob marcacao (${wOpen.toFixed(3)} x ${wHeavy.toFixed(3)})`);
});

test('timing ruim custa mais do que marcacao leve', () => {
  const shooter = mk('s2', 0, { x: 20, y: 7.5 }, { threePoint: 85 });
  const attempt = buildAttempt(shooter, 1, 'set');
  const open = { total: 0, proximity: 0, hand: 0, height: 0, timing: 0, closing: 0, label: 'aberto' as const };
  const ctx = { clutch: false, lead: 0, userControlled: false, successMultiplier: 1 };
  const perfect = shotProbability(attempt, evaluateTiming(0.5, 0.5, 0.08, 0.9), open, T, ctx).final;
  const bad = shotProbability(attempt, evaluateTiming(0.85, 0.5, 0.08, 0.3), open, T, ctx).final;
  assert.ok(perfect > bad + 0.1, `timing deveria importar (${perfect.toFixed(2)} x ${bad.toFixed(2)})`);
});

test('distancia derruba a chance progressivamente', () => {
  const near = mk('near', 0, { x: 22, y: 7.5 }, { threePoint: 80, midRange: 80, closeShot: 80 });
  const far = mk('far', 0, { x: 13, y: 7.5 }, { threePoint: 80, midRange: 80, closeShot: 80 });
  const timing = evaluateTiming(0.5, 0.5, 0.08, 0.8);
  const open = { total: 0, proximity: 0, hand: 0, height: 0, timing: 0, closing: 0, label: 'aberto' as const };
  const ctx = { clutch: false, lead: 0, userControlled: false, successMultiplier: 1 };
  const pNear = shotProbability(buildAttempt(near, 1, 'set'), timing, open, T, ctx).final;
  const pFar = shotProbability(buildAttempt(far, 1, 'set'), timing, open, T, ctx).final;
  assert.ok(pNear > pFar, `mais perto deveria ser mais provavel (${pNear.toFixed(2)} x ${pFar.toFixed(2)})`);
});

test('builder: o pivo alto paga mais caro por controle de bola', () => {
  const base = {
    name: { first: 'A', last: 'B' }, style: 'connector_3d' as const,
    targets: { ballHandle: 85 } as Partial<Attributes>,
  };
  const guard = evaluateBuild({ ...base, position: 'PG', heightInches: 74, weightLbs: 185, wingspanInches: 77 });
  const big = evaluateBuild({ ...base, position: 'C', heightInches: 85, weightLbs: 265, wingspanInches: 90 });
  const guardCost = guard.perAttributeCost.ballHandle ?? 0;
  const bigCost = big.perAttributeCost.ballHandle ?? 0;
  assert.ok(bigCost > guardCost * 1.3, `pivo deveria pagar bem mais (armador ${guardCost}, pivo ${bigCost})`);
  const guardBlock = guard.perAttributeCost.block ?? 0;
  const bigBlock = big.perAttributeCost.block ?? 0;
  assert.ok(bigBlock <= guardBlock, 'pivo deveria pagar menos por toco');
});

test('builder respeita o orcamento e reporta o estouro', () => {
  const maxed = evaluateBuild({
    name: { first: 'A', last: 'B' }, position: 'SF', heightInches: 79, weightLbs: 215, wingspanInches: 83,
    style: 'connector_3d',
    targets: Object.fromEntries((Object.keys(evaluateBuild({
      name: { first: 'A', last: 'B' }, position: 'SF', heightInches: 79, weightLbs: 215, wingspanInches: 83,
      style: 'connector_3d', targets: {},
    }).attributes) as (keyof Attributes)[]).map((k) => [k, 99])) as Partial<Attributes>,
  });
  assert.ok(maxed.spent > BUILD_BUDGET, 'tudo em 99 tem que estourar o orcamento');
  assert.equal(maxed.ok, false);
  assert.ok(maxed.problems.length > 0);
});

test('a defesa vence a maioria dos rebotes, como na realidade', () => {
  const rng = new Rng('reb');
  let defensive = 0;
  const total = 300;
  for (let i = 0; i < total; i++) {
    const spot = v2(24 + rng.range(-1.5, 1.5), 7.5 + rng.range(-2, 2));
    const players = [
      mk(`o1${i}`, 0, { x: spot.x - 1.2, y: spot.y + 0.6 }, { offensiveRebound: 75, defensiveRebound: 70, vertical: 78 }, 82, 240),
      mk(`o2${i}`, 0, { x: spot.x - 2.4, y: spot.y - 1.2 }, { offensiveRebound: 70, defensiveRebound: 65, vertical: 74 }, 80, 225),
      mk(`d1${i}`, 1, { x: spot.x + 0.9, y: spot.y - 0.4 }, { defensiveRebound: 78, offensiveRebound: 62, vertical: 76 }, 83, 245),
      mk(`d2${i}`, 1, { x: spot.x + 1.8, y: spot.y + 1.1 }, { defensiveRebound: 72, offensiveRebound: 58, vertical: 72 }, 81, 230),
    ];
    const result = contestRebound(players, spot, 1.6, 1, new Map(), T, rng);
    if (result.winner && result.winner.team === 1) defensive++;
  }
  const rate = defensive / total;
  assert.ok(rate > 0.6 && rate < 0.9, `taxa de rebote defensivo fora do esperado: ${(rate * 100).toFixed(1)}%`);
});

test('quem ataca com a bola nao recebe falta de bloqueio', () => {
  const rng = new Rng('foul');
  const driver = mk('driver', 0, { x: 22, y: 7.5 });
  const defender = mk('def', 1, { x: 22.8, y: 7.5 });
  driver.hasBall = true;
  driver.vel = v2(5, 0);
  defender.vel = v2(-2.5, 0);
  let blockingOnDriver = 0;
  for (let i = 0; i < 300; i++) {
    const foul = judgeContact({
      a: driver, b: defender, type: 'chest', severity: 0.45,
      normal: v2(1, 0), closingSpeed: 7.5, aggressorIsA: true, frontality: 0.3, mutual: false,
    }, T, rng, { shooting: false, foulTolerance: 0.5 });
    if (foul && foul.kind === 'blocking' && foul.byId === driver.id) blockingOnDriver++;
  }
  assert.equal(blockingOnDriver, 0, 'atacante com a bola nunca comete falta de bloqueio');
});
