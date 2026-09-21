/**
 * TELA DE CARREIRA (secoes 51 a 53, 62, 109 a 111).
 *
 * A tela le o estado e mostra consequencia: minutos projetados vem da
 * confianca do tecnico, que veio do rendimento das ultimas partidas. As
 * manchetes sao geradas dos numeros, nao de um roteiro.
 */
import { AppContext } from '../main.js';
import { el, clear, table, selectRow } from '../ui/dom.js';
import { CareerSave } from '../../core/save/save.js';
import { CareerState, ERAS, STAGE_LABELS, advanceStage, applyGameToCareer, buildChoices, careerSummary, createCareer } from '../../core/career/career.js';
import { BuildInput, buildToPlayer, evaluateBuild } from '../../core/model/build.js';
import { PlayerProfile, fullName } from '../../core/model/player.js';
import { Team, teamLabel } from '../../core/model/team.js';
import { overall } from '../../core/model/attributes.js';
import { MEDALS, advanceChallenges, awardFromGame, repTier, trackSummary, CHALLENGES } from '../../core/career/progression.js';
import { Rng } from '../../core/math/rng.js';
import { openBuilder } from './builder.js';
import { clamp } from '../../core/math/util.js';

interface CareerSession {
  career: CareerState;
  build: BuildInput;
  player: PlayerProfile;
  team: Team;
  rng: Rng;
  challenges: Record<string, number>;
  lastReport: string[];
}

let session: CareerSession | null = null;

export function openCareer(ctx: AppContext): void {
  const root = el('div', { class: 'screen' });
  ctx.ui.appendChild(root);

  const render = () => {
    clear(root);
    root.appendChild(el('div', { class: 'brand' }, [
      el('h1', { text: 'CARREIRA' }),
      el('p', { text: session ? careerSummary(session.career)[0] : 'do banco ao legado' }),
    ]));
    if (!session) renderStart(ctx, root, render);
    else renderHub(ctx, root, render);
  };
  render();
}

function renderStart(ctx: AppContext, root: HTMLElement, rerender: () => void): void {
  const saved = ctx.saves.read<CareerSave>('career', 'default');
  let eraId = ERAS[ERAS.length - 1].id;
  let teamIdx = 0;

  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Era' }),
    selectRow('Periodo historico', eraId, ERAS.map((e) => ({ value: e.id, label: `${e.name} (${e.years})` })), (v) => {
      eraId = v;
      rerenderEraInfo();
    }),
    el('div', { id: 'era-info' }),
  ]));

  const eraInfo = root.querySelector('#era-info') as HTMLElement;
  function rerenderEraInfo(): void {
    const era = ERAS.find((e) => e.id === eraId)!;
    clear(eraInfo);
    eraInfo.appendChild(el('p', { class: 'hint', text: era.description }));
    eraInfo.appendChild(el('p', { class: 'hint', text: `Meta da era: ${(era.meta.threeRate * 100).toFixed(0)}% das tentativas de tres · ritmo ${era.meta.pace} posses · fisicalidade ${era.meta.physicality.toFixed(2)}x` }));
  }
  rerenderEraInfo();

  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Equipe inicial' }),
    selectRow('Equipe', String(teamIdx), ctx.league.teams.map((t, i) => ({ value: String(i), label: teamLabel(t.identity) })), (v) => { teamIdx = Number(v); }),
    el('p', { class: 'hint', text: 'Voce comeca com minutos limitados. Rendimento aumenta a confianca do tecnico, que aumenta os minutos.' }),
  ]));

  const actions: HTMLElement[] = [];
  if (saved) {
    actions.push(el('button', { class: 'action', text: `Continuar (${saved.meta.label})`, onclick: () => {
      startSession(ctx, saved.build, saved.career, ctx.league.teams[teamIdx]);
      rerender();
    } }));
  }
  actions.push(el('button', { class: 'action', text: 'Criar atleta', onclick: () => {
    clear(ctx.ui);
    openBuilder(ctx, (input, result, badges) => {
      const career = createCareer(`user_${Date.now()}`, eraId);
      const player = buildToPlayer(input, career.playerId, result);
      player.badges = badges;
      clear(ctx.ui);
      startSession(ctx, input, career, ctx.league.teams[teamIdx], player);
      openCareer(ctx);
    });
  } }));
  actions.push(el('button', { class: 'ghost', text: 'Voltar', onclick: () => ctx.go('main') }));
  root.appendChild(el('div', { class: 'toolbar' }, actions));
}

function startSession(ctx: AppContext, build: BuildInput, career: CareerState, team: Team, existing?: PlayerProfile): void {
  const result = evaluateBuild(build);
  const player = existing ?? buildToPlayer(build, career.playerId, result);
  player.teamId = team.identity.id;
  // O atleta entra no elenco no lugar do ultimo do banco.
  if (!team.roster.some((p) => p.id === player.id)) {
    team.roster = [...team.roster.slice(0, 14), player];
  }
  career.teamId = team.identity.id;
  session = {
    career,
    build,
    player,
    team,
    rng: new Rng(`career-${career.playerId}`),
    challenges: {},
    lastReport: [],
  };
}

function renderHub(ctx: AppContext, root: HTMLElement, rerender: () => void): void {
  const s = session!;
  const summary = careerSummary(s.career);

  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: `${fullName(s.player)} · ${s.player.position} · ${overall(s.player.attributes, s.player.position)} OVR` }),
    ...summary.map((line) => el('p', { class: 'hint', text: line })),
    el('div', { class: 'toolbar' }, [
      el('button', { class: 'action', text: 'Jogar a proxima partida', onclick: () => playGame(ctx, rerender) }),
      el('button', { class: 'ghost', text: 'Simular a proxima partida', onclick: () => simulateGame(ctx, rerender) }),
      el('button', { class: 'ghost', text: 'Salvar carreira', onclick: () => {
        ctx.saves.write<CareerSave>({
          meta: { slot: 'default', kind: 'career', label: fullName(s.player), updatedAt: 0, version: 0 },
          career: s.career, build: s.build, leagueSeed: 'courtside-legacy', season: s.career.season,
        });
        ctx.app.flash('CARREIRA SALVA');
      } }),
    ]),
  ]));

  if (s.lastReport.length) {
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Ultima partida' }),
      ...s.lastReport.map((l) => el('p', { class: 'hint', text: l })),
    ]));
  }

  // Decisoes de carreira: cada opcao muda estado real.
  const choices = buildChoices(s.career);
  if (choices.length) {
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Decisoes' }),
      ...choices.map((c) => el('div', {}, [
        el('p', { class: 'hint', text: c.prompt }),
        el('div', { class: 'toolbar' }, c.options.map((o) => el('button', {
          class: 'ghost', text: o.label,
          onclick: () => {
            const msg = o.effect(s.career);
            s.lastReport = [msg];
            rerender();
          },
        }))),
      ])),
    ]));
  }

  // Progressao por trilha.
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Trilhas de especializacao' }),
    table(['Trilha', 'XP', 'Tokens', 'Proximo token em'],
      trackSummary(s.career.progression).map((t) => [t.track, t.xp, t.tokens, t.nextToken])),
    el('p', { class: 'hint', text: `Cap breakers disponiveis: ${s.career.progression.capBreakers} · Reputacao: ${repTier(s.career.progression.rep)}` }),
  ]));

  // Desafios.
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Desafios' }),
    table(['Desafio', 'Trilha', 'Progresso', 'Meta'],
      CHALLENGES.map((c) => [c.name, c.track, Math.round(s.challenges[c.id] ?? 0), c.target])),
  ]));

  // Medalhas.
  const earned = s.career.progression.medals;
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: `Medalhas (${earned.length}/${MEDALS.length})` }),
    el('div', { class: 'badge-list' }, MEDALS.map((m) => el('div', {
      class: `badge${earned.includes(m.id) ? ' on' : ''}`,
    }, [el('div', {}, [el('b', { text: m.name }), el('small', { text: m.description })])]))),
  ]));

  // Manchetes.
  if (s.career.headlines.length) {
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Imprensa' }),
      ...s.career.headlines.slice(-8).reverse().map((h) => el('p', { class: 'hint', text: `T${h.season}: ${h.text}` })),
    ]));
  }

  root.appendChild(el('div', { class: 'toolbar' }, [
    el('button', { class: 'ghost', text: 'Voltar ao menu', onclick: () => ctx.go('main') }),
  ]));
}

function opponentFor(ctx: AppContext, s: CareerSession): Team {
  const others = ctx.league.teams.filter((t) => t.identity.id !== s.team.identity.id);
  return others[Math.floor(s.rng.next() * others.length)];
}

function playGame(ctx: AppContext, rerender: () => void): void {
  const s = session!;
  const opponent = opponentFor(ctx, s);
  // Os minutos projetados definem se ele comeca jogando.
  const starting = s.career.projectedMinutes >= 26;
  if (starting && !s.team.starters.includes(s.player.id)) {
    s.team.starters = [s.player.id, ...s.team.starters.slice(0, 4)];
  }
  ctx.startGame(s.team, opponent, {
    userTeam: 0,
    userPlayerId: s.player.id,
    onEnd: (sim) => {
      const stats = sim.box.players.get(s.player.id);
      if (stats) finishGame(ctx, stats, sim.box.teams[0].points > sim.box.teams[1].points);
      ctx.go('career');
    },
  });
}

function simulateGame(ctx: AppContext, rerender: () => void): void {
  const s = session!;
  const opponent = opponentFor(ctx, s);
  // Usa o simulador estatistico, respeitando os minutos projetados.
  import('../../core/franchise/quicksim.js').then(({ quickSimGame }) => {
    const result = quickSimGame(s.team, opponent, s.rng);
    const stats = result.box.players.get(s.player.id);
    if (stats) {
      // Ajusta os minutos ao que o tecnico concedeu.
      const scale = (s.career.projectedMinutes * 60) / Math.max(60, stats.secondsPlayed);
      stats.secondsPlayed *= scale;
      stats.points = Math.round(stats.points * scale);
      stats.assists = Math.round(stats.assists * scale);
      stats.oreb = Math.round(stats.oreb * scale);
      stats.dreb = Math.round(stats.dreb * scale);
      finishGame(ctx, stats, result.homeScore > result.awayScore);
    }
    rerender();
  });
}

function finishGame(ctx: AppContext, stats: ReturnType<typeof Map.prototype.get>, won: boolean): void {
  const s = session!;
  const st = stats as import('../../core/stats/boxscore.js').PlayerStats;
  const report: string[] = [];

  const teamNeed = clamp(1 - overall(s.player.attributes, s.player.position) / 99, 0.2, 1);
  const careerResult = applyGameToCareer(s.career, st, won, teamNeed, s.rng);
  report.push(`${st.points} pts · ${st.oreb + st.dreb} reb · ${st.assists} ast em ${(st.secondsPlayed / 60).toFixed(0)} min (${won ? 'vitoria' : 'derrota'}).`);
  report.push(`Confianca do tecnico ${careerResult.trustDelta >= 0 ? '+' : ''}${careerResult.trustDelta.toFixed(1)} · minutos projetados ${s.career.projectedMinutes.toFixed(0)}.`);

  const award = awardFromGame(s.career.progression, {
    stats: st, won, minutesShare: st.secondsPlayed / (36 * 60),
    efficiency: st.points / Math.max(1, st.fga),
  });
  report.push(`XP ganho: ${award.gained} (nivel ${s.career.progression.level}).`);
  if (award.levelsGained > 0) report.push(`Subiu ${award.levelsGained} nivel(is).`);
  for (const [cat, n] of Object.entries(award.newTokens)) {
    if (n > 0) report.push(`Novo token de ${cat}.`);
  }
  for (const m of award.medals) {
    const def = MEDALS.find((x) => x.id === m);
    if (def) report.push(`Medalha conquistada: ${def.name}.`);
  }

  const challenge = advanceChallenges(s.challenges, st, s.career.progression);
  for (const c of challenge.completed) report.push(`Desafio concluido: ${c.name}.`);

  if (careerResult.headline) report.push(`Imprensa: ${careerResult.headline}`);
  advanceStage(s.career, overall(s.player.attributes, s.player.position), 0);
  s.lastReport = report;
}
