/**
 * FRANQUIA: calendario, classificacao, temporada e playoffs (secoes 63, 68, 71).
 */
import { Rng } from '../math/rng.js';
import { League } from '../data/generator.js';
import { Team } from '../model/team.js';
import { PlayerStats } from '../stats/boxscore.js';
import { quickSimGame } from './quicksim.js';
import { clamp } from '../math/util.js';

export interface ScheduledGame {
  id: number;
  day: number;
  homeId: string;
  awayId: string;
  played: boolean;
  homeScore?: number;
  awayScore?: number;
  overtimes?: number;
}

export interface SeasonStats {
  playerId: string;
  games: number;
  totals: PlayerStats;
}

export interface LeagueRules {
  gamesPerTeam: number;
  playoffTeamsPerConference: number;
  playInTeams: number;
  salaryCap: number;
  luxuryTax: number;
  maxRosterSize: number;
  rookieScaleYears: number;
  maxContractYears: number;
  /** Historico de alteracoes de regra (secao 71). */
  history: { season: number; change: string }[];
}

export const DEFAULT_RULES: LeagueRules = {
  gamesPerTeam: 82,
  playoffTeamsPerConference: 8,
  playInTeams: 2,
  salaryCap: 141,
  luxuryTax: 172,
  maxRosterSize: 15,
  rookieScaleYears: 4,
  maxContractYears: 5,
  history: [],
};

export interface SeasonState {
  season: number;
  schedule: ScheduledGame[];
  day: number;
  standings: Map<string, { wins: number; losses: number; pointsFor: number; pointsAgainst: number; streak: number }>;
  playerSeason: Map<string, SeasonStats>;
  rules: LeagueRules;
  finished: boolean;
  champion?: string;
  awards?: SeasonAwards;
}

export interface SeasonAwards {
  mvp: string;
  dpoy: string;
  roty: string;
  mip: string;
  sixthMan: string;
  allNba: string[];
}

/** Calendario equilibrado: cada time joga contra todos, ida e volta, ate a cota. */
export function buildSchedule(league: League, rules: LeagueRules, rng: Rng): ScheduledGame[] {
  const teams = league.teams;
  const pairs: [string, string][] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue;
      pairs.push([teams[i].identity.id, teams[j].identity.id]);
    }
  }
  const perTeam = rules.gamesPerTeam;
  const needed = Math.round((teams.length * perTeam) / 2);
  const games: ScheduledGame[] = [];
  const counts = new Map<string, number>();
  for (const t of teams) counts.set(t.identity.id, 0);

  rng.shuffle(pairs);
  let id = 0;
  for (const [home, away] of pairs) {
    if (games.length >= needed) break;
    if ((counts.get(home) ?? 0) >= perTeam || (counts.get(away) ?? 0) >= perTeam) continue;
    games.push({ id: id++, day: 0, homeId: home, awayId: away, played: false });
    counts.set(home, (counts.get(home) ?? 0) + 1);
    counts.set(away, (counts.get(away) ?? 0) + 1);
  }
  // Distribui em dias: cada dia recebe no maximo metade dos times.
  const perDay = Math.max(1, Math.floor(teams.length / 2));
  rng.shuffle(games);
  const dayBusy = new Map<number, Set<string>>();
  for (const g of games) {
    let day = 0;
    for (;;) {
      const busy = dayBusy.get(day) ?? new Set<string>();
      if (!busy.has(g.homeId) && !busy.has(g.awayId) && busy.size < perDay * 2) {
        busy.add(g.homeId);
        busy.add(g.awayId);
        dayBusy.set(day, busy);
        g.day = day;
        break;
      }
      day++;
    }
  }
  return games.sort((a, b) => a.day - b.day);
}

export function createSeason(league: League, rules: LeagueRules, rng: Rng): SeasonState {
  const standings = new Map<string, { wins: number; losses: number; pointsFor: number; pointsAgainst: number; streak: number }>();
  for (const t of league.teams) {
    standings.set(t.identity.id, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, streak: 0 });
    t.wins = 0;
    t.losses = 0;
  }
  return {
    season: league.season,
    schedule: buildSchedule(league, rules, rng),
    day: 0,
    standings,
    playerSeason: new Map(),
    rules,
    finished: false,
  };
}

function accumulate(season: SeasonState, box: Map<string, PlayerStats>): void {
  for (const [id, s] of box) {
    let agg = season.playerSeason.get(id);
    if (!agg) {
      agg = { playerId: id, games: 0, totals: { ...s, byZone: {} } };
      agg.totals = { ...s };
      agg.games = 1;
      season.playerSeason.set(id, agg);
      continue;
    }
    agg.games++;
    const t = agg.totals;
    t.secondsPlayed += s.secondsPlayed; t.points += s.points; t.fgm += s.fgm; t.fga += s.fga;
    t.tpm += s.tpm; t.tpa += s.tpa; t.ftm += s.ftm; t.fta += s.fta;
    t.oreb += s.oreb; t.dreb += s.dreb; t.assists += s.assists; t.steals += s.steals;
    t.blocks += s.blocks; t.turnovers += s.turnovers; t.fouls += s.fouls; t.plusMinus += s.plusMinus;
    t.dunks += s.dunks; t.deflections += s.deflections; t.distanceRun += s.distanceRun;
    t.secondChancePoints += s.secondChancePoints; t.fastBreakPoints += s.fastBreakPoints;
  }
}

export interface DayResult {
  games: { game: ScheduledGame; homeName: string; awayName: string }[];
}

/** Simula um dia inteiro do calendario. */
export function simulateDay(league: League, season: SeasonState, rng: Rng, skipTeamIds: string[] = []): DayResult {
  const byId = new Map(league.teams.map((t) => [t.identity.id, t]));
  const games = season.schedule.filter((g) => g.day === season.day && !g.played);
  const out: DayResult = { games: [] };

  for (const g of games) {
    const home = byId.get(g.homeId);
    const away = byId.get(g.awayId);
    if (!home || !away) continue;
    if (skipTeamIds.includes(g.homeId) || skipTeamIds.includes(g.awayId)) continue;
    const result = quickSimGame(home, away, rng);
    applyResult(season, g, home, away, result.homeScore, result.awayScore, result.overtimes);
    accumulate(season, result.box.players);
    out.games.push({ game: g, homeName: home.identity.name, awayName: away.identity.name });
  }
  season.day++;
  if (!season.schedule.some((g) => !g.played)) season.finished = true;
  return out;
}

export function applyResult(
  season: SeasonState, g: ScheduledGame, home: Team, away: Team,
  homeScore: number, awayScore: number, overtimes = 0,
): void {
  g.played = true;
  g.homeScore = homeScore;
  g.awayScore = awayScore;
  g.overtimes = overtimes;
  const hs = season.standings.get(home.identity.id)!;
  const as = season.standings.get(away.identity.id)!;
  hs.pointsFor += homeScore; hs.pointsAgainst += awayScore;
  as.pointsFor += awayScore; as.pointsAgainst += homeScore;
  if (homeScore > awayScore) {
    hs.wins++; as.losses++; home.wins++; away.losses++;
    hs.streak = hs.streak >= 0 ? hs.streak + 1 : 1;
    as.streak = as.streak <= 0 ? as.streak - 1 : -1;
  } else {
    as.wins++; hs.losses++; away.wins++; home.losses++;
    as.streak = as.streak >= 0 ? as.streak + 1 : 1;
    hs.streak = hs.streak <= 0 ? hs.streak - 1 : -1;
  }
}

export interface StandingRow {
  team: Team;
  wins: number;
  losses: number;
  pct: number;
  diff: number;
  streak: number;
  gamesBack: number;
}

export function conferenceStandings(league: League, season: SeasonState, conference: 'Leste' | 'Oeste'): StandingRow[] {
  const rows = league.teams
    .filter((t) => t.identity.conference === conference)
    .map((team) => {
      const s = season.standings.get(team.identity.id)!;
      const games = s.wins + s.losses;
      return {
        team,
        wins: s.wins,
        losses: s.losses,
        pct: games ? s.wins / games : 0,
        diff: s.pointsFor - s.pointsAgainst,
        streak: s.streak,
        gamesBack: 0,
      };
    })
    .sort((a, b) => b.pct - a.pct || b.diff - a.diff);
  if (rows.length) {
    const leader = rows[0];
    for (const r of rows) r.gamesBack = ((leader.wins - r.wins) + (r.losses - leader.losses)) / 2;
  }
  return rows;
}

export interface PlayoffSeries {
  round: number;
  highId: string;
  lowId: string;
  highWins: number;
  lowWins: number;
  games: { homeId: string; awayId: string; homeScore: number; awayScore: number }[];
  winnerId?: string;
}

export interface PlayoffState {
  rounds: PlayoffSeries[][];
  champion?: string;
}

export function runPlayoffs(league: League, season: SeasonState, rng: Rng): PlayoffState {
  const byId = new Map(league.teams.map((t) => [t.identity.id, t]));
  const state: PlayoffState = { rounds: [] };

  const seedsByConf = (['Leste', 'Oeste'] as const).map((conf) =>
    conferenceStandings(league, season, conf).slice(0, season.rules.playoffTeamsPerConference).map((r) => r.team.identity.id),
  );

  let confBrackets = seedsByConf.map((seeds) => {
    const pairs: PlayoffSeries[] = [];
    for (let i = 0; i < seeds.length / 2; i++) {
      pairs.push({ round: 1, highId: seeds[i], lowId: seeds[seeds.length - 1 - i], highWins: 0, lowWins: 0, games: [] });
    }
    return pairs;
  });

  let round = 1;
  while (confBrackets.some((b) => b.length > 0)) {
    const roundSeries: PlayoffSeries[] = [];
    const nextBrackets: PlayoffSeries[][] = [];
    for (const bracket of confBrackets) {
      const winners: string[] = [];
      for (const series of bracket) {
        series.round = round;
        playSeries(series, byId, rng);
        roundSeries.push(series);
        winners.push(series.winnerId!);
      }
      const next: PlayoffSeries[] = [];
      for (let i = 0; i < winners.length / 2; i++) {
        if (winners.length === 1) break;
        next.push({ round: round + 1, highId: winners[i], lowId: winners[winners.length - 1 - i], highWins: 0, lowWins: 0, games: [] });
      }
      nextBrackets.push(next);
    }
    state.rounds.push(roundSeries);
    const remaining = nextBrackets.map((b) => b.length).reduce((a, b) => a + b, 0);
    if (remaining === 0) {
      // Final entre os campeoes de conferencia.
      const finalists = confBrackets.map((b) => b.map((s) => s.winnerId!)).flat();
      if (finalists.length === 2) {
        const finals: PlayoffSeries = { round: round + 1, highId: finalists[0], lowId: finalists[1], highWins: 0, lowWins: 0, games: [] };
        playSeries(finals, byId, rng);
        state.rounds.push([finals]);
        state.champion = finals.winnerId;
      }
      break;
    }
    confBrackets = nextBrackets;
    round++;
  }
  season.champion = state.champion;
  return state;
}

function playSeries(series: PlayoffSeries, byId: Map<string, Team>, rng: Rng): void {
  const high = byId.get(series.highId)!;
  const low = byId.get(series.lowId)!;
  const pattern = [true, true, false, false, true, false, true]; // 2-2-1-1-1
  let g = 0;
  while (series.highWins < 4 && series.lowWins < 4 && g < 7) {
    const highHome = pattern[g];
    const home = highHome ? high : low;
    const away = highHome ? low : high;
    const r = quickSimGame(home, away, rng);
    series.games.push({ homeId: home.identity.id, awayId: away.identity.id, homeScore: r.homeScore, awayScore: r.awayScore });
    const homeWon = r.homeScore > r.awayScore;
    const highWon = highHome ? homeWon : !homeWon;
    if (highWon) series.highWins++;
    else series.lowWins++;
    g++;
  }
  series.winnerId = series.highWins > series.lowWins ? series.highId : series.lowId;
}

/** Premiacoes calculadas a partir das estatisticas reais da temporada. */
export function computeAwards(league: League, season: SeasonState): SeasonAwards {
  const rows = [...season.playerSeason.values()].filter((s) => s.games >= Math.max(8, season.rules.gamesPerTeam * 0.4));
  const byId = new Map<string, { team: Team; wins: number }>();
  for (const t of league.teams) {
    const st = season.standings.get(t.identity.id)!;
    for (const p of t.roster) byId.set(p.id, { team: t, wins: st.wins });
  }

  const score = (s: SeasonStats, weights: { pts: number; reb: number; ast: number; stl: number; blk: number; to: number; win: number }) => {
    const g = Math.max(1, s.games);
    const ctx = byId.get(s.playerId);
    return (s.totals.points / g) * weights.pts
      + ((s.totals.oreb + s.totals.dreb) / g) * weights.reb
      + (s.totals.assists / g) * weights.ast
      + (s.totals.steals / g) * weights.stl
      + (s.totals.blocks / g) * weights.blk
      - (s.totals.turnovers / g) * weights.to
      + (ctx ? ctx.wins * weights.win : 0);
  };

  const mvp = [...rows].sort((a, b) => score(b, { pts: 1, reb: 0.55, ast: 0.9, stl: 1.4, blk: 1.2, to: 0.9, win: 0.62 })
    - score(a, { pts: 1, reb: 0.55, ast: 0.9, stl: 1.4, blk: 1.2, to: 0.9, win: 0.62 }))[0];
  const dpoy = [...rows].sort((a, b) => score(b, { pts: 0.05, reb: 0.8, ast: 0, stl: 3.2, blk: 3.4, to: 0, win: 0.4 })
    - score(a, { pts: 0.05, reb: 0.8, ast: 0, stl: 3.2, blk: 3.4, to: 0, win: 0.4 }))[0];

  const rookies = rows.filter((s) => {
    for (const t of league.teams) {
      const p = t.roster.find((x) => x.id === s.playerId);
      if (p) return p.experience === 0;
    }
    return false;
  });
  const roty = rookies.sort((a, b) => score(b, { pts: 1, reb: 0.6, ast: 0.8, stl: 1, blk: 1, to: 0.6, win: 0.1 })
    - score(a, { pts: 1, reb: 0.6, ast: 0.8, stl: 1, blk: 1, to: 0.6, win: 0.1 }))[0];

  const bench = rows.filter((s) => {
    for (const t of league.teams) {
      if (t.roster.some((x) => x.id === s.playerId)) return !t.starters.includes(s.playerId);
    }
    return false;
  });
  const sixth = bench.sort((a, b) => (b.totals.points / b.games) - (a.totals.points / a.games))[0];

  const allNba = [...rows]
    .sort((a, b) => score(b, { pts: 1, reb: 0.55, ast: 0.9, stl: 1.4, blk: 1.2, to: 0.9, win: 0.5 })
      - score(a, { pts: 1, reb: 0.55, ast: 0.9, stl: 1.4, blk: 1.2, to: 0.9, win: 0.5 }))
    .slice(0, 5)
    .map((s) => s.playerId);

  return {
    mvp: mvp?.playerId ?? '',
    dpoy: dpoy?.playerId ?? '',
    roty: roty?.playerId ?? '',
    mip: rows[Math.floor(rows.length / 3)]?.playerId ?? '',
    sixthMan: sixth?.playerId ?? '',
    allNba,
  };
}
