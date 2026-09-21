/**
 * SIMULACAO RAPIDA DE PARTIDA.
 *
 * Uma temporada tem 1230 jogos; rodar o motor fisico em todos custaria horas.
 * Este modulo resolve uma partida em milissegundos a partir dos MESMOS
 * atributos e tendencias, calibrado para reproduzir as medias que o motor
 * fisico produz (ver docs/CALIBRACAO.md). Os jogos do usuario continuam sendo
 * jogados no motor completo.
 */
import { Rng } from '../math/rng.js';
import { Team, startersOf } from '../model/team.js';
import { PlayerProfile, fullName } from '../model/player.js';
import { overall } from '../model/attributes.js';
import { BoxScore, PlayerStats, emptyPlayerStats, emptyTeamStats } from '../stats/boxscore.js';
import { clamp, clamp01, lerp } from '../math/util.js';

export interface QuickGameResult {
  box: BoxScore;
  homeScore: number;
  awayScore: number;
  overtimes: number;
}

interface Usage {
  player: PlayerProfile;
  minutes: number;
  usage: number;
  threeRate: number;
  efficiency: number;
}

function rotationMinutes(team: Team, rng: Rng): { player: PlayerProfile; minutes: number }[] {
  const ranked = [...team.roster]
    .filter((p) => !p.health.injury || p.health.injury.gamesOut <= 0)
    .sort((a, b) => overall(b.attributes, b.position) - overall(a.attributes, a.position));
  const curve = [35, 33, 31, 29, 27, 21, 19, 16, 13, 8, 4, 2, 1, 0, 0];
  const out: { player: PlayerProfile; minutes: number }[] = [];
  let total = 0;
  ranked.forEach((p, i) => {
    const base = curve[i] ?? 0;
    const stamina = 0.85 + (p.attributes.stamina / 99) * 0.2;
    const m = Math.max(0, base * stamina + rng.normal(0, 1.8));
    out.push({ player: p, minutes: m });
    total += m;
  });
  // Normaliza para 240 minutos de equipe.
  const scale = 240 / Math.max(1, total);
  for (const r of out) r.minutes *= scale;
  return out;
}

function buildUsage(team: Team, rng: Rng): Usage[] {
  const minutes = rotationMinutes(team, rng);
  const raw = minutes.map(({ player, minutes: m }) => {
    const a = player.attributes;
    const t = player.tendencies;
    const scoring = (a.closeShot * 0.2 + a.midRange * 0.22 + a.threePoint * 0.28 + a.drivingLayup * 0.18 + a.postControl * 0.12) / 99;
    const creation = (a.ballHandle * 0.5 + a.passIQ * 0.5) / 99;
    const usage = clamp01(scoring * 0.65 + creation * 0.2 + (t.isolation + t.pullup) / 400) * (0.6 + m / 36);
    const threeRate = clamp01(t.shootThree / 100 * 0.75 + (a.threePoint - 55) / 90);
    const efficiency = clamp01(
      0.34 + (a.threePoint / 99) * 0.1 + (a.midRange / 99) * 0.08 + (a.closeShot / 99) * 0.1 + (a.shotIQ / 99) * 0.06,
    );
    return { player, minutes: m, usage, threeRate, efficiency };
  });
  const totalUsage = raw.reduce((s, r) => s + r.usage * r.minutes, 0);
  for (const r of raw) r.usage = totalUsage > 0 ? (r.usage * r.minutes) / totalUsage : 0.2;
  return raw;
}

function teamRatings(team: Team): { off: number; def: number; pace: number; reb: number; ast: number } {
  const five = startersOf(team);
  const avg = (f: (p: PlayerProfile) => number) => five.reduce((s, p) => s + f(p), 0) / Math.max(1, five.length);
  const off = avg((p) => p.attributes.threePoint * 0.22 + p.attributes.midRange * 0.14 + p.attributes.closeShot * 0.16
    + p.attributes.drivingLayup * 0.16 + p.attributes.passIQ * 0.16 + p.attributes.ballHandle * 0.16);
  const def = avg((p) => p.attributes.perimeterDefense * 0.28 + p.attributes.interiorDefense * 0.26
    + p.attributes.defensiveIQ * 0.2 + p.attributes.block * 0.13 + p.attributes.steal * 0.13);
  const pace = avg((p) => p.attributes.speed * 0.6 + p.tendencies.runFloor * 0.4);
  const reb = avg((p) => p.attributes.defensiveRebound * 0.6 + p.attributes.offensiveRebound * 0.4);
  const ast = avg((p) => p.attributes.passAccuracy * 0.5 + p.attributes.passIQ * 0.5);
  const coachOff = team.coach.offenseRating / 99;
  const coachDef = team.coach.defenseRating / 99;
  return {
    off: off * (0.94 + coachOff * 0.12) * (0.96 + team.chemistry * 0.08),
    def: def * (0.94 + coachDef * 0.12),
    pace,
    reb,
    ast,
  };
}

export function quickSimGame(home: Team, away: Team, rng: Rng, homeCourt = 2.4): QuickGameResult {
  const box: BoxScore = {
    players: new Map(),
    teams: [
      emptyTeamStats(0, `${home.identity.city} ${home.identity.name}`, 6),
      emptyTeamStats(1, `${away.identity.city} ${away.identity.name}`, 6),
    ],
    shotChart: [],
  };

  const ratings = [teamRatings(home), teamRatings(away)];
  const usages = [buildUsage(home, rng), buildUsage(away, rng)];

  const pace = clamp(96 + (ratings[0].pace + ratings[1].pace - 140) * 0.18 + rng.normal(0, 3.2), 88, 112);
  const possessions = Math.round(pace);

  for (const teamIdx of [0, 1] as const) {
    const own = ratings[teamIdx];
    const opp = ratings[1 - teamIdx];
    const ts = box.teams[teamIdx];
    const list = usages[teamIdx];

    // Eficiencia da equipe: ataque contra defesa, em pontos por 100 posses.
    const advantage = (own.off - opp.def) * 0.55;
    const rating = clamp(112 + advantage + (teamIdx === 0 ? homeCourt : 0) + rng.normal(0, 4.5), 92, 132);
    ts.possessions = possessions;

    const teamPoints = Math.round((rating * possessions) / 100);

    // Primeiro reparte as TENTATIVAS por uso; depois calibra as PORCENTAGENS
    // para bater com o alvo de pontos. Ajustar pontos no fim (somando e
    // subtraindo cestas) distorcia o aproveitamento para baixo.
    const shares = list.filter((u) => u.minutes >= 0.5);
    const plan = shares.map((u) => {
      const fga = Math.max(0, Math.round(possessions * 0.86 * u.usage + rng.normal(0, 1.6)));
      const tpa = Math.min(fga, Math.round(fga * u.threeRate * lerp(0.75, 1.1, rng.next())));
      const fgBase = u.efficiency + advantage / 140;
      const tpPct = clamp01(fgBase - 0.09 + (u.player.attributes.threePoint - 70) / 340 + rng.normal(0, 0.05));
      const twoPct = clamp01(fgBase + 0.06 + (u.player.attributes.closeShot - 70) / 320 + rng.normal(0, 0.045));
      const drawRate = 0.085 + (u.player.attributes.drawFoul / 99) * 0.13;
      const fta = Math.max(0, Math.round(fga * drawRate * 2 + rng.normal(0, 1)));
      const ftPct = clamp01(u.player.attributes.freeThrow / 105 + rng.normal(0, 0.05));
      return { u, fga, tpa, twoA: fga - tpa, tpPct, twoPct, fta, ftPct };
    });

    const expectedPoints = plan.reduce((sum, p) => sum + p.tpa * p.tpPct * 3 + p.twoA * p.twoPct * 2 + p.fta * p.ftPct, 0);
    const k = expectedPoints > 1 ? clamp(teamPoints / expectedPoints, 0.72, 1.32) : 1;

    for (const entry of plan) {
      const { u } = entry;
      const ps = emptyPlayerStats(u.player.id, fullName(u.player), teamIdx);
      ps.secondsPlayed = u.minutes * 60;

      const tpm = binomial(entry.tpa, clamp01(entry.tpPct * k), rng);
      const twoM = binomial(entry.twoA, clamp01(entry.twoPct * k), rng);
      const ftm = binomial(entry.fta, clamp01(entry.ftPct * (0.92 + k * 0.08)), rng);

      ps.fga = entry.fga;
      ps.tpa = entry.tpa;
      ps.tpm = tpm;
      ps.fgm = tpm + twoM;
      ps.fta = entry.fta;
      ps.ftm = ftm;
      ps.points = ps.fgm * 2 + ps.tpm + ps.ftm;

      const minuteShare = u.minutes / 48;
      ps.assists = Math.max(0, Math.round(minuteShare * (u.player.attributes.passIQ / 99) * (u.player.tendencies.pass / 55) * 9 + rng.normal(0, 1.1)));
      ps.turnovers = Math.max(0, Math.round(minuteShare * (3.4 - (u.player.attributes.ballHandle / 99) * 1.5) + rng.normal(0, 0.8)));
      ps.oreb = Math.max(0, Math.round(minuteShare * (u.player.attributes.offensiveRebound / 99) * 4.2 + rng.normal(0, 0.7)));
      ps.dreb = Math.max(0, Math.round(minuteShare * (u.player.attributes.defensiveRebound / 99) * 9.5 + rng.normal(0, 1.1)));
      ps.steals = Math.max(0, Math.round(minuteShare * (u.player.attributes.steal / 99) * 2.1 + rng.normal(0, 0.5)));
      ps.blocks = Math.max(0, Math.round(minuteShare * (u.player.attributes.block / 99) * 2.3 + rng.normal(0, 0.5)));
      ps.fouls = Math.max(0, Math.min(6, Math.round(minuteShare * (4.6 - (u.player.attributes.discipline / 99) * 2.2) + rng.normal(0, 0.8))));
      ps.dunks = Math.max(0, Math.round(minuteShare * (u.player.attributes.drivingDunk / 99) * 2.2 * (u.player.tendencies.attackClose / 60)));

      box.players.set(u.player.id, ps);
      ts.fga += ps.fga; ts.fgm += ps.fgm; ts.tpa += ps.tpa; ts.tpm += ps.tpm;
      ts.fta += ps.fta; ts.ftm += ps.ftm; ts.oreb += ps.oreb; ts.dreb += ps.dreb;
      ts.assists += ps.assists; ts.turnovers += ps.turnovers; ts.steals += ps.steals;
      ts.blocks += ps.blocks; ts.fouls += ps.fouls;
      ts.points += ps.points;
    }

    ts.paintPoints = Math.round(ts.points * lerp(0.36, 0.52, clamp01((own.off - 70) / 30)));
  }

  // Prorrogacao quando empata.
  let overtimes = 0;
  while (box.teams[0].points === box.teams[1].points && overtimes < 4) {
    overtimes++;
    for (const teamIdx of [0, 1] as const) {
      const pts = Math.max(0, Math.round(11 + rng.normal(0, 4)));
      box.teams[teamIdx].points += pts;
    }
  }
  if (box.teams[0].points === box.teams[1].points) box.teams[0].points += 2;

  // Plus/minus simples dos titulares.
  const diff = box.teams[0].points - box.teams[1].points;
  for (const ps of box.players.values()) {
    const sign = ps.teamIdx === 0 ? 1 : -1;
    ps.plusMinus = Math.round(sign * diff * (ps.secondsPlayed / (48 * 60)) + rng.normal(0, 4));
  }

  return {
    box,
    homeScore: box.teams[0].points,
    awayScore: box.teams[1].points,
    overtimes,
  };
}

function binomial(n: number, p: number, rng: Rng): number {
  if (n <= 0) return 0;
  const clamped = clamp01(p);
  // Aproximacao normal para n grande, exata para n pequeno.
  if (n > 24) {
    const mean = n * clamped;
    const sd = Math.sqrt(n * clamped * (1 - clamped));
    return clamp(Math.round(rng.normal(mean, sd)), 0, n);
  }
  let k = 0;
  for (let i = 0; i < n; i++) if (rng.next() < clamped) k++;
  return k;
}
