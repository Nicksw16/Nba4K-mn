/**
 * CONTRATOS, FREE AGENCY E GM TRUST (secoes 64, 65, 66, 67).
 *
 * Dinheiro nao e o unico fator: papel, vitorias, cidade, companheiros,
 * treinador, minutos e chance de titulo entram na decisao. E a palavra do GM
 * vale: promessa quebrada derruba a confianca e encarece toda negociacao
 * futura.
 */
import { Rng } from '../math/rng.js';
import { PlayerProfile, PlayerContract, fullName } from '../model/player.js';
import { Team } from '../model/team.js';
import { overall } from '../model/attributes.js';
import { clamp, clamp01, lerp } from '../math/util.js';
import { LeagueRules } from './league.js';

export interface GmTrust {
  /** 0..100 */
  value: number;
  /** Promessas ativas. */
  promises: Promise_[];
  history: { season: number; text: string; delta: number }[];
}

export interface Promise_ {
  id: string;
  playerId: string;
  kind: 'minutes' | 'role' | 'contend' | 'extension' | 'no_trade';
  detail: string;
  /** Valor prometido (minutos, por exemplo). */
  target: number;
  season: number;
  resolved?: 'kept' | 'broken';
}

export function createTrust(): GmTrust {
  return { value: 55, promises: [], history: [] };
}

export function makePromise(trust: GmTrust, p: Promise_): void {
  trust.promises.push(p);
}

export function resolvePromise(trust: GmTrust, id: string, kept: boolean, season: number): void {
  const pr = trust.promises.find((x) => x.id === id);
  if (!pr || pr.resolved) return;
  pr.resolved = kept ? 'kept' : 'broken';
  const delta = kept ? 4 : -14;
  trust.value = clamp(trust.value + delta, 0, 100);
  trust.history.push({ season, text: `${kept ? 'Promessa cumprida' : 'Promessa quebrada'}: ${pr.detail}`, delta });
}

/** Valor de mercado anual (em milhoes) de um atleta. */
export function marketValue(p: PlayerProfile, rules: LeagueRules): number {
  const ovr = overall(p.attributes, p.position);
  // Curva: 60 OVR vale minimo, 95 OVR vale contrato maximo.
  const base = Math.pow(clamp01((ovr - 58) / 40), 2.1) * (rules.salaryCap * 0.35);
  const ageFactor = p.age <= 24 ? 1.06 : p.age <= 29 ? 1 : p.age <= 33 ? 0.86 : 0.62;
  const durability = 0.92 + (p.attributes.durability / 99) * 0.12;
  return Math.max(1.1, base * ageFactor * durability);
}

export function payroll(team: Team): number {
  return team.roster.reduce((s, p) => s + (p.contract?.salary ?? 0), 0);
}

export function capSpace(team: Team, rules: LeagueRules): number {
  return rules.salaryCap - payroll(team);
}

export interface FreeAgentOffer {
  teamId: string;
  salary: number;
  years: number;
  role: 'star' | 'starter' | 'rotation' | 'bench';
  guaranteed: boolean;
  playerOption: boolean;
  promisedMinutes?: number;
}

export interface OfferEvaluation {
  score: number;
  breakdown: {
    money: number;
    role: number;
    winning: number;
    market: number;
    teammates: number;
    coach: number;
    trust: number;
    minutes: number;
  };
  wouldSign: boolean;
  reason: string;
}

/** O atleta avalia a oferta com a propria personalidade. */
export function evaluateOffer(
  player: PlayerProfile,
  offer: FreeAgentOffer,
  team: Team,
  trust: GmTrust,
  rules: LeagueRules,
  rng: Rng,
): OfferEvaluation {
  const value = marketValue(player, rules);
  const pers = player.personality;

  const money = clamp01(offer.salary / Math.max(1, value)) * (0.6 + (100 - pers.loyalty) / 220);
  const roleScore: Record<FreeAgentOffer['role'], number> = { star: 1, starter: 0.78, rotation: 0.5, bench: 0.22 };
  const wantedRole = overall(player.attributes, player.position) >= 84 ? 'star'
    : overall(player.attributes, player.position) >= 76 ? 'starter' : 'rotation';
  const roleFit = clamp01(1 - Math.abs(roleScore[offer.role] - roleScore[wantedRole as FreeAgentOffer['role']]));
  const role = roleFit * (0.5 + pers.ego / 160);

  const record = team.wins + team.losses > 0 ? team.wins / (team.wins + team.losses) : 0.5;
  const winning = record * (0.4 + pers.winNowPreference / 130);

  const marketFit = pers.marketPreference === 'any' ? 0.6
    : pers.marketPreference === team.identity.marketSize ? 1 : 0.35;

  const bestMate = Math.max(...team.roster.map((p) => overall(p.attributes, p.position)), 0);
  const teammates = clamp01((bestMate - 70) / 25) * (0.4 + pers.ambition / 200);

  const coach = clamp01((team.coach.offenseRating + team.coach.defenseRating) / 200) * (0.4 + pers.coachability / 180);
  const trustScore = clamp01(trust.value / 100);
  const minutes = offer.promisedMinutes ? clamp01(offer.promisedMinutes / 34) : 0.5;

  const breakdown = {
    money: money * 0.34,
    role: role * 0.16,
    winning: winning * 0.15,
    market: marketFit * 0.07,
    teammates: teammates * 0.1,
    coach: coach * 0.06,
    trust: trustScore * 0.07,
    minutes: minutes * 0.05,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0) + rng.normal(0, 0.035);

  const threshold = 0.52 + (pers.ambition / 100) * 0.06;
  const wouldSign = score >= threshold;
  const weakest = Object.entries(breakdown).sort((a, b) => a[1] - b[1])[0][0];
  const labels: Record<string, string> = {
    money: 'valor abaixo do mercado', role: 'papel oferecido', winning: 'projeto pouco competitivo',
    market: 'preferencia de cidade', teammates: 'qualidade do elenco', coach: 'comissao tecnica',
    trust: 'historico da diretoria', minutes: 'minutos prometidos',
  };
  return {
    score,
    breakdown,
    wouldSign,
    reason: wouldSign ? 'Aceita a proposta.' : `Recusa: ${labels[weakest]}.`,
  };
}

export function signContract(player: PlayerProfile, offer: FreeAgentOffer, team: Team): void {
  player.contract = {
    salary: offer.salary,
    yearsRemaining: offer.years,
    teamOption: false,
    playerOption: offer.playerOption,
    guaranteed: offer.guaranteed,
    incentives: [],
    noTrade: false,
  };
  player.teamId = team.identity.id;
  if (!team.roster.some((p) => p.id === player.id)) team.roster.push(player);
}

/** Extensao: o atleta compara com o que ganharia no mercado aberto. */
export function evaluateExtension(player: PlayerProfile, salary: number, years: number, team: Team, trust: GmTrust, rules: LeagueRules, rng: Rng): OfferEvaluation {
  return evaluateOffer(player, {
    teamId: team.identity.id,
    salary,
    years,
    role: team.starters.includes(player.id) ? 'starter' : 'rotation',
    guaranteed: true,
    playerOption: false,
  }, team, trust, rules, rng);
}

/** Recompra de contrato: o time paga parte e libera o atleta. */
export function buyout(team: Team, playerId: string, fraction = 0.6): number {
  const idx = team.roster.findIndex((p) => p.id === playerId);
  if (idx < 0) return 0;
  const p = team.roster[idx];
  const cost = (p.contract?.salary ?? 0) * fraction;
  team.roster.splice(idx, 1);
  p.teamId = undefined;
  if (p.contract) p.contract.yearsRemaining = 0;
  return cost;
}

export interface TradeProposal {
  fromTeamId: string;
  toTeamId: string;
  fromPlayers: string[];
  toPlayers: string[];
}

export interface TradeEvaluation {
  accepted: boolean;
  valueIn: number;
  valueOut: number;
  salaryIn: number;
  salaryOut: number;
  reason: string;
}

/** Valor de troca: talento, idade, contrato e encaixe. */
export function tradeValue(p: PlayerProfile, rules: LeagueRules): number {
  const ovr = overall(p.attributes, p.position);
  const talent = Math.pow(clamp01((ovr - 55) / 44), 2.3) * 100;
  const youth = p.age <= 23 ? 1.35 : p.age <= 26 ? 1.15 : p.age <= 30 ? 1 : p.age <= 33 ? 0.72 : 0.42;
  const salary = p.contract?.salary ?? marketValue(p, rules);
  const value = marketValue(p, rules);
  const contractQuality = clamp(value / Math.max(0.8, salary), 0.55, 1.8);
  return talent * youth * contractQuality;
}

export function evaluateTrade(proposal: TradeProposal, teams: Map<string, Team>, rules: LeagueRules, trust: GmTrust): TradeEvaluation {
  const from = teams.get(proposal.fromTeamId);
  const to = teams.get(proposal.toTeamId);
  if (!from || !to) return { accepted: false, valueIn: 0, valueOut: 0, salaryIn: 0, salaryOut: 0, reason: 'Times invalidos.' };

  const get = (team: Team, ids: string[]) => ids.map((id) => team.roster.find((p) => p.id === id)).filter((p): p is PlayerProfile => !!p);
  const outgoing = get(from, proposal.fromPlayers);
  const incoming = get(to, proposal.toPlayers);

  const valueOut = outgoing.reduce((s, p) => s + tradeValue(p, rules), 0);
  const valueIn = incoming.reduce((s, p) => s + tradeValue(p, rules), 0);
  const salaryOut = outgoing.reduce((s, p) => s + (p.contract?.salary ?? 0), 0);
  const salaryIn = incoming.reduce((s, p) => s + (p.contract?.salary ?? 0), 0);

  // O outro time avalia: precisa receber mais valor do que entrega.
  const trustBonus = (trust.value - 50) / 250;
  const demanded = valueIn * (1.08 - trustBonus);
  const salaryOk = Math.abs(salaryIn - salaryOut) <= Math.max(5, Math.max(salaryIn, salaryOut) * 0.25);

  if (!salaryOk) {
    return { accepted: false, valueIn, valueOut, salaryIn, salaryOut, reason: 'Salarios nao batem dentro da regra de troca.' };
  }
  const accepted = valueOut >= demanded;
  return {
    accepted,
    valueIn,
    valueOut,
    salaryIn,
    salaryOut,
    reason: accepted ? 'Proposta aceita.' : `Proposta recusada: falta valor (${(demanded - valueOut).toFixed(0)} pontos).`,
  };
}

export function executeTrade(proposal: TradeProposal, teams: Map<string, Team>): void {
  const from = teams.get(proposal.fromTeamId)!;
  const to = teams.get(proposal.toTeamId)!;
  const move = (a: Team, b: Team, ids: string[]) => {
    for (const id of ids) {
      const i = a.roster.findIndex((p) => p.id === id);
      if (i < 0) continue;
      const [p] = a.roster.splice(i, 1);
      p.teamId = b.identity.id;
      b.roster.push(p);
      a.starters = a.starters.filter((s) => s !== id);
      a.rotation = a.rotation.filter((s) => s !== id);
    }
  };
  move(from, to, proposal.fromPlayers);
  move(to, from, proposal.toPlayers);
}
