/**
 * TELA DE FRANQUIA (secoes 63 a 72).
 *
 * Cada botao opera sobre o estado real da liga: simular dias move o
 * calendario, trocar move atletas entre elencos, assinar consome espaco
 * salarial e muda a confianca do GM.
 */
import { AppContext } from '../main.js';
import { el, clear, table, selectRow, sliderRow } from '../ui/dom.js';
import { Rng } from '../../core/math/rng.js';
import {
  DEFAULT_RULES, SeasonState, computeAwards, conferenceStandings, createSeason,
  runPlayoffs, simulateDay,
} from '../../core/franchise/league.js';
import { Team, teamLabel } from '../../core/model/team.js';
import { overall } from '../../core/model/attributes.js';
import { fullName } from '../../core/model/player.js';
import { GmTrust, createTrust, capSpace, evaluateOffer, evaluateTrade, executeTrade, marketValue, payroll, signContract, tradeValue } from '../../core/franchise/contracts.js';
import { developPlayer, draftOrder, generateDraftClass, runDraft } from '../../core/franchise/development.js';
import { FranchiseSave } from '../../core/save/save.js';
import { clamp } from '../../core/math/util.js';

interface FranchiseSession {
  season: SeasonState;
  userTeamId: string;
  trust: GmTrust;
  rng: Rng;
  log: string[];
}

let session: FranchiseSession | null = null;

export function openFranchise(ctx: AppContext): void {
  const root = el('div', { class: 'screen' });
  ctx.ui.appendChild(root);

  const render = () => {
    clear(root);
    root.appendChild(el('div', { class: 'brand' }, [
      el('h1', { text: 'FRANQUIA' }),
      el('p', { text: session ? `temporada ${session.season.season} · dia ${session.season.day}` : 'assuma uma equipe' }),
    ]));

    if (!session) {
      renderSetup(ctx, root, render);
      return;
    }
    renderDashboard(ctx, root, render);
  };
  render();
}

function renderSetup(ctx: AppContext, root: HTMLElement, rerender: () => void): void {
  let teamIdx = 0;
  let games = 82;
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Escolha a equipe' }),
    selectRow('Equipe', String(teamIdx), ctx.league.teams.map((t, i) => ({
      value: String(i),
      label: `${teamLabel(t.identity)} (${t.identity.conference}) · media ${Math.round(t.roster.slice(0, 8).reduce((s, p) => s + overall(p.attributes, p.position), 0) / 8)}`,
    })), (v) => { teamIdx = Number(v); }),
    sliderRow('Jogos por equipe', games, 20, 82, 2, (v) => `${v} jogos`, (v) => { games = v; }),
    el('p', { class: 'hint', text: 'Os jogos da liga sao resolvidos por simulacao estatistica calibrada; os seus podem ser jogados no motor fisico completo.' }),
  ]));
  root.appendChild(el('div', { class: 'toolbar' }, [
    el('button', { class: 'action', text: 'Comecar temporada', onclick: () => {
      const rng = new Rng(`franchise-${Date.now()}`);
      const rules = { ...DEFAULT_RULES, gamesPerTeam: games };
      session = {
        season: createSeason(ctx.league, rules, rng),
        userTeamId: ctx.league.teams[teamIdx].identity.id,
        trust: createTrust(),
        rng,
        log: ['Temporada iniciada.'],
      };
      rerender();
    } }),
    el('button', { class: 'ghost', text: 'Voltar', onclick: () => ctx.go('main') }),
  ]));
}

function renderDashboard(ctx: AppContext, root: HTMLElement, rerender: () => void): void {
  const s = session!;
  const team = ctx.league.teams.find((t) => t.identity.id === s.userTeamId)!;
  const standing = s.season.standings.get(team.identity.id)!;

  // --- Resumo ---
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: teamLabel(team.identity) }),
    el('p', { class: 'hint', text: `${standing.wins}-${standing.losses} · folha ${payroll(team).toFixed(1)}M de ${s.season.rules.salaryCap}M · espaco ${capSpace(team, s.season.rules).toFixed(1)}M · confianca do GM ${s.trust.value.toFixed(0)}%` }),
    el('div', { class: 'toolbar' }, [
      el('button', { class: 'action', text: 'Simular 1 dia', onclick: () => { advance(ctx, 1); rerender(); } }),
      el('button', { class: 'ghost', text: 'Simular 7 dias', onclick: () => { advance(ctx, 7); rerender(); } }),
      el('button', { class: 'ghost', text: 'Simular ate o fim', onclick: () => { advance(ctx, 400); rerender(); } }),
      el('button', { class: 'ghost', text: 'Jogar o proximo jogo', onclick: () => playNext(ctx, rerender) }),
      el('button', { class: 'ghost', text: 'Salvar', onclick: () => {
        ctx.saves.write<FranchiseSave>({
          meta: { slot: 'default', kind: 'franchise', label: teamLabel(team.identity), updatedAt: 0, version: 0 },
          leagueSeed: 'courtside-legacy',
          season: s.season.season,
          userTeamId: s.userTeamId,
          standings: [...s.season.standings.entries()],
          day: s.season.day,
          trust: s.trust.value,
        });
        ctx.app.flash('FRANQUIA SALVA');
      } }),
    ]),
  ]));

  // --- Classificacao ---
  for (const conf of ['Leste', 'Oeste'] as const) {
    const rows = conferenceStandings(ctx.league, s.season, conf);
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: `Conferencia ${conf}` }),
      table(['#', 'Equipe', 'V', 'D', '%', 'Saldo', 'Seq'],
        rows.map((r, i) => [
          i + 1, teamLabel(r.team.identity), r.wins, r.losses, (r.pct * 100).toFixed(1),
          r.diff > 0 ? `+${r.diff}` : String(r.diff),
          r.streak > 0 ? `V${r.streak}` : r.streak < 0 ? `D${-r.streak}` : '-',
        ]),
        (i) => rows[i].team.identity.id === s.userTeamId),
    ]));
  }

  // --- Elenco ---
  const roster = [...team.roster].sort((a, b) => overall(b.attributes, b.position) - overall(a.attributes, a.position));
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Elenco' }),
    el('div', { class: 'scroll' }, [
      table(['Jogador', 'Pos', 'Idade', 'OVR', 'POT', 'Salario', 'Anos', 'Mercado', 'Valor de troca'],
        roster.map((p) => [
          fullName(p), p.position, p.age, overall(p.attributes, p.position), overall(p.potential, p.position),
          `${(p.contract?.salary ?? 0).toFixed(1)}M`, p.contract?.yearsRemaining ?? 0,
          `${marketValue(p, s.season.rules).toFixed(1)}M`,
          tradeValue(p, s.season.rules).toFixed(0),
        ])),
    ]),
  ]));

  // --- Trocas ---
  let outId = roster[0]?.id ?? '';
  let partnerIdx = ctx.league.teams.findIndex((t) => t.identity.id !== s.userTeamId);
  let inId = '';
  const tradeResult = el('p', { class: 'hint', text: 'Selecione atletas e avalie a proposta.' });
  const partnerSelect = el('div');
  const buildPartnerSelect = () => {
    clear(partnerSelect);
    const partner = ctx.league.teams[partnerIdx];
    const list = [...partner.roster].sort((a, b) => overall(b.attributes, b.position) - overall(a.attributes, a.position));
    inId = list[0]?.id ?? '';
    partnerSelect.appendChild(selectRow('Recebe', inId, list.map((p) => ({
      value: p.id, label: `${fullName(p)} (${overall(p.attributes, p.position)} OVR · ${(p.contract?.salary ?? 0).toFixed(1)}M)`,
    })), (v) => { inId = v; }));
  };
  buildPartnerSelect();

  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Central de trocas' }),
    selectRow('Envia', outId, roster.map((p) => ({
      value: p.id, label: `${fullName(p)} (${overall(p.attributes, p.position)} OVR · ${(p.contract?.salary ?? 0).toFixed(1)}M)`,
    })), (v) => { outId = v; }),
    selectRow('Parceiro', String(partnerIdx), ctx.league.teams
      .map((t, i) => ({ value: String(i), label: teamLabel(t.identity) }))
      .filter((o) => ctx.league.teams[Number(o.value)].identity.id !== s.userTeamId),
      (v) => { partnerIdx = Number(v); buildPartnerSelect(); }),
    partnerSelect,
    tradeResult,
    el('div', { class: 'toolbar' }, [
      el('button', { class: 'ghost', text: 'Avaliar', onclick: () => {
        const teams = new Map(ctx.league.teams.map((t) => [t.identity.id, t]));
        const evaluation = evaluateTrade({
          fromTeamId: s.userTeamId, toTeamId: ctx.league.teams[partnerIdx].identity.id,
          fromPlayers: [outId], toPlayers: [inId],
        }, teams, s.season.rules, s.trust);
        tradeResult.textContent = `${evaluation.reason} (valor enviado ${evaluation.valueOut.toFixed(0)} x recebido ${evaluation.valueIn.toFixed(0)}; salarios ${evaluation.salaryOut.toFixed(1)}M x ${evaluation.salaryIn.toFixed(1)}M)`;
      } }),
      el('button', { class: 'action', text: 'Executar troca', onclick: () => {
        const teams = new Map(ctx.league.teams.map((t) => [t.identity.id, t]));
        const proposal = { fromTeamId: s.userTeamId, toTeamId: ctx.league.teams[partnerIdx].identity.id, fromPlayers: [outId], toPlayers: [inId] };
        const evaluation = evaluateTrade(proposal, teams, s.season.rules, s.trust);
        if (!evaluation.accepted) {
          tradeResult.textContent = evaluation.reason;
          return;
        }
        executeTrade(proposal, teams);
        s.log.unshift(`Troca concluida com ${ctx.league.teams[partnerIdx].identity.name}.`);
        rerender();
      } }),
    ]),
  ]));

  // --- Free agency ---
  const freeAgents = ctx.league.teams
    .flatMap((t) => t.roster)
    .filter((p) => !p.teamId)
    .slice(0, 12);
  if (freeAgents.length) {
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Free agency' }),
      el('div', { class: 'scroll' }, [
        table(['Jogador', 'Idade', 'OVR', 'Pedido', 'Avaliacao'],
          freeAgents.map((p) => {
            const offer = { teamId: team.identity.id, salary: marketValue(p, s.season.rules), years: 3, role: 'rotation' as const, guaranteed: true, playerOption: false };
            const evaluation = evaluateOffer(p, offer, team, s.trust, s.season.rules, s.rng);
            return [fullName(p), p.age, overall(p.attributes, p.position), `${offer.salary.toFixed(1)}M`, evaluation.reason];
          })),
      ]),
    ]));
  }

  // --- Log ---
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Diario da temporada' }),
    ...s.log.slice(0, 12).map((l) => el('p', { class: 'hint', text: l })),
  ]));

  root.appendChild(el('div', { class: 'toolbar' }, [
    el('button', { class: 'ghost', text: 'Voltar ao menu', onclick: () => ctx.go('main') }),
    el('button', { class: 'ghost', text: 'Encerrar temporada', onclick: () => { finishSeason(ctx); rerender(); } }),
  ]));
}

function advance(ctx: AppContext, days: number): void {
  const s = session!;
  for (let i = 0; i < days && !s.season.finished; i++) {
    const result = simulateDay(ctx.league, s.season, s.rng);
    const mine = result.games.find((g) => g.game.homeId === s.userTeamId || g.game.awayId === s.userTeamId);
    if (mine) {
      const g = mine.game;
      const home = g.homeId === s.userTeamId;
      const my = home ? g.homeScore! : g.awayScore!;
      const other = home ? g.awayScore! : g.homeScore!;
      s.log.unshift(`Dia ${s.season.day}: ${my > other ? 'vitoria' : 'derrota'} ${my}-${other} contra ${home ? mine.awayName : mine.homeName}.`);
    }
  }
  if (s.season.finished) s.log.unshift('Temporada regular encerrada.');
}

function playNext(ctx: AppContext, rerender: () => void): void {
  const s = session!;
  const next = s.season.schedule.find((g) => !g.played && (g.homeId === s.userTeamId || g.awayId === s.userTeamId));
  if (!next) {
    ctx.app.flash('SEM JOGOS');
    return;
  }
  const home = ctx.league.teams.find((t) => t.identity.id === next.homeId)!;
  const away = ctx.league.teams.find((t) => t.identity.id === next.awayId)!;
  const userTeam: 0 | 1 = next.homeId === s.userTeamId ? 0 : 1;
  ctx.startGame(home, away, {
    userTeam,
    onEnd: (sim) => {
      next.played = true;
      next.homeScore = sim.box.teams[0].points;
      next.awayScore = sim.box.teams[1].points;
      const hs = s.season.standings.get(next.homeId)!;
      const as = s.season.standings.get(next.awayId)!;
      hs.pointsFor += next.homeScore; hs.pointsAgainst += next.awayScore;
      as.pointsFor += next.awayScore; as.pointsAgainst += next.homeScore;
      if (next.homeScore > next.awayScore) { hs.wins++; as.losses++; home.wins++; away.losses++; }
      else { as.wins++; hs.losses++; away.wins++; home.losses++; }
      s.log.unshift(`Jogo disputado: ${next.homeScore}-${next.awayScore}.`);
      ctx.go('franchise');
    },
  });
}

function finishSeason(ctx: AppContext): void {
  const s = session!;
  while (!s.season.finished) simulateDay(ctx.league, s.season, s.rng);
  const playoffs = runPlayoffs(ctx.league, s.season, s.rng);
  const champ = ctx.league.teams.find((t) => t.identity.id === playoffs.champion);
  s.log.unshift(`Campeao: ${champ ? teamLabel(champ.identity) : 'indefinido'}.`);

  const awards = computeAwards(ctx.league, s.season);
  s.season.awards = awards;
  const nameOf = (id: string) => {
    for (const t of ctx.league.teams) {
      const p = t.roster.find((x) => x.id === id);
      if (p) return fullName(p);
    }
    return '-';
  };
  s.log.unshift(`MVP: ${nameOf(awards.mvp)} · Defensor: ${nameOf(awards.dpoy)} · Calouro: ${nameOf(awards.roty)}`);

  // Desenvolvimento, aposentadorias e draft.
  let retirements = 0;
  for (const team of ctx.league.teams) {
    const keep: typeof team.roster = [];
    for (const p of team.roster) {
      const result = developPlayer(p, s.season.playerSeason.get(p.id), team, s.rng);
      if (result.retired) {
        retirements++;
        continue;
      }
      if (p.contract) {
        p.contract.yearsRemaining = Math.max(0, p.contract.yearsRemaining - 1);
      }
      keep.push(p);
    }
    team.roster = keep;
  }
  s.log.unshift(`${retirements} aposentadorias na liga.`);

  const order = draftOrder(ctx.league, s.season.standings, s.rng);
  const prospects = generateDraftClass(s.rng, s.season.season);
  const picks = runDraft(ctx.league, order, prospects, 2, s.rng);
  const myPick = picks.find((p) => p.teamId === s.userTeamId);
  if (myPick) s.log.unshift(`Draft: sua equipe escolheu na posicao ${myPick.pick}.`);

  ctx.league.season++;
  s.season = createSeason(ctx.league, s.season.rules, s.rng);
  s.season.season = ctx.league.season;
  s.log.unshift(`Nova temporada ${ctx.league.season} iniciada.`);
}
