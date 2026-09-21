/**
 * BOX SCORE E ESTATISTICAS (secoes 87, 88).
 * Registro completo por atleta e por equipe, incluindo shot chart por zona.
 */
import { ShotZone } from '../config/court.js';
import { pct } from '../math/util.js';

export interface ShotChartEntry {
  x: number;
  y: number;
  made: boolean;
  value: 2 | 3;
  zone: ShotZone;
  contest: number;
  period: number;
  clock: number;
  shooterId: string;
}

export interface PlayerStats {
  playerId: string;
  name: string;
  teamIdx: 0 | 1;
  secondsPlayed: number;
  points: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  plusMinus: number;
  /** Metricas avancadas acumuladas. */
  touches: number;
  passes: number;
  drives: number;
  contestedShots: number;
  dunks: number;
  ankleBreaks: number;
  screenAssists: number;
  deflections: number;
  distanceRun: number;
  maxSpeed: number;
  paintTouches: number;
  secondChancePoints: number;
  fastBreakPoints: number;
  /** Tentativas por zona. */
  byZone: Partial<Record<ShotZone, { made: number; att: number }>>;
}

export function emptyPlayerStats(playerId: string, name: string, teamIdx: 0 | 1): PlayerStats {
  return {
    playerId, name, teamIdx,
    secondsPlayed: 0, points: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, plusMinus: 0,
    touches: 0, passes: 0, drives: 0, contestedShots: 0, dunks: 0, ankleBreaks: 0,
    screenAssists: 0, deflections: 0, distanceRun: 0, maxSpeed: 0, paintTouches: 0,
    secondChancePoints: 0, fastBreakPoints: 0, byZone: {},
  };
}

export interface TeamStats {
  teamIdx: 0 | 1;
  name: string;
  points: number;
  pointsByPeriod: number[];
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  teamFoulsThisPeriod: number;
  possessions: number;
  paintPoints: number;
  fastBreakPoints: number;
  secondChancePoints: number;
  pointsOffTurnovers: number;
  benchPoints: number;
  biggestLead: number;
  largestRun: number;
  timeoutsLeft: number;
}

export function emptyTeamStats(teamIdx: 0 | 1, name: string, timeouts: number): TeamStats {
  return {
    teamIdx, name, points: 0, pointsByPeriod: [], fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, teamFoulsThisPeriod: 0,
    possessions: 0, paintPoints: 0, fastBreakPoints: 0, secondChancePoints: 0, pointsOffTurnovers: 0,
    benchPoints: 0, biggestLead: 0, largestRun: 0, timeoutsLeft: timeouts,
  };
}

export interface BoxScore {
  players: Map<string, PlayerStats>;
  teams: [TeamStats, TeamStats];
  shotChart: ShotChartEntry[];
}

export function recordShot(box: BoxScore, entry: ShotChartEntry, teamIdx: 0 | 1, points: number): void {
  box.shotChart.push(entry);
  const ps = box.players.get(entry.shooterId);
  const ts = box.teams[teamIdx];
  if (ps) {
    ps.fga++;
    if (entry.value === 3) ps.tpa++;
    if (entry.made) {
      ps.fgm++;
      if (entry.value === 3) ps.tpm++;
      ps.points += points;
    }
    if (entry.contest > 0.3) ps.contestedShots++;
    const z = ps.byZone[entry.zone] ?? { made: 0, att: 0 };
    z.att++;
    if (entry.made) z.made++;
    ps.byZone[entry.zone] = z;
  }
  ts.fga++;
  if (entry.value === 3) ts.tpa++;
  if (entry.made) {
    ts.fgm++;
    if (entry.value === 3) ts.tpm++;
    ts.points += points;
  }
}

/** Eficiencia ofensiva por 100 posses. */
export function offensiveRating(team: TeamStats): number {
  return team.possessions > 0 ? (team.points / team.possessions) * 100 : 0;
}

export function trueShooting(p: PlayerStats): number {
  const denom = 2 * (p.fga + 0.44 * p.fta);
  return denom > 0 ? p.points / denom : 0;
}

export function effectiveFg(p: PlayerStats | TeamStats): number {
  return p.fga > 0 ? (p.fgm + 0.5 * p.tpm) / p.fga : 0;
}

/** Estimativa de posses (formula padrao). */
export function estimatePossessions(team: TeamStats, oppTeam: TeamStats): number {
  return 0.5 * (
    (team.fga + 0.4 * team.fta - 1.07 * (team.oreb / Math.max(1, team.oreb + oppTeam.dreb)) * (team.fga - team.fgm) + team.turnovers)
    + (oppTeam.fga + 0.4 * oppTeam.fta - 1.07 * (oppTeam.oreb / Math.max(1, oppTeam.oreb + team.dreb)) * (oppTeam.fga - oppTeam.fgm) + oppTeam.turnovers)
  );
}

export function gameScore(p: PlayerStats): number {
  return p.points + 0.4 * p.fgm - 0.7 * p.fga - 0.4 * (p.fta - p.ftm)
    + 0.7 * p.oreb + 0.3 * p.dreb + p.steals + 0.7 * p.assists + 0.7 * p.blocks
    - 0.4 * p.fouls - p.turnovers;
}

export function formatPlayerLine(p: PlayerStats): string {
  const min = Math.floor(p.secondsPlayed / 60);
  const sec = Math.floor(p.secondsPlayed % 60);
  return [
    p.name.padEnd(22).slice(0, 22),
    `${min}:${sec.toString().padStart(2, '0')}`.padStart(6),
    `${p.points}`.padStart(4),
    `${p.fgm}-${p.fga}`.padStart(7),
    `${p.tpm}-${p.tpa}`.padStart(6),
    `${p.ftm}-${p.fta}`.padStart(6),
    `${p.oreb + p.dreb}`.padStart(4),
    `${p.assists}`.padStart(4),
    `${p.steals}`.padStart(4),
    `${p.blocks}`.padStart(4),
    `${p.turnovers}`.padStart(4),
    `${p.fouls}`.padStart(4),
  ].join(' ');
}

export const BOX_HEADER = [
  'JOGADOR'.padEnd(22),
  'MIN'.padStart(6),
  'PTS'.padStart(4),
  'FG'.padStart(7),
  '3PT'.padStart(6),
  'LL'.padStart(6),
  'REB'.padStart(4),
  'AST'.padStart(4),
  'ROU'.padStart(4),
  'TOC'.padStart(4),
  'ERR'.padStart(4),
  'FAL'.padStart(4),
].join(' ');

export function formatTeamLine(t: TeamStats): string {
  return `${t.name}: ${t.points} pts | FG ${t.fgm}-${t.fga} (${pct(t.fgm, t.fga)}%) | 3PT ${t.tpm}-${t.tpa} (${pct(t.tpm, t.tpa)}%) | LL ${t.ftm}-${t.fta} (${pct(t.ftm, t.fta)}%) | REB ${t.oreb + t.dreb} (${t.oreb} of) | AST ${t.assists} | ERR ${t.turnovers} | Garrafao ${t.paintPoints}`;
}
