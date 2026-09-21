import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/math/rng.js';
import { MEDALS, advanceChallenges, awardFromGame, createProgression, repTier, xpForLevel } from '../src/core/career/progression.js';
import { emptyPlayerStats } from '../src/core/stats/boxscore.js';
import { rebirth } from '../src/core/model/build.js';
import { applyTakeoverEvent, takeoverState, TAKEOVER_CATEGORIES } from '../src/core/sim/takeover.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { createActor } from '../src/core/sim/actor.js';
import { makePlayer } from '../src/core/model/player.js';
import { v2 } from '../src/core/math/vec.js';
import { applyGameToCareer, createCareer, ERAS } from '../src/core/career/career.js';
import { BADGES, badgeValue, compileBadges, maxTierFor, validateLoadout } from '../src/core/model/badges.js';
import { makeAttributes } from '../src/core/model/attributes.js';

const T = DEFAULT_TUNING;

function statsFor(overrides: Partial<ReturnType<typeof emptyPlayerStats>>) {
  return { ...emptyPlayerStats('p', 'Teste', 0), secondsPlayed: 32 * 60, ...overrides };
}

test('XP vai para a trilha do que foi feito em quadra', () => {
  const state = createProgression();
  const shooter = awardFromGame(state, {
    stats: statsFor({ points: 30, fgm: 10, fga: 18, tpm: 6, tpa: 11 }),
    won: true, minutesShare: 0.9, efficiency: 0.6,
  });
  assert.ok(shooter.byTrack.shooting > shooter.byTrack.defense, 'arremessar deve alimentar a trilha de arremesso');

  const stopper = createProgression();
  const defense = awardFromGame(stopper, {
    stats: statsFor({ steals: 5, blocks: 4, deflections: 6, points: 4 }),
    won: true, minutesShare: 0.9, efficiency: 0.4,
  });
  assert.ok(defense.byTrack.defense > defense.byTrack.shooting, 'defender deve alimentar a trilha de defesa');
});

test('tokens de badge saem das trilhas, nao do nivel', () => {
  const state = createProgression();
  for (let i = 0; i < 12; i++) {
    awardFromGame(state, {
      stats: statsFor({ steals: 6, blocks: 5, deflections: 8 }),
      won: true, minutesShare: 1, efficiency: 0.5,
    });
  }
  assert.ok(state.tokens.defense > 0, 'deveria render tokens de defesa');
  assert.equal(state.tokens.shooting, 0, 'nao deveria render tokens de arremesso');
});

test('medalhas sao concedidas uma unica vez', () => {
  const state = createProgression();
  const triple = statsFor({ points: 22, assists: 11, dreb: 8, oreb: 4 });
  const first = awardFromGame(state, { stats: triple, won: true, minutesShare: 1, efficiency: 0.6 });
  const second = awardFromGame(state, { stats: triple, won: true, minutesShare: 1, efficiency: 0.6 });
  assert.ok(first.medals.includes('triple_double'));
  assert.equal(second.medals.includes('triple_double'), false, 'medalha nao se repete');
});

test('curva de nivel cresce e a reputacao tem faixas', () => {
  assert.ok(xpForLevel(10) > xpForLevel(5));
  assert.equal(repTier(0), 'Novato');
  assert.equal(repTier(100000), 'Lenda');
});

test('rebirth herda parte do progresso e diminui a cada uso', () => {
  const tokens = { shooting: 10, finishing: 8, playmaking: 6, defense: 4, rebounding: 2, physicals: 6 };
  const first = rebirth(30, tokens, 0);
  const third = rebirth(30, tokens, 3);
  assert.ok(first.carriedBadgeTokens.shooting > 0);
  assert.ok(first.startingLevel > third.startingLevel, 'cada rebirth herda menos');
});

test('takeover sobe por disciplina e cada uma e independente', () => {
  const p = makePlayer({ id: 'x', firstName: 'A', lastName: 'B', heightInches: 78, weightLbs: 210, style: 'connector_3d', attributes: {} });
  const a = createActor(p, 0, 0, v2(10, 7), T);
  applyTakeoverEvent(a, 'made3', T);
  applyTakeoverEvent(a, 'made3', T);
  assert.ok(a.takeover.shooting > 0, 'arremesso deveria carregar');
  assert.equal(a.takeover.defense, 0, 'defesa nao carrega com arremesso convertido');
  for (let i = 0; i < 12; i++) applyTakeoverEvent(a, 'steal', T);
  assert.equal(a.activeTakeover, 'defense', 'defesa deveria ativar ao encher');
});

test('estados de takeover respeitam os limiares do tuning', () => {
  assert.equal(takeoverState(0.02, T), 'frozen');
  assert.equal(takeoverState(0.2, T), 'cold');
  assert.equal(takeoverState(0.4, T), 'neutral');
  assert.equal(takeoverState(0.6, T), 'warm');
  assert.equal(takeoverState(0.85, T), 'hot');
  assert.equal(takeoverState(1, T), 'takeover');
});

test('carreira: rendimento alto aumenta minutos, rendimento baixo derruba', () => {
  const rng = new Rng('carreira');
  const good = createCareer('p1');
  const bad = createCareer('p2');
  for (let i = 0; i < 6; i++) {
    applyGameToCareer(good, statsFor({ points: 24, assists: 7, dreb: 5, secondsPlayed: 30 * 60, fgm: 9, fga: 16 }), true, 0.5, rng);
    applyGameToCareer(bad, statsFor({ points: 2, turnovers: 6, fga: 9, fgm: 1, secondsPlayed: 30 * 60, fouls: 5 }), false, 0.5, rng);
  }
  assert.ok(good.coachTrust > bad.coachTrust + 15, `confianca deveria divergir (${good.coachTrust.toFixed(0)} x ${bad.coachTrust.toFixed(0)})`);
  assert.ok(good.projectedMinutes > bad.projectedMinutes, 'quem rende recebe mais minutos');
  assert.ok(good.headlines.length > 0, 'deveria gerar manchetes a partir dos numeros');
});

test('as cinco eras existem e mudam o tuning', () => {
  assert.equal(ERAS.length, 5);
  const classic = ERAS[0];
  const modern = ERAS[ERAS.length - 1];
  assert.ok(classic.meta.threeRate < modern.meta.threeRate, 'a era antiga arremessa menos de tres');
  assert.ok(classic.meta.physicality > modern.meta.physicality, 'a era antiga e mais fisica');
  for (const era of ERAS) assert.ok(Object.keys(era.tuning).length > 0, `${era.name} deveria ajustar o tuning`);
});

test('badges: 53 no total, todas com requisito e situacao declarada', () => {
  assert.equal(BADGES.length, 53);
  for (const b of BADGES) {
    assert.ok(b.requirements.length > 0, `${b.name} sem requisito`);
    assert.ok(b.situation.length > 10, `${b.name} sem situacao descrita`);
    assert.ok(Object.keys(b.effects).length > 0, `${b.name} sem efeito`);
  }
});

test('badge exige atributo: sem o minimo o tier maximo e zero', () => {
  const weak = makeAttributes(40);
  const strong = makeAttributes(95);
  const sniper = BADGES.find((b) => b.id === 'spot_sniper')!;
  assert.equal(maxTierFor(sniper, weak), 0);
  assert.ok(maxTierFor(sniper, strong) > 0);
});

test('sinergia FUSE amplifica a badge principal', () => {
  const soloSheet = compileBadges({ spot_sniper: 3 });
  const fusedSheet = compileBadges({ spot_sniper: 3, corner_specialist: 3 });
  const solo = soloSheet['shot.catchShoot'] ?? 0;
  const fused = fusedSheet['shot.catchShoot'] ?? 0;
  assert.ok(fused > solo, `FUSE deveria amplificar (${solo.toFixed(3)} x ${fused.toFixed(3)})`);
});

test('loadout invalido e reportado com motivo', () => {
  const attrs = makeAttributes(50);
  const slots = { shooting: 1, finishing: 0, playmaking: 0, defense: 0, rebounding: 0, physicals: 0 };
  const result = validateLoadout({ spot_sniper: 3, logo_range: 2 }, attrs, slots, slots);
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
});
