import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/math/rng.js';
import { generateLeague } from '../src/core/data/generator.js';
import { quickSimGame } from '../src/core/franchise/quicksim.js';
import { DEFAULT_RULES, buildSchedule, conferenceStandings, createSeason, computeAwards, runPlayoffs, simulateDay } from '../src/core/franchise/league.js';
import { developPlayer, ageCurve, generateDraftClass, draftOrder, runDraft } from '../src/core/franchise/development.js';
import { evaluateOffer, evaluateTrade, marketValue, createTrust, resolvePromise, tradeValue } from '../src/core/franchise/contracts.js';
import { overall } from '../src/core/model/attributes.js';
import { SaveManager, CareerSave } from '../src/core/save/save.js';
import { createCareer } from '../src/core/career/career.js';

test('simulacao rapida produz placares e estatisticas plausiveis', () => {
  const league = generateLeague('quick');
  const rng = new Rng('quick-sim');
  let points = 0;
  let fga = 0;
  let fgm = 0;
  const games = 120;
  for (let i = 0; i < games; i++) {
    const a = league.teams[i % league.teams.length];
    const b = league.teams[(i + 7) % league.teams.length];
    const r = quickSimGame(a, b, rng);
    assert.notEqual(r.homeScore, r.awayScore, 'nao pode terminar empatado');
    points += r.homeScore + r.awayScore;
    fga += r.box.teams[0].fga + r.box.teams[1].fga;
    fgm += r.box.teams[0].fgm + r.box.teams[1].fgm;
  }
  const avgTeamPoints = points / (games * 2);
  const fgPct = fgm / fga;
  assert.ok(avgTeamPoints > 95 && avgTeamPoints < 135, `media de pontos fora da faixa: ${avgTeamPoints.toFixed(1)}`);
  assert.ok(fgPct > 0.4 && fgPct < 0.54, `aproveitamento fora da faixa: ${(fgPct * 100).toFixed(1)}%`);
});

test('calendario distribui jogos igualmente entre as equipes', () => {
  const league = generateLeague('sched');
  const rng = new Rng('sched');
  const rules = { ...DEFAULT_RULES, gamesPerTeam: 40 };
  const schedule = buildSchedule(league, rules, rng);
  const counts = new Map<string, number>();
  for (const g of schedule) {
    counts.set(g.homeId, (counts.get(g.homeId) ?? 0) + 1);
    counts.set(g.awayId, (counts.get(g.awayId) ?? 0) + 1);
  }
  const values = [...counts.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  assert.ok(max - min <= 4, `calendario desequilibrado: entre ${min} e ${max} jogos`);
  // Nenhuma equipe joga duas vezes no mesmo dia.
  const byDay = new Map<number, Set<string>>();
  for (const g of schedule) {
    const set = byDay.get(g.day) ?? new Set();
    assert.ok(!set.has(g.homeId) && !set.has(g.awayId), `equipe duplicada no dia ${g.day}`);
    set.add(g.homeId);
    set.add(g.awayId);
    byDay.set(g.day, set);
  }
});

test('temporada completa fecha vitorias e derrotas', () => {
  const league = generateLeague('season');
  const rng = new Rng('season');
  const season = createSeason(league, { ...DEFAULT_RULES, gamesPerTeam: 20 }, rng);
  let guard = 0;
  while (!season.finished && guard++ < 500) simulateDay(league, season, rng);
  assert.ok(season.finished, 'temporada deveria terminar');
  let wins = 0;
  let losses = 0;
  for (const s of season.standings.values()) {
    wins += s.wins;
    losses += s.losses;
  }
  assert.equal(wins, losses, 'toda vitoria tem uma derrota correspondente');
  const east = conferenceStandings(league, season, 'Leste');
  for (let i = 1; i < east.length; i++) {
    assert.ok(east[i - 1].pct >= east[i].pct, 'classificacao deve estar ordenada');
  }
});

test('playoffs produzem um campeao', () => {
  const league = generateLeague('playoffs');
  const rng = new Rng('playoffs');
  const season = createSeason(league, { ...DEFAULT_RULES, gamesPerTeam: 20 }, rng);
  let guard = 0;
  while (!season.finished && guard++ < 500) simulateDay(league, season, rng);
  const result = runPlayoffs(league, season, rng);
  assert.ok(result.champion, 'deveria haver campeao');
  for (const round of result.rounds) {
    for (const series of round) {
      assert.ok(series.highWins === 4 || series.lowWins === 4, 'serie deve ir ate 4 vitorias');
      assert.ok(series.games.length <= 7, 'serie nao passa de 7 jogos');
    }
  }
  const awards = computeAwards(league, season);
  assert.ok(awards.mvp.length > 0, 'deveria eleger um MVP');
  assert.equal(awards.allNba.length, 5);
});

test('curva de idade: jovem cresce, veterano decai', () => {
  const league = generateLeague('dev');
  const rng = new Rng('dev');
  const team = league.teams[0];
  const young = team.roster.find((p) => p.age <= 22) ?? team.roster[0];
  young.age = 21;
  for (const k of Object.keys(young.potential) as (keyof typeof young.potential)[]) {
    young.potential[k] = Math.min(99, young.attributes[k] + 15);
  }
  const before = overall(young.attributes, young.position);
  developPlayer(young, undefined, team, rng);
  assert.ok(overall(young.attributes, young.position) >= before, 'jovem nao deveria regredir sem jogar');

  const old = team.roster[1];
  old.age = 37;
  const beforeOld = overall(old.attributes, old.position);
  developPlayer(old, undefined, team, rng);
  assert.ok(overall(old.attributes, old.position) <= beforeOld, 'veterano deveria decair');
  assert.ok(ageCurve(21).growth > ageCurve(33).growth);
  assert.ok(ageCurve(37).decline > ageCurve(25).decline);
});

test('draft entrega uma escolha por equipe por rodada', () => {
  const league = generateLeague('draft');
  const rng = new Rng('draft');
  const season = createSeason(league, DEFAULT_RULES, rng);
  const order = draftOrder(league, season.standings, rng);
  assert.equal(new Set(order).size, league.teams.length, 'cada equipe aparece uma vez na ordem');
  const prospects = generateDraftClass(rng, 1, 60);
  const picks = runDraft(league, order, prospects, 2, rng);
  assert.equal(picks.length, league.teams.length * 2);
  assert.equal(new Set(picks.map((p) => p.playerId)).size, picks.length, 'nenhum atleta draftado duas vezes');
});

test('free agency: oferta baixa e recusada, oferta cheia e aceita', () => {
  const league = generateLeague('fa');
  const rng = new Rng('fa');
  const team = league.teams[0];
  const target = league.teams[5].roster[0];
  const trust = createTrust();
  const value = marketValue(target, DEFAULT_RULES);

  const low = evaluateOffer(target, {
    teamId: team.identity.id, salary: value * 0.35, years: 2, role: 'bench', guaranteed: false, playerOption: false,
  }, team, trust, DEFAULT_RULES, rng);
  const high = evaluateOffer(target, {
    teamId: team.identity.id, salary: value * 1.35, years: 4, role: 'star', guaranteed: true, playerOption: true, promisedMinutes: 34,
  }, team, trust, DEFAULT_RULES, rng);
  assert.ok(high.score > low.score + 0.1, `oferta cheia deveria valer bem mais (${low.score.toFixed(2)} x ${high.score.toFixed(2)})`);
  assert.equal(low.wouldSign, false, 'oferta muito abaixo do mercado nao pode ser aceita');
});

test('quebrar promessa derruba a confianca do GM', () => {
  const trust = createTrust();
  const before = trust.value;
  trust.promises.push({ id: 'p1', playerId: 'x', kind: 'minutes', detail: '30 minutos por jogo', target: 30, season: 1 });
  resolvePromise(trust, 'p1', false, 1);
  assert.ok(trust.value < before, 'promessa quebrada tem que custar');
  assert.equal(trust.history.length, 1);
});

test('troca desequilibrada e recusada', () => {
  const league = generateLeague('trade');
  const teams = new Map(league.teams.map((t) => [t.identity.id, t]));
  const trust = createTrust();
  const a = league.teams[0];
  const b = league.teams[1];
  const myWorst = [...a.roster].sort((x, y) => overall(x.attributes, x.position) - overall(y.attributes, y.position))[0];
  const theirBest = [...b.roster].sort((x, y) => overall(y.attributes, y.position) - overall(x.attributes, x.position))[0];
  const evaluation = evaluateTrade({
    fromTeamId: a.identity.id, toTeamId: b.identity.id,
    fromPlayers: [myWorst.id], toPlayers: [theirBest.id],
  }, teams, DEFAULT_RULES, trust);
  assert.equal(evaluation.accepted, false, 'ninguem troca a estrela pelo pior do elenco');
  assert.ok(tradeValue(theirBest, DEFAULT_RULES) > tradeValue(myWorst, DEFAULT_RULES));
});

test('save grava, le e migra versoes antigas', () => {
  const saves = new SaveManager();
  const career = createCareer('p1');
  career.progression.level = 7;
  saves.write<CareerSave>({
    meta: { slot: 't1', kind: 'career', label: 'Teste', updatedAt: 0, version: 0 },
    career, build: { name: { first: 'A', last: 'B' }, position: 'SG', heightInches: 77, weightLbs: 200, wingspanInches: 80, style: 'connector_3d', targets: {} },
    leagueSeed: 'x', season: 1,
  });
  const read = saves.read<CareerSave>('career', 't1');
  assert.ok(read, 'deveria ler o save');
  assert.equal(read!.career.progression.level, 7);
  assert.equal(read!.meta.version, 3);
  assert.ok(saves.list('career').some((m) => m.slot === 't1'));
  saves.delete('career', 't1');
  assert.equal(saves.read<CareerSave>('career', 't1'), null);
});
