import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSim } from '../src/core/sim/game.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { DEFAULT_SLIDERS } from '../src/core/config/sliders.js';
import { generateLeague } from '../src/core/data/generator.js';
import { offensiveRating } from '../src/core/stats/boxscore.js';

const league = generateLeague('test-league');

function play(seed: string, quarter = 300): GameSim {
  const sliders = { ...DEFAULT_SLIDERS, quarterLengthSeconds: quarter };
  const sim = new GameSim({
    home: league.teams[0], away: league.teams[1],
    tuning: DEFAULT_TUNING, sliders, seed,
  });
  sim.runToCompletion();
  return sim;
}

test('uma partida completa termina com quatro periodos e vencedor', () => {
  const sim = play('completa');
  assert.equal(sim.phase, 'final');
  assert.ok(sim.box.teams[0].pointsByPeriod.length >= 4, 'deveria registrar ao menos 4 periodos');
  assert.notEqual(sim.box.teams[0].points, sim.box.teams[1].points, 'nao pode terminar empatado');
});

test('a simulacao e deterministica: mesma seed, mesmo resultado', () => {
  const a = play('determinismo');
  const b = play('determinismo');
  assert.equal(a.box.teams[0].points, b.box.teams[0].points);
  assert.equal(a.box.teams[1].points, b.box.teams[1].points);
  assert.equal(a.box.teams[0].fga, b.box.teams[0].fga);
  assert.equal(a.events.all().length, b.events.all().length);
});

test('seeds diferentes produzem partidas diferentes', () => {
  const a = play('seedA');
  const b = play('seedB');
  const same = a.box.teams[0].points === b.box.teams[0].points && a.box.teams[1].points === b.box.teams[1].points;
  assert.equal(same, false, 'duas seeds nao deveriam dar exatamente o mesmo placar');
});

test('a sumula fecha: pontos batem com cestas, tres e lances livres', () => {
  const sim = play('sumula');
  for (const team of sim.box.teams) {
    const fromField = team.fgm * 2 + team.tpm; // tpm ja esta contido em fgm
    const total = fromField + team.ftm;
    assert.equal(team.points, total, `pontos inconsistentes em ${team.name}: ${team.points} x ${total}`);
    assert.ok(team.tpm <= team.fgm, 'tres convertidos nao podem exceder cestas de quadra');
    assert.ok(team.tpa <= team.fga, 'tentativas de tres nao podem exceder tentativas totais');
    assert.ok(team.ftm <= team.fta, 'lances livres convertidos nao podem exceder tentativas');
  }
});

test('a soma dos jogadores bate com o total da equipe', () => {
  const sim = play('soma');
  for (const idx of [0, 1] as const) {
    const players = [...sim.box.players.values()].filter((p) => p.teamIdx === idx);
    const pts = players.reduce((s, p) => s + p.points, 0);
    const fga = players.reduce((s, p) => s + p.fga, 0);
    assert.equal(pts, sim.box.teams[idx].points, 'pontos por jogador devem somar o total da equipe');
    assert.equal(fga, sim.box.teams[idx].fga, 'tentativas por jogador devem somar o total da equipe');
  }
});

test('estatisticas medias ficam em faixas de basquete real', () => {
  // A calibracao garante a MEDIA, nao cada jogo isolado: um confronto
  // desequilibrado pode fugir da faixa, como acontece na realidade.
  const games = 4;
  const acc = { points: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, to: 0, ast: 0, fouls: 0, poss: 0, reb: 0, n: 0 };
  for (let i = 0; i < games; i++) {
    const sim = play(`faixas${i}`, 720);
    for (const team of sim.box.teams) {
      acc.points += team.points; acc.fga += team.fga; acc.fgm += team.fgm;
      acc.tpa += team.tpa; acc.tpm += team.tpm; acc.to += team.turnovers;
      acc.ast += team.assists; acc.fouls += team.fouls; acc.poss += team.possessions;
      acc.reb += team.oreb + team.dreb;
      acc.n++;
      // Limites por jogo bem largos: apenas para pegar resultado absurdo.
      assert.ok(team.points > 60 && team.points < 190, `pontuacao absurda: ${team.points}`);
      assert.ok(team.turnovers < 45, `erros absurdos: ${team.turnovers}`);
    }
  }
  const n = acc.n;
  const avgPoints = acc.points / n;
  const fgPct = acc.fgm / acc.fga;
  const tpPct = acc.tpm / acc.tpa;
  const avgTo = acc.to / n;
  const avgAst = acc.ast / n;
  const avgFouls = acc.fouls / n;
  const avgPoss = acc.poss / n;
  const avgReb = acc.reb / n;

  assert.ok(avgPoints > 95 && avgPoints < 140, `media de pontos: ${avgPoints.toFixed(1)}`);
  assert.ok(fgPct > 0.38 && fgPct < 0.52, `aproveitamento medio: ${(fgPct * 100).toFixed(1)}%`);
  assert.ok(tpPct > 0.28 && tpPct < 0.46, `tres pontos medio: ${(tpPct * 100).toFixed(1)}%`);
  assert.ok(avgTo > 8 && avgTo < 28, `erros medios: ${avgTo.toFixed(1)}`);
  assert.ok(avgAst > 16 && avgAst < 36, `assistencias medias: ${avgAst.toFixed(1)}`);
  assert.ok(avgFouls > 10 && avgFouls < 32, `faltas medias: ${avgFouls.toFixed(1)}`);
  assert.ok(avgPoss > 92 && avgPoss < 135, `posses medias: ${avgPoss.toFixed(1)}`);
  assert.ok(avgReb > 38 && avgReb < 70, `rebotes medios: ${avgReb.toFixed(1)}`);
});

test('ninguem excede o limite de faltas e quem excede sai', () => {
  const sim = play('faltas', 720);
  for (const p of sim.box.players.values()) {
    assert.ok(p.fouls <= DEFAULT_TUNING.fouls.foulOutLimit, `${p.name} com ${p.fouls} faltas`);
  }
});

test('o tempo em quadra de cada equipe fecha em 5 jogadores por segundo', () => {
  const sim = play('minutos', 300);
  const totalGameSeconds = sim.box.teams[0].pointsByPeriod.length * 300;
  for (const idx of [0, 1] as const) {
    const seconds = [...sim.box.players.values()]
      .filter((p) => p.teamIdx === idx)
      .reduce((s, p) => s + p.secondsPlayed, 0);
    const expected = totalGameSeconds * 5;
    // Minutos contam apenas com o relogio correndo, entao a soma tem que
    // fechar em 5 atletas por segundo de jogo.
    assert.ok(Math.abs(seconds - expected) < expected * 0.03,
      `tempo de quadra nao fecha: ${seconds.toFixed(0)} x ${expected}`);
  }
});

test('os dois times terminam com contagem de posses parecida', () => {
  const sim = play('posses', 720);
  const a = sim.box.teams[0].possessions;
  const b = sim.box.teams[1].possessions;
  assert.ok(Math.abs(a - b) <= Math.max(6, a * 0.08), `posses assimetricas: ${a} x ${b}`);
});
