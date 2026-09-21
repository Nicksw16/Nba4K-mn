/**
 * PROGRESSAO (secoes 44, 48, 49, 50, 62, 123).
 *
 * O progresso vem do QUE o atleta faz em quadra, nao de um contador generico:
 * arremessar bem sobe a trilha de arremesso, defender sobe a de defesa. Cada
 * trilha entrega tokens de badge da sua categoria, e badges so podem ser
 * equipadas com atributo suficiente + token + slot livre.
 */
import { Attributes, ATTRIBUTE_CATEGORY, ATTRIBUTE_KEYS } from '../model/attributes.js';
import { BadgeCategory, BadgeSlots, emptySlots } from '../model/badges.js';
import { PlayerStats } from '../stats/boxscore.js';
import { clamp, clamp01, lerp } from '../math/util.js';

export interface ProgressionState {
  level: number;
  xp: number;
  /** XP por trilha de especializacao (secao 50). */
  tracks: Record<BadgeCategory, number>;
  /** Tokens disponiveis por categoria. */
  tokens: BadgeSlots;
  /** Cap breakers disponiveis (secao 48). */
  capBreakers: number;
  rebirths: number;
  /** Reputacao social (secao 62). */
  rep: number;
  /** Medalhas conquistadas (secao 61). */
  medals: string[];
}

export function createProgression(): ProgressionState {
  return {
    level: 1,
    xp: 0,
    tracks: { shooting: 0, finishing: 0, playmaking: 0, defense: 0, rebounding: 0, physicals: 0 },
    tokens: emptySlots(),
    capBreakers: 0,
    rebirths: 0,
    rep: 0,
    medals: [],
  };
}

export const MAX_LEVEL = 40;

/** XP necessario para o proximo nivel (curva suave, sem muro). */
export function xpForLevel(level: number): number {
  return Math.round(420 * Math.pow(level, 1.32));
}

export const REP_TIERS = ['Novato', 'Ascendente', 'Profissional', 'Estrela', 'Elite', 'Lenda'] as const;
export type RepTier = typeof REP_TIERS[number];

export function repTier(rep: number): RepTier {
  const thresholds = [0, 2500, 8000, 20000, 45000, 90000];
  let tier: RepTier = 'Novato';
  for (let i = 0; i < thresholds.length; i++) if (rep >= thresholds[i]) tier = REP_TIERS[i];
  return tier;
}

export interface GameContribution {
  stats: PlayerStats;
  won: boolean;
  /** 0..1 - proporcao dos minutos possiveis jogados. */
  minutesShare: number;
  /** Eficiencia relativa a expectativa da posicao. */
  efficiency: number;
}

/** XP por trilha derivado do que realmente aconteceu na partida. */
export function awardFromGame(state: ProgressionState, c: GameContribution): {
  gained: number;
  byTrack: Record<BadgeCategory, number>;
  levelsGained: number;
  newTokens: BadgeSlots;
  medals: string[];
} {
  const s = c.stats;
  const byTrack: Record<BadgeCategory, number> = {
    shooting: s.tpm * 26 + (s.fgm - s.tpm) * 12 + s.ftm * 5 + (s.fga >= 8 && s.fgm / Math.max(1, s.fga) > 0.5 ? 60 : 0),
    finishing: s.dunks * 22 + s.paintTouches * 4 + s.secondChancePoints * 6,
    playmaking: s.assists * 26 + s.passes * 0.8 - s.turnovers * 10 + s.ankleBreaks * 30,
    defense: s.steals * 34 + s.blocks * 32 + s.deflections * 12,
    rebounding: s.oreb * 22 + s.dreb * 12 + s.screenAssists * 14,
    physicals: Math.round(s.distanceRun * 0.55 + s.maxSpeed * 6 + s.secondsPlayed * 0.12),
  };

  const winBonus = c.won ? 1.16 : 1;
  const usageBonus = lerp(0.75, 1.2, clamp01(c.minutesShare));
  let gained = 0;
  for (const k of Object.keys(byTrack) as BadgeCategory[]) {
    byTrack[k] = Math.max(0, Math.round(byTrack[k] * winBonus * usageBonus));
    state.tracks[k] += byTrack[k];
    gained += byTrack[k];
  }
  state.xp += gained;
  state.rep += Math.round(gained * 0.45 + (c.won ? 120 : 45));

  // Tokens: cada 900 de XP de trilha libera um token daquela categoria.
  const newTokens = emptySlots();
  for (const k of Object.keys(state.tracks) as BadgeCategory[]) {
    const earned = Math.floor(state.tracks[k] / 900);
    const already = state.tokens[k];
    if (earned > already) {
      newTokens[k] = earned - already;
      state.tokens[k] = earned;
    }
  }

  let levelsGained = 0;
  while (state.level < MAX_LEVEL && state.xp >= xpForLevel(state.level)) {
    state.xp -= xpForLevel(state.level);
    state.level++;
    levelsGained++;
    // Cap breakers so aparecem perto do teto (secao 48).
    if (state.level >= MAX_LEVEL - 8) state.capBreakers += 1;
  }

  const medals = checkMedals(state, s);
  return { gained, byTrack, levelsGained, newTokens, medals };
}

/** MEDALHAS (secao 61): marcos verificados contra o que foi feito. */
export interface MedalDef {
  id: string;
  name: string;
  description: string;
  test: (s: PlayerStats) => boolean;
}

export const MEDALS: MedalDef[] = [
  { id: 'triple_double', name: 'Triplo-Duplo', description: 'Duas casas em tres categorias na mesma partida.', test: (s) => [s.points, s.assists, s.oreb + s.dreb, s.steals, s.blocks].filter((v) => v >= 10).length >= 3 },
  { id: 'forty_burger', name: '40 Pontos', description: 'Marcar 40 ou mais em uma partida.', test: (s) => s.points >= 40 },
  { id: 'dime_master', name: 'Distribuidor', description: '15 assistencias em uma partida.', test: (s) => s.assists >= 15 },
  { id: 'glass_night', name: 'Dono do Vidro', description: '20 rebotes em uma partida.', test: (s) => s.oreb + s.dreb >= 20 },
  { id: 'lockdown_night', name: 'Noite Travada', description: '5 roubos e 3 tocos na mesma partida.', test: (s) => s.steals >= 5 && s.blocks >= 3 },
  { id: 'efficient', name: 'Eficiencia Cirurgica', description: '25 pontos com 65% de aproveitamento.', test: (s) => s.points >= 25 && s.fga >= 10 && s.fgm / s.fga >= 0.65 },
  { id: 'deep_range', name: 'Chuva de Tres', description: '8 bolas de tres convertidas.', test: (s) => s.tpm >= 8 },
  { id: 'poster', name: 'Poster', description: '5 enterradas em uma partida.', test: (s) => s.dunks >= 5 },
  { id: 'iron_man', name: 'Homem de Ferro', description: '44 minutos em quadra.', test: (s) => s.secondsPlayed >= 44 * 60 },
  { id: 'ankle_collector', name: 'Colecionador de Tornozelos', description: '3 ankle breakers em uma partida.', test: (s) => s.ankleBreaks >= 3 },
];

function checkMedals(state: ProgressionState, s: PlayerStats): string[] {
  const out: string[] = [];
  for (const m of MEDALS) {
    if (state.medals.includes(m.id)) continue;
    if (m.test(s)) {
      state.medals.push(m.id);
      out.push(m.id);
    }
  }
  return out;
}

/**
 * Desafios de especializacao (secao 50): cada trilha tem metas proprias que
 * liberam cap upgrades, badges e cosmeticos.
 */
export interface SpecializationChallenge {
  id: string;
  track: BadgeCategory;
  name: string;
  description: string;
  target: number;
  progressFrom: (s: PlayerStats) => number;
  reward: { capBreakers?: number; tokens?: Partial<BadgeSlots>; cosmetic?: string };
}

export const CHALLENGES: SpecializationChallenge[] = [
  { id: 'sh_catch', track: 'shooting', name: 'Pe Firme', description: 'Converter 50 bolas de tres apos passe.', target: 50, progressFrom: (s) => s.tpm, reward: { capBreakers: 1, tokens: { shooting: 1 } } },
  { id: 'sh_deep', track: 'shooting', name: 'Alcance Profundo', description: 'Converter 25 arremessos alem do arco profundo.', target: 25, progressFrom: (s) => (s.byZone.deep_three?.made ?? 0), reward: { tokens: { shooting: 1 }, cosmetic: 'manga_atirador' } },
  { id: 'fi_contact', track: 'finishing', name: 'Atravessar a Parede', description: 'Converter 40 finalizacoes com contato.', target: 40, progressFrom: (s) => s.dunks + (s.byZone.rim?.made ?? 0), reward: { capBreakers: 1, tokens: { finishing: 1 } } },
  { id: 'pl_dimes', track: 'playmaking', name: 'Visao Total', description: 'Distribuir 200 assistencias.', target: 200, progressFrom: (s) => s.assists, reward: { capBreakers: 1, tokens: { playmaking: 1 } } },
  { id: 'pl_care', track: 'playmaking', name: 'Mao Segura', description: '20 partidas com no maximo 2 erros.', target: 20, progressFrom: (s) => (s.turnovers <= 2 ? 1 : 0), reward: { tokens: { playmaking: 1 } } },
  { id: 'de_stops', track: 'defense', name: 'Fechadura', description: 'Somar 120 roubos e tocos.', target: 120, progressFrom: (s) => s.steals + s.blocks, reward: { capBreakers: 1, tokens: { defense: 1 } } },
  { id: 're_glass', track: 'rebounding', name: 'Dono do Garrafao', description: 'Pegar 400 rebotes.', target: 400, progressFrom: (s) => s.oreb + s.dreb, reward: { capBreakers: 1, tokens: { rebounding: 1 } } },
  { id: 'ph_motor', track: 'physicals', name: 'Motor Infinito', description: 'Correr 250 km em partidas.', target: 250000, progressFrom: (s) => s.distanceRun, reward: { capBreakers: 1, tokens: { physicals: 1 }, cosmetic: 'tenis_motor' } },
];

export type ChallengeProgress = Record<string, number>;

export function advanceChallenges(progress: ChallengeProgress, s: PlayerStats, state: ProgressionState): { completed: SpecializationChallenge[] } {
  const completed: SpecializationChallenge[] = [];
  for (const c of CHALLENGES) {
    const before = progress[c.id] ?? 0;
    if (before >= c.target) continue;
    const after = before + c.progressFrom(s);
    progress[c.id] = after;
    if (after >= c.target) {
      completed.push(c);
      if (c.reward.capBreakers) state.capBreakers += c.reward.capBreakers;
      if (c.reward.tokens) {
        for (const [k, v] of Object.entries(c.reward.tokens) as [BadgeCategory, number][]) {
          state.tokens[k] += v;
        }
      }
    }
  }
  return { completed };
}

/** Aplica um ponto de atributo pago com progressao. */
export function upgradeAttribute(attrs: Attributes, key: keyof Attributes, state: ProgressionState, cap: number): boolean {
  if (attrs[key] >= cap) return false;
  const cost = attrs[key] < 70 ? 1 : attrs[key] < 80 ? 2 : attrs[key] < 90 ? 3 : 4;
  if (state.capBreakers < cost) return false;
  state.capBreakers -= cost;
  attrs[key] = Math.min(99, attrs[key] + 1);
  return true;
}

export function trackSummary(state: ProgressionState): { track: BadgeCategory; xp: number; tokens: number; nextToken: number }[] {
  return (Object.keys(state.tracks) as BadgeCategory[]).map((track) => ({
    track,
    xp: state.tracks[track],
    tokens: state.tokens[track],
    nextToken: 900 - (state.tracks[track] % 900),
  }));
}
