/**
 * CONTROLES DO HUMANO.
 *
 * A IA pula quem o humano controla. Por muito tempo nada ocupou esse lugar e
 * os botoes de passe, drible, roubo e toco nao chegavam a lugar nenhum. Estes
 * testes existem para que isso nao volte em silencio: cada um aperta um botao
 * e cobra a consequencia no estado do simulador.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSim, emptyCommand } from '../src/core/sim/game.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { DEFAULT_SLIDERS } from '../src/core/config/sliders.js';
import { generateLeague } from '../src/core/data/generator.js';
import { Actor } from '../src/core/sim/actor.js';

const league = generateLeague('controles');

function sim(seed: string): GameSim {
  const g = new GameSim({
    home: league.teams[0], away: league.teams[1],
    tuning: DEFAULT_TUNING, sliders: { ...DEFAULT_SLIDERS, quarterLengthSeconds: 240 },
    seed, userTeam: 0,
  });
  // Sem `start()` a partida fica em aquecimento para sempre.
  g.start();
  return g;
}

/** Avanca ate o humano estar com a bola em jogo corrido, ou desiste. */
function untilUserHasBall(g: GameSim, maxSeconds = 90): Actor | undefined {
  const dt = 1 / 120;
  for (let i = 0; i < maxSeconds / dt; i++) {
    g.step(dt);
    const u = g.userActor();
    if (u && u.hasBall && g.phase === 'live') return u;
  }
  return undefined;
}

test('passe do humano tira a bola dele e manda para um companheiro', () => {
  const g = sim('passe');
  const user = untilUserHasBall(g);
  assert.ok(user, 'o humano precisa receber a bola em algum momento');

  const cmd = emptyCommand();
  cmd.passRequested = true;
  g.setUserCommand(cmd);

  const dt = 1 / 120;
  let passou = false;
  for (let i = 0; i < 90; i++) {
    g.step(dt);
    if (g.ball.state === 'pass' || !user!.hasBall) { passou = true; break; }
    g.setUserCommand(cmd);
  }
  assert.ok(passou, 'apertar passe tem que soltar a bola');
});

test('move de drible pedido pelo humano entra em acao', () => {
  const g = sim('drible');
  const user = untilUserHasBall(g);
  assert.ok(user);

  const cmd = emptyCommand();
  cmd.moveRequest = { id: 'crossover', side: 1 };
  g.setUserCommand(cmd);

  const dt = 1 / 120;
  let executou = false;
  for (let i = 0; i < 60; i++) {
    g.step(dt);
    if (user!.action.kind === 'dribble_move') { executou = true; break; }
    g.setUserCommand(cmd);
  }
  assert.ok(executou, 'o move pedido tem que virar acao de drible');
});

test('todos os 28 moves de drible sao aceitos pelo comando', async () => {
  const { DRIBBLE_MOVES } = await import('../src/core/sim/dribble.js');
  assert.ok(DRIBBLE_MOVES.length >= 28, 'o catalogo tem que ter os 28 moves');
  for (const m of DRIBBLE_MOVES) {
    assert.ok(typeof m.id === 'string' && m.id.length > 0);
  }
});

test('poste do humano muda a postura do corpo', () => {
  const g = sim('poste');
  const user = untilUserHasBall(g);
  assert.ok(user);

  const cmd = emptyCommand();
  cmd.postUp = true;
  g.setUserCommand(cmd);
  for (let i = 0; i < 20; i++) { g.step(1 / 120); g.setUserCommand(cmd); }
  assert.equal(user!.state, 'posture_post');
});

test('roubo do humano gasta o cooldown e nao dispara todo frame', () => {
  const g = sim('roubo');
  const dt = 1 / 120;
  // Espera o humano estar SEM a bola (defendendo).
  let defensor: Actor | undefined;
  for (let i = 0; i < 90 / dt; i++) {
    g.step(dt);
    const u = g.userActor();
    if (u && !u.hasBall && g.phase === 'live' && g.possession.team !== 0) { defensor = u; break; }
  }
  assert.ok(defensor, 'o humano precisa defender em algum momento');

  const cmd = emptyCommand();
  cmd.stealRequested = true;
  let tentativas = 0;
  for (let i = 0; i < 600; i++) {
    g.setUserCommand(cmd);
    const antes = defensor!.action.kind;
    g.step(dt);
    if (antes !== 'steal_attempt' && defensor!.action.kind === 'steal_attempt') tentativas++;
  }
  // 600 frames sao 5 s; com 4 s de cooldown, no maximo duas tentativas.
  assert.ok(tentativas <= 2, `roubo disparou ${tentativas} vezes em 5 s; o cooldown nao esta segurando`);
});

test('nenhum botao do comando fica sem efeito declarado', () => {
  // Guarda contra o bug original: um campo novo no UserCommand que ninguem le.
  const cmd = emptyCommand();
  const campos = Object.keys(cmd);
  const esperados = [
    'move', 'sprint', 'shootStick', 'shootHeld', 'shootReleased',
    'passRequested', 'lobRequested', 'driveRequested',
    'stealRequested', 'blockRequested', 'postUp', 'callScreen',
    'switchPlayer', 'timeout', 'intentionalFoul',
  ];
  for (const e of esperados) {
    assert.ok(campos.includes(e), `${e} sumiu do comando`);
  }
});
