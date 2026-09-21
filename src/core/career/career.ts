/**
 * CARREIRA (secoes 51, 52, 53, 69, 109, 110, 111).
 *
 * A narrativa NAO e um roteiro fixo: ela e lida do estado. Minutos, producao,
 * vitorias, relacao com o treinador e reputacao produzem manchetes, ofertas e
 * oportunidades. Comecar no banco e virar titular acontece porque os numeros
 * mudaram, nao porque a fase 3 do roteiro chegou.
 */
import { Rng } from '../math/rng.js';
import { PlayerProfile } from '../model/player.js';
import { Team } from '../model/team.js';
import { PlayerStats } from '../stats/boxscore.js';
import { ProgressionState, createProgression, repTier } from './progression.js';
import { clamp, clamp01, lerp } from '../math/util.js';
import { DeepPartial, Tuning } from '../config/tuning.js';

export type CareerStage =
  | 'youth' | 'college' | 'pre_draft' | 'draft' | 'rookie'
  | 'rotation' | 'starter' | 'all_star' | 'superstar' | 'veteran' | 'legacy' | 'retired';

export const STAGE_LABELS: Record<CareerStage, string> = {
  youth: 'Base',
  college: 'Universitario',
  pre_draft: 'Pre-draft',
  draft: 'Noite do draft',
  rookie: 'Temporada de calouro',
  rotation: 'Rotacao',
  starter: 'Titular',
  all_star: 'All-Star',
  superstar: 'Superestrela',
  veteran: 'Veterano',
  legacy: 'Legado',
  retired: 'Aposentado',
};

/** ERAS JOGAVEIS (secao 52). Cada uma muda regras, ritmo e apresentacao. */
export interface Era {
  id: string;
  name: string;
  years: string;
  description: string;
  /** Ajustes de tuning aplicados sobre o padrao. */
  tuning: DeepPartial<Tuning>;
  /** Estilo visual do HUD e da transmissao. */
  presentation: {
    palette: string[];
    scorebug: 'classic' | 'modern' | 'minimal' | 'retro';
    film: 'grain' | 'clean' | 'broadcast_sd' | 'broadcast_hd';
  };
  /** Distribuicao de arremesso esperada da era. */
  meta: { threeRate: number; pace: number; paintRate: number; physicality: number };
}

export const ERAS: Era[] = [
  {
    id: 'classic_rivalry',
    name: 'Era das Rivalidades',
    years: 'Periodo I',
    description: 'Jogo fisico, meia-distancia dominante, pouca bola de tres e defesa com contato permitido.',
    tuning: {
      fouls: { contactBase: 0.02 },
      ai: { shotQualityThreshold: 0.5 },
      defense: { aggressiveFoulMult: 1.6 },
      shooting: { comfortDistAt99: 7.4 },
    },
    presentation: { palette: ['#c9a227', '#7a1f2b', '#f2ead6'], scorebug: 'retro', film: 'grain' },
    meta: { threeRate: 0.08, pace: 104, paintRate: 0.52, physicality: 1.35 },
  },
  {
    id: 'global_superstar',
    name: 'Era das Superestrelas Globais',
    years: 'Periodo II',
    description: 'Isolacao no perimetro, pivos dominantes e defesa de garrafao pesada.',
    tuning: {
      ai: { shotQualityThreshold: 0.52, passWillingness: 0.58 },
      fouls: { contactBase: 0.026 },
    },
    presentation: { palette: ['#1b3a6b', '#e8b84b', '#ffffff'], scorebug: 'classic', film: 'broadcast_sd' },
    meta: { threeRate: 0.16, pace: 92, paintRate: 0.46, physicality: 1.2 },
  },
  {
    id: 'early_2000s',
    name: 'Era do Meio-Campo',
    years: 'Periodo III',
    description: 'Ritmo baixo, muito jogo de costas e meia-distancia; defesa de zona liberada.',
    tuning: {
      ai: { shotQualityThreshold: 0.56, clockPressureStart: 5 },
      game: { shotClock: 24 },
    },
    presentation: { palette: ['#2b2f77', '#ff6b35', '#f5f5f5'], scorebug: 'classic', film: 'broadcast_sd' },
    meta: { threeRate: 0.19, pace: 88, paintRate: 0.5, physicality: 1.25 },
  },
  {
    id: 'modern_pace',
    name: 'Era do Ritmo',
    years: 'Periodo IV',
    description: 'Transicao constante, pick and roll como base e espacamento de quatro fora.',
    tuning: {
      ai: { shotQualityThreshold: 0.5, driveWillingness: 0.6 },
      locomotion: { sprintFactor: 1.2 },
    },
    presentation: { palette: ['#0b6e99', '#8fd6ff', '#0d1117'], scorebug: 'modern', film: 'broadcast_hd' },
    meta: { threeRate: 0.32, pace: 100, paintRate: 0.4, physicality: 0.95 },
  },
  {
    id: 'three_revolution',
    name: 'Era da Revolucao do Tres',
    years: 'Periodo V',
    description: 'Cinco jogadores capazes de arremessar, defesa trocando tudo e volume historico de tres.',
    tuning: {
      ai: { shotQualityThreshold: 0.46, spacingTarget: 5.8 },
      shooting: { comfortDistAt99: 9.1, distanceFalloff: 0.042 },
    },
    presentation: { palette: ['#5c2d91', '#f5c518', '#101014'], scorebug: 'minimal', film: 'clean' },
    meta: { threeRate: 0.45, pace: 102, paintRate: 0.33, physicality: 0.85 },
  },
];

export const ERA_BY_ID = new Map(ERAS.map((e) => [e.id, e]));

export interface CareerRelationship {
  who: string;
  role: 'coach' | 'teammate' | 'gm' | 'rival' | 'media' | 'sponsor';
  value: number;
}

export interface CareerState {
  playerId: string;
  stage: CareerStage;
  eraId: string;
  season: number;
  teamId?: string;
  progression: ProgressionState;
  /** Confianca do treinador: controla minutos. */
  coachTrust: number;
  /** Minutos projetados na proxima partida. */
  projectedMinutes: number;
  relationships: CareerRelationship[];
  /** Historico de manchetes geradas. */
  headlines: { season: number; text: string; tone: 'positive' | 'negative' | 'neutral' }[];
  /** Acumulado de carreira. */
  totals: { games: number; points: number; rebounds: number; assists: number; steals: number; blocks: number; wins: number; losses: number };
  accolades: string[];
  /** Moedas separadas (secao 112). */
  currency: { earned: number; cosmetic: number };
  /** Arvore de legado (secao 69). */
  legacyPoints: number;
  generation: number;
}

export function createCareer(playerId: string, eraId = 'three_revolution'): CareerState {
  return {
    playerId,
    stage: 'youth',
    eraId,
    season: 1,
    progression: createProgression(),
    coachTrust: 42,
    projectedMinutes: 12,
    relationships: [],
    headlines: [],
    totals: { games: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, wins: 0, losses: 0 },
    accolades: [],
    currency: { earned: 0, cosmetic: 0 },
    legacyPoints: 0,
    generation: 1,
  };
}

/**
 * Atualiza a carreira apos uma partida. Tudo que muda aqui vem de numeros:
 * confianca do tecnico sobe com eficiencia e desce com erro e falta.
 */
export function applyGameToCareer(
  career: CareerState,
  stats: PlayerStats,
  won: boolean,
  teamNeed: number,
  rng: Rng,
): { headline?: string; minutesDelta: number; trustDelta: number } {
  const minutes = stats.secondsPlayed / 60;
  const efficiency = minutes > 0
    ? (stats.points + stats.assists * 1.6 + (stats.oreb + stats.dreb) * 1.1 + stats.steals * 2 + stats.blocks * 2
      - stats.turnovers * 2 - (stats.fga - stats.fgm) * 0.7) / Math.max(6, minutes)
    : 0;

  const expected = lerp(0.35, 0.95, clamp01(career.coachTrust / 100));
  const delta = clamp((efficiency - expected) * 8, -9, 11);
  const trustDelta = delta + (won ? 1.2 : -0.6) - (stats.fouls >= 5 ? 1.4 : 0);
  career.coachTrust = clamp(career.coachTrust + trustDelta, 0, 100);

  const before = career.projectedMinutes;
  career.projectedMinutes = clamp(
    lerp(6, 38, clamp01(career.coachTrust / 100)) * (0.85 + teamNeed * 0.3),
    4, 40,
  );

  career.totals.games++;
  career.totals.points += stats.points;
  career.totals.rebounds += stats.oreb + stats.dreb;
  career.totals.assists += stats.assists;
  career.totals.steals += stats.steals;
  career.totals.blocks += stats.blocks;
  if (won) career.totals.wins++;
  else career.totals.losses++;

  career.currency.earned += Math.round(stats.points * 12 + stats.assists * 18 + (stats.oreb + stats.dreb) * 10 + (won ? 320 : 120));
  career.currency.cosmetic += Math.round(8 + (won ? 6 : 2));

  const headline = generateHeadline(career, stats, won, trustDelta, rng);
  if (headline) career.headlines.push({ season: career.season, text: headline, tone: trustDelta >= 0 ? 'positive' : 'negative' });

  return { headline, minutesDelta: career.projectedMinutes - before, trustDelta };
}

function generateHeadline(career: CareerState, s: PlayerStats, won: boolean, trustDelta: number, rng: Rng): string | undefined {
  const pts = s.points;
  const reb = s.oreb + s.dreb;
  const triple = [pts, s.assists, reb, s.steals, s.blocks].filter((v) => v >= 10).length >= 3;
  if (triple) return `Noite de triplo-duplo: ${pts} pontos, ${reb} rebotes e ${s.assists} assistencias.`;
  if (pts >= 35) return `Explosao de ${pts} pontos ${won ? 'decide a partida' : 'nao evita a derrota'}.`;
  if (s.blocks >= 5) return `Defesa em modo muralha: ${s.blocks} tocos na noite.`;
  if (s.assists >= 12) return `Comando total: ${s.assists} assistencias distribuidas.`;
  if (s.turnovers >= 6) return `Noite dificil com ${s.turnovers} erros de posse.`;
  if (trustDelta > 6) return 'Comissao tecnica elogia o rendimento e promete mais minutos.';
  if (trustDelta < -6) return 'Rendimento abaixo do esperado coloca os minutos em risco.';
  if (rng.chance(0.25)) return won ? 'Vitoria mantem o time na briga.' : 'Derrota acende o alerta no vestiario.';
  return undefined;
}

/** Avanca o estagio a partir do rendimento acumulado, nao do tempo. */
export function advanceStage(career: CareerState, ovr: number, allStarSelections: number): CareerStage {
  const ppg = career.totals.games ? career.totals.points / career.totals.games : 0;
  let next: CareerStage = career.stage;
  switch (career.stage) {
    case 'youth': next = 'college'; break;
    case 'college': next = 'pre_draft'; break;
    case 'pre_draft': next = 'draft'; break;
    case 'draft': next = 'rookie'; break;
    case 'rookie': next = career.projectedMinutes >= 20 ? 'rotation' : 'rookie'; break;
    case 'rotation': next = career.projectedMinutes >= 30 && ovr >= 76 ? 'starter' : 'rotation'; break;
    case 'starter': next = allStarSelections >= 1 || (ovr >= 84 && ppg >= 19) ? 'all_star' : 'starter'; break;
    case 'all_star': next = ovr >= 90 && ppg >= 24 ? 'superstar' : 'all_star'; break;
    case 'superstar': next = career.totals.games > 700 ? 'veteran' : 'superstar'; break;
    case 'veteran': next = career.totals.games > 1000 ? 'legacy' : 'veteran'; break;
    default: break;
  }
  career.stage = next;
  return next;
}

/** Decisoes de carreira: cada escolha muda estado real, nunca so texto. */
export interface CareerChoice {
  id: string;
  prompt: string;
  options: {
    id: string;
    label: string;
    effect: (c: CareerState) => string;
  }[];
}

export function buildChoices(career: CareerState): CareerChoice[] {
  const out: CareerChoice[] = [];
  if (career.stage === 'college') {
    out.push({
      id: 'college_path',
      prompt: 'Como voce quer chegar ao profissional?',
      options: [
        { id: 'college', label: 'Universidade tradicional', effect: (c) => { c.progression.tracks.shooting += 900; c.coachTrust += 6; return 'Um ano de fundamento: mais base tecnica e confianca com treinadores.'; } },
        { id: 'gleague', label: 'Liga de desenvolvimento', effect: (c) => { c.progression.tracks.physicals += 1200; c.currency.earned += 2500; return 'Contato com profissionais: fisico acelerado e salario antecipado.'; } },
        { id: 'overseas', label: 'Profissional no exterior', effect: (c) => { c.progression.tracks.playmaking += 1000; c.progression.rep += 1400; return 'Rodagem contra adultos: leitura de jogo e visibilidade.'; } },
      ],
    });
  }
  if (career.stage === 'rookie' || career.stage === 'rotation') {
    out.push({
      id: 'work_focus',
      prompt: 'Onde voce vai concentrar o trabalho diario?',
      options: [
        { id: 'shot', label: 'Mecanica de arremesso', effect: (c) => { c.progression.tracks.shooting += 1500; return 'Trilha de arremesso acelerada.'; } },
        { id: 'def', label: 'Fundamentos defensivos', effect: (c) => { c.progression.tracks.defense += 1500; c.coachTrust += 8; return 'Trilha defensiva acelerada e mais confianca do tecnico.'; } },
        { id: 'body', label: 'Preparacao fisica', effect: (c) => { c.progression.tracks.physicals += 1500; return 'Trilha fisica acelerada.'; } },
      ],
    });
  }
  if (career.coachTrust < 35) {
    out.push({
      id: 'locker_room',
      prompt: 'Voce esta fora da rotacao. Qual a atitude?',
      options: [
        { id: 'work', label: 'Chegar mais cedo e treinar dobrado', effect: (c) => { c.coachTrust += 12; c.progression.tracks.physicals += 600; return 'A comissao nota o esforco.'; } },
        { id: 'talk', label: 'Conversar com o treinador', effect: (c) => { c.coachTrust += 6; c.relationships.push({ who: 'Treinador', role: 'coach', value: 12 }); return 'Conversa franca abre espaco.'; } },
        { id: 'trade', label: 'Pedir troca publicamente', effect: (c) => { c.coachTrust -= 14; c.progression.rep += 800; return 'Repercussao alta, relacao desgastada.'; } },
      ],
    });
  }
  return out;
}

/** CO-OP CAREER (secao 53): um companheiro controlavel por outro jogador. */
export interface CompanionState {
  playerId: string;
  controlledByHuman: boolean;
  progression: ProgressionState;
}

export function createCompanion(playerId: string): CompanionState {
  return { playerId, controlledByHuman: false, progression: createProgression() };
}

/** Resumo textual para a tela de carreira. */
export function careerSummary(c: CareerState): string[] {
  const g = Math.max(1, c.totals.games);
  return [
    `${STAGE_LABELS[c.stage]} · Temporada ${c.season} · ${ERA_BY_ID.get(c.eraId)?.name ?? ''}`,
    `${(c.totals.points / g).toFixed(1)} pts · ${(c.totals.rebounds / g).toFixed(1)} reb · ${(c.totals.assists / g).toFixed(1)} ast em ${c.totals.games} jogos`,
    `Confianca do tecnico ${c.coachTrust.toFixed(0)}% · minutos projetados ${c.projectedMinutes.toFixed(0)}`,
    `Nivel ${c.progression.level} · ${repTier(c.progression.rep)} · ${c.progression.medals.length} medalhas`,
  ];
}
