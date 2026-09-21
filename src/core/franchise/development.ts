/**
 * DESENVOLVIMENTO, ENVELHECIMENTO E DRAFT (secoes 68, 69, 70).
 *
 * Um atleta nao "sobe de nivel" por tempo de tela: ele evolui pelo que fez
 * (minutos, producao, treino) e regride pela idade, com o treinador podendo
 * atrasar a queda. A liga sobrevive por decadas porque a cada ano ela
 * aposenta, draftra e reequilibra.
 */
import { Rng } from '../math/rng.js';
import { Attributes, ATTRIBUTE_KEYS, overall } from '../model/attributes.js';
import { PlayerProfile } from '../model/player.js';
import { Team } from '../model/team.js';
import { League, generatePlayer } from '../data/generator.js';
import { SeasonStats } from './league.js';
import { clamp, clamp01, lerp } from '../math/util.js';

/** Atributos que decaem cedo (fisicos) e os que decaem tarde (tecnicos/QI). */
const PHYSICAL: (keyof Attributes)[] = ['speed', 'acceleration', 'agility', 'vertical', 'lateralQuickness', 'stamina'];
const SKILL: (keyof Attributes)[] = ['closeShot', 'midRange', 'threePoint', 'freeThrow', 'postControl', 'drivingLayup', 'passAccuracy', 'ballHandle'];
const MENTAL: (keyof Attributes)[] = ['shotIQ', 'passIQ', 'defensiveIQ', 'helpDefenseIQ', 'discipline'];

export interface DevelopmentResult {
  playerId: string;
  changes: Partial<Record<keyof Attributes, number>>;
  overallBefore: number;
  overallAfter: number;
  retired: boolean;
  note: string;
}

/** Curva de idade: pico entre 26 e 28. */
export function ageCurve(age: number): { growth: number; decline: number } {
  if (age <= 21) return { growth: 1.25, decline: 0 };
  if (age <= 24) return { growth: 1, decline: 0 };
  if (age <= 27) return { growth: 0.55, decline: 0.05 };
  if (age <= 30) return { growth: 0.22, decline: 0.3 };
  if (age <= 33) return { growth: 0.08, decline: 0.75 };
  if (age <= 36) return { growth: 0.02, decline: 1.25 };
  return { growth: 0, decline: 1.9 };
}

export function developPlayer(
  p: PlayerProfile,
  season: SeasonStats | undefined,
  team: Team | undefined,
  rng: Rng,
): DevelopmentResult {
  const before = overall(p.attributes, p.position);
  const changes: Partial<Record<keyof Attributes, number>> = {};
  const curve = ageCurve(p.age);

  const minutes = season ? season.totals.secondsPlayed / 60 : 0;
  const games = season?.games ?? 0;
  const mpg = games > 0 ? minutes / games : 0;
  const usageFactor = clamp01(mpg / 32);
  const work = p.personality.workEthic / 99;
  const coaching = team ? team.coach.development / 99 : 0.5;

  // Producao relativa ao esperado: quem rende acima da expectativa cresce mais.
  const prodPerMin = games > 0 && minutes > 0
    ? ((season!.totals.points + season!.totals.assists * 1.6 + (season!.totals.oreb + season!.totals.dreb) * 1.1
      + season!.totals.steals * 2 + season!.totals.blocks * 2) / minutes)
    : 0;
  const expected = 0.62;
  const overperform = clamp((prodPerMin - expected) / expected, -0.8, 1.2);

  const growthBudget = curve.growth * (0.35 + usageFactor * 0.9) * (0.6 + work * 0.8) * (0.7 + coaching * 0.6)
    * (1 + overperform * 0.45) * rng.range(0.7, 1.35) * 4.2;
  const declineBudget = curve.decline * (0.8 + (1 - p.attributes.durability / 99) * 0.5)
    * (1 - coaching * 0.3) * rng.range(0.7, 1.3) * 3.4;

  // Crescimento vai para onde ha espaco de potencial.
  const room = ATTRIBUTE_KEYS.filter((k) => p.attributes[k] < p.potential[k]);
  let budget = growthBudget;
  while (budget >= 1 && room.length) {
    const k = rng.pick(room);
    if (p.attributes[k] < p.potential[k]) {
      p.attributes[k] = Math.min(99, p.attributes[k] + 1);
      changes[k] = (changes[k] ?? 0) + 1;
      budget -= 1;
    } else {
      room.splice(room.indexOf(k), 1);
    }
  }

  // Declinio ataca primeiro o fisico; a tecnica resiste; o QI ainda sobe.
  let decline = declineBudget;
  while (decline >= 1) {
    const pool = rng.next() < 0.68 ? PHYSICAL : SKILL;
    const k = rng.pick(pool);
    if (p.attributes[k] > 28) {
      p.attributes[k] = Math.max(25, p.attributes[k] - 1);
      changes[k] = (changes[k] ?? 0) - 1;
    }
    decline -= 1;
  }
  if (p.age >= 24 && p.age <= 36 && rng.chance(0.55)) {
    const k = rng.pick(MENTAL);
    p.attributes[k] = Math.min(99, p.attributes[k] + 1);
    changes[k] = (changes[k] ?? 0) + 1;
  }

  p.age += 1;
  p.experience += 1;
  const after = overall(p.attributes, p.position);

  // Aposentadoria: idade + queda + falta de mercado.
  const retireChance = p.age < 33 ? 0 : clamp01((p.age - 33) * 0.16 + (after < 68 ? 0.28 : 0) + (mpg < 12 ? 0.18 : 0));
  const retired = rng.chance(retireChance);

  return {
    playerId: p.id,
    changes,
    overallBefore: before,
    overallAfter: after,
    retired,
    note: retired ? 'Anunciou a aposentadoria.'
      : after > before + 2 ? 'Salto de rendimento.'
      : after < before - 2 ? 'Queda de rendimento.'
      : 'Temporada estavel.',
  };
}

export interface DraftProspect {
  player: PlayerProfile;
  /** Projecao publica (ruidosa) do potencial real. */
  projectedOverall: number;
  projectedPotential: number;
  boomBust: number;
}

/** Classe de draft: talento real + incerteza de scouting. */
export function generateDraftClass(rng: Rng, season: number, size = 60): DraftProspect[] {
  const out: DraftProspect[] = [];
  for (let i = 0; i < size; i++) {
    const tier = i / size;
    const level = clamp(78 - tier * 26 + rng.normal(0, 4.5), 38, 88);
    const p = generatePlayer(rng, { level: level - 8, age: Math.round(clamp(rng.normal(20, 1.2), 18, 23)), id: `draft_${season}_${i}` });
    p.origin = 'draft';
    p.experience = 0;
    // Potencial: o que o atleta pode virar, com variancia alta.
    for (const k of ATTRIBUTE_KEYS) {
      p.potential[k] = Math.min(99, p.attributes[k] + Math.round(rng.range(3, 22)));
    }
    const noise = rng.normal(0, 5.2);
    out.push({
      player: p,
      projectedOverall: Math.round(clamp(overall(p.attributes, p.position) + noise, 30, 95)),
      projectedPotential: Math.round(clamp(overall(p.potential, p.position) + rng.normal(0, 7), 40, 99)),
      boomBust: clamp01(Math.abs(noise) / 12),
    });
  }
  return out.sort((a, b) => (b.projectedOverall * 0.45 + b.projectedPotential * 0.55) - (a.projectedOverall * 0.45 + a.projectedPotential * 0.55));
}

/** Ordem do draft por loteria invertida com pesos. */
export function draftOrder(league: League, standings: Map<string, { wins: number; losses: number }>, rng: Rng): string[] {
  const rows = league.teams.map((t) => {
    const s = standings.get(t.identity.id) ?? { wins: 0, losses: 0 };
    const games = s.wins + s.losses;
    return { id: t.identity.id, pct: games ? s.wins / games : 0.5 };
  }).sort((a, b) => a.pct - b.pct);

  // Loteria: os 4 primeiros sorteados entre os 14 piores, com peso.
  const lotteryPool = rows.slice(0, Math.min(14, rows.length));
  const rest = rows.slice(lotteryPool.length);
  const picked: string[] = [];
  const weights = lotteryPool.map((r, i) => ({ item: r.id, weight: Math.pow(lotteryPool.length - i, 1.6) }));
  for (let i = 0; i < 4 && weights.length; i++) {
    const id = rng.weighted(weights);
    if (!id) break;
    picked.push(id);
    const idx = weights.findIndex((w) => w.item === id);
    if (idx >= 0) weights.splice(idx, 1);
  }
  const remainingLottery = lotteryPool.filter((r) => !picked.includes(r.id)).map((r) => r.id);
  return [...picked, ...remainingLottery, ...rest.map((r) => r.id)];
}

/** Executa o draft: cada time escolhe o melhor disponivel para sua necessidade. */
export function runDraft(
  league: League,
  order: string[],
  prospects: DraftProspect[],
  rounds = 2,
): { pick: number; teamId: string; playerId: string }[] {
  const byId = new Map(league.teams.map((t) => [t.identity.id, t]));
  const available = [...prospects];
  const picks: { pick: number; teamId: string; playerId: string }[] = [];
  let pick = 1;
  for (let r = 0; r < rounds; r++) {
    for (const teamId of order) {
      if (!available.length) break;
      const team = byId.get(teamId);
      if (!team) continue;
      // Necessidade: posicao mais fraca do elenco.
      const need = weakestPosition(team);
      const idx = available.findIndex((p) => p.player.position === need);
      const chosen = idx >= 0 && Math.random() < 0.55 ? available.splice(idx, 1)[0] : available.shift()!;
      chosen.player.teamId = teamId;
      chosen.player.contract = {
        salary: Math.max(1.1, 9.5 - pick * 0.22),
        yearsRemaining: 4,
        teamOption: true,
        playerOption: false,
        guaranteed: true,
        incentives: [],
        noTrade: false,
      };
      team.roster.push(chosen.player);
      picks.push({ pick, teamId, playerId: chosen.player.id });
      pick++;
    }
  }
  return picks;
}

function weakestPosition(team: Team): PlayerProfile['position'] {
  const byPos = new Map<PlayerProfile['position'], number>();
  for (const p of team.roster) {
    const cur = byPos.get(p.position) ?? 0;
    byPos.set(p.position, Math.max(cur, overall(p.attributes, p.position)));
  }
  const positions: PlayerProfile['position'][] = ['PG', 'SG', 'SF', 'PF', 'C'];
  let worst = positions[0];
  let worstValue = Infinity;
  for (const pos of positions) {
    const v = byPos.get(pos) ?? 0;
    if (v < worstValue) {
      worstValue = v;
      worst = pos;
    }
  }
  return worst;
}

/** RELACIONAMENTOS (secao 67): quimica que nasce do convivio e do rendimento. */
export interface Relationship {
  aId: string;
  bId: string;
  /** -100 (rivalidade) a +100 (dupla dinamica). */
  value: number;
  kind: 'friendship' | 'rivalry' | 'duo' | 'neutral';
}

export function updateRelationships(
  team: Team,
  season: Map<string, SeasonStats>,
  existing: Relationship[],
  rng: Rng,
): Relationship[] {
  const out = [...existing];
  const roster = team.roster.slice(0, 10);
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = roster[i];
      const b = roster[j];
      const key = out.find((r) => (r.aId === a.id && r.bId === b.id) || (r.aId === b.id && r.bId === a.id));
      const sa = season.get(a.id);
      const sb = season.get(b.id);
      // Dois criadores com ego alto e uso alto tendem a atritar.
      const egoClash = (a.personality.ego + b.personality.ego) / 200;
      const usageClash = sa && sb ? clamp01(((sa.totals.fga / Math.max(1, sa.games)) + (sb.totals.fga / Math.max(1, sb.games))) / 42) : 0.3;
      const winning = team.wins + team.losses > 0 ? team.wins / (team.wins + team.losses) : 0.5;
      const delta = (winning - 0.5) * 22 + (1 - egoClash) * 8 - usageClash * 9 + rng.normal(0, 6);
      if (key) {
        key.value = clamp(key.value + delta, -100, 100);
        key.kind = key.value > 55 ? 'duo' : key.value > 18 ? 'friendship' : key.value < -35 ? 'rivalry' : 'neutral';
      } else {
        const value = clamp(delta, -100, 100);
        out.push({
          aId: a.id, bId: b.id, value,
          kind: value > 55 ? 'duo' : value > 18 ? 'friendship' : value < -35 ? 'rivalry' : 'neutral',
        });
      }
    }
  }
  return out;
}

/** Quimica de equipe derivada dos relacionamentos. */
export function teamChemistry(team: Team, relationships: Relationship[]): number {
  const ids = new Set(team.roster.map((p) => p.id));
  const rel = relationships.filter((r) => ids.has(r.aId) && ids.has(r.bId));
  if (!rel.length) return 0.55;
  const avg = rel.reduce((s, r) => s + r.value, 0) / rel.length;
  return clamp01(0.55 + avg / 260);
}
