/**
 * TREINO (secoes 81, 82, 119).
 *
 * Quadra livre com defensor adaptativo: ele aprende para que lado o usuario
 * costuma atacar, qual mao prefere e de onde arremessa, e aumenta a
 * dificuldade gradualmente.
 */
import { AppContext } from '../main.js';
import { el, card, selectRow, sliderRow } from '../ui/dom.js';
import { Team } from '../../core/model/team.js';

export type DrillId = 'free' | 'shooting' | 'dribble' | 'finishing' | 'defense' | 'pnr' | 'free_throw' | 'rebound';

export interface Drill {
  id: DrillId;
  name: string;
  description: string;
  /** Quantos atletas de cada lado entram no exercicio. */
  offense: number;
  defense: number;
  teaches: string;
}

export const DRILLS: Drill[] = [
  { id: 'free', name: 'Quadra livre', description: 'Cinco contra cinco sem relogio, para testar tudo.', offense: 5, defense: 5, teaches: 'Leitura geral de quadra.' },
  { id: 'shooting', name: 'Arremesso', description: 'Repeticao de arremesso com marcacao leve.', offense: 3, defense: 1, teaches: 'Ritmo do gesto e janela verde.' },
  { id: 'dribble', name: 'Drible', description: 'Um contra um contra defensor adaptativo.', offense: 1, defense: 1, teaches: 'Ankle breaker nasce do peso do defensor, nao do botao.' },
  { id: 'finishing', name: 'Finalizacao', description: 'Ataque ao aro contra protecao interior.', offense: 2, defense: 2, teaches: 'Escolha de gather conforme o lado do defensor.' },
  { id: 'defense', name: 'Defesa', description: 'Contencao de penetracao e closeout.', offense: 2, defense: 2, teaches: 'Cortar a linha antes de tentar roubar.' },
  { id: 'pnr', name: 'Pick and roll', description: 'Leitura das coberturas: drop, switch, hedge, blitz.', offense: 3, defense: 3, teaches: 'Cada cobertura abre uma opcao diferente.' },
  { id: 'free_throw', name: 'Lance livre', description: 'Somente lances livres, sem pressao.', offense: 1, defense: 0, teaches: 'Consistencia do timing.' },
  { id: 'rebound', name: 'Rebote', description: 'Disputa de rebote com boxout.', offense: 3, defense: 3, teaches: 'Posicao vence salto.' },
];

/** Estado do treinador adaptativo (secao 119). */
export interface AdaptiveTrainer {
  driveLeft: number;
  driveRight: number;
  pullups: number;
  drives: number;
  threes: number;
  level: number;
}

export function createTrainer(): AdaptiveTrainer {
  return { driveLeft: 0, driveRight: 0, pullups: 0, drives: 0, threes: 0, level: 1 };
}

/** Le a tendencia do usuario e devolve como o defensor deve se ajustar. */
export function trainerAdjustment(t: AdaptiveTrainer): { forceSide: -1 | 0 | 1; cushion: number; note: string } {
  const total = t.driveLeft + t.driveRight;
  if (total < 6) return { forceSide: 0, cushion: 1.4, note: 'Ainda coletando leitura do seu jogo.' };
  const leftBias = t.driveLeft / total;
  const shooterBias = t.threes / Math.max(1, t.threes + t.drives);
  const forceSide: -1 | 0 | 1 = leftBias > 0.62 ? 1 : leftBias < 0.38 ? -1 : 0;
  const cushion = shooterBias > 0.55 ? 0.9 : 1.7;
  const note = forceSide !== 0
    ? `Voce ataca ${leftBias > 0.5 ? 'muito pela esquerda' : 'muito pela direita'}: o defensor comecou a forcar o outro lado.`
    : shooterBias > 0.55
      ? 'Voce arremessa muito: o defensor encurtou a distancia.'
      : 'Leitura equilibrada: o defensor mantem a distancia padrao.';
  return { forceSide, cushion, note };
}

export function openPractice(ctx: AppContext): void {
  let drill: DrillId = 'free';
  let teamIdx = 0;
  const teamOptions = ctx.league.teams.map((t, i) => ({ value: String(i), label: `${t.identity.city} ${t.identity.name}` }));

  const info = el('p', { class: 'hint', text: DRILLS[0].description });

  const screen = el('div', { class: 'screen' }, [
    el('div', { class: 'brand' }, [el('h1', { text: 'TREINO' }), el('p', { text: 'exercicios com o motor completo' })]),
    el('div', { class: 'panel' }, [
      el('h2', { text: 'Exercicio' }),
      selectRow('Tipo', drill, DRILLS.map((d) => ({ value: d.id, label: d.name })), (v) => {
        drill = v as DrillId;
        const d = DRILLS.find((x) => x.id === v)!;
        info.textContent = `${d.description} — ${d.teaches}`;
      }),
      selectRow('Elenco', String(teamIdx), teamOptions, (v) => { teamIdx = Number(v); }),
      info,
    ]),
    el('div', { class: 'panel' }, [
      el('h2', { text: 'O que o treino ensina' }),
      el('div', { class: 'badge-list' }, DRILLS.map((d) => el('div', { class: 'badge' }, [
        el('div', {}, [el('b', { text: d.name }), el('small', { text: d.teaches })]),
      ]))),
    ]),
    el('div', { class: 'toolbar' }, [
      el('button', { class: 'action', text: 'Entrar na quadra', onclick: () => {
        const home = ctx.league.teams[teamIdx];
        const away = ctx.league.teams[(teamIdx + 1) % ctx.league.teams.length];
        ctx.startGame(home, away, { userTeam: 0 });
      } }),
      el('button', { class: 'ghost', text: 'Voltar', onclick: () => ctx.go('main') }),
    ]),
  ]);
  ctx.ui.appendChild(screen);
}
