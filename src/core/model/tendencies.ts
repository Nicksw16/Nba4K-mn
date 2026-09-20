/**
 * Tendencias (0..100). Definem QUAO frequentemente um atleta escolhe cada acao.
 * A IA usa tendencias como peso; os atributos definem se a acao da certo.
 * Separar os dois e o que faz dois jogadores com atributos iguais jogarem diferente.
 */
export interface Tendencies {
  // Selecao de arremesso por zona
  shootRim: number;
  shootPaint: number;
  shootMid: number;
  shootThree: number;
  shootDeepThree: number;
  shootCorner: number;
  // Criacao
  drive: number;
  driveLeft: number;
  pullup: number;
  stepback: number;
  catchAndShoot: number;
  isolation: number;
  postUp: number;
  useScreen: number;
  attackClose: number;
  // Passe
  pass: number;
  extraPass: number;
  lobPass: number;
  flashyPass: number;
  // Fora da bola
  cut: number;
  spotUp: number;
  setScreen: number;
  crashOffensiveGlass: number;
  runFloor: number;
  // Defesa
  playPassingLane: number;
  helpSide: number;
  contest: number;
  attemptSteal: number;
  attemptBlock: number;
  boxOut: number;
  foulAggression: number;
  // Drible
  dribbleFrequency: number;
  comboMoves: number;
  sizeUp: number;
}

export const DEFAULT_TENDENCIES: Tendencies = {
  shootRim: 55, shootPaint: 45, shootMid: 40, shootThree: 45, shootDeepThree: 15, shootCorner: 45,
  drive: 45, driveLeft: 40, pullup: 35, stepback: 25, catchAndShoot: 50, isolation: 30, postUp: 20, useScreen: 50, attackClose: 45,
  pass: 55, extraPass: 45, lobPass: 25, flashyPass: 15,
  cut: 45, spotUp: 55, setScreen: 45, crashOffensiveGlass: 35, runFloor: 50,
  playPassingLane: 35, helpSide: 50, contest: 60, attemptSteal: 35, attemptBlock: 35, boxOut: 55, foulAggression: 35,
  dribbleFrequency: 45, comboMoves: 30, sizeUp: 30,
};

export function makeTendencies(overrides: Partial<Tendencies> = {}): Tendencies {
  return { ...DEFAULT_TENDENCIES, ...overrides };
}

/** Arquetipos de tendencia (secao 7: estilos de assinatura, todos originais). */
export type PlayStyle =
  | 'explosive_slasher'
  | 'cerebral_floor_general'
  | 'shifty_shot_creator'
  | 'power_guard'
  | 'point_forward'
  | 'isolation_scorer'
  | 'movement_shooter'
  | 'stretch_big'
  | 'post_scorer'
  | 'rim_runner'
  | 'lockdown_wing'
  | 'defensive_anchor'
  | 'connector_3d';

export const PLAY_STYLE_LABELS: Record<PlayStyle, string> = {
  explosive_slasher: 'Infiltrador Explosivo',
  cerebral_floor_general: 'General Cerebral',
  shifty_shot_creator: 'Criador Escorregadio',
  power_guard: 'Armador de Forca',
  point_forward: 'Ala-Armador',
  isolation_scorer: 'Pontuador de Isolacao',
  movement_shooter: 'Atirador em Movimento',
  stretch_big: 'Pivo de Perimetro',
  post_scorer: 'Pontuador de Poste',
  rim_runner: 'Corredor de Aro',
  lockdown_wing: 'Ala Travador',
  defensive_anchor: 'Ancora Defensiva',
  connector_3d: 'Conector 3&D',
};

export const STYLE_TENDENCIES: Record<PlayStyle, Partial<Tendencies>> = {
  explosive_slasher: { drive: 82, shootRim: 78, attackClose: 75, shootThree: 28, pullup: 25, cut: 70, crashOffensiveGlass: 45, runFloor: 75, dribbleFrequency: 55 },
  cerebral_floor_general: { pass: 82, extraPass: 75, useScreen: 78, shootThree: 52, pullup: 45, drive: 45, isolation: 25, lobPass: 55, flashyPass: 20, dribbleFrequency: 60 },
  shifty_shot_creator: { dribbleFrequency: 80, comboMoves: 72, sizeUp: 70, stepback: 68, pullup: 65, isolation: 62, shootThree: 62, drive: 58 },
  power_guard: { drive: 70, postUp: 42, attackClose: 68, shootMid: 50, pass: 55, isolation: 50, crashOffensiveGlass: 40 },
  point_forward: { pass: 74, useScreen: 55, postUp: 45, drive: 58, shootThree: 48, extraPass: 68, lobPass: 45 },
  isolation_scorer: { isolation: 82, dribbleFrequency: 72, pullup: 70, stepback: 60, shootMid: 65, shootThree: 55, pass: 32, extraPass: 25 },
  movement_shooter: { catchAndShoot: 85, shootThree: 78, shootCorner: 70, cut: 65, spotUp: 78, dribbleFrequency: 30, pullup: 30 },
  stretch_big: { shootThree: 68, shootCorner: 58, spotUp: 72, setScreen: 72, postUp: 30, crashOffensiveGlass: 30, shootRim: 45 },
  post_scorer: { postUp: 82, shootPaint: 70, shootRim: 65, shootMid: 45, crashOffensiveGlass: 55, setScreen: 55, drive: 25, shootThree: 12 },
  rim_runner: { cut: 80, runFloor: 85, setScreen: 78, shootRim: 82, crashOffensiveGlass: 65, shootThree: 8, drive: 30 },
  lockdown_wing: { contest: 80, attemptSteal: 55, playPassingLane: 55, helpSide: 60, boxOut: 60, shootCorner: 58, spotUp: 65, shootThree: 52 },
  defensive_anchor: { contest: 82, attemptBlock: 72, boxOut: 80, helpSide: 78, setScreen: 70, shootRim: 70, shootThree: 5, crashOffensiveGlass: 55 },
  connector_3d: { spotUp: 75, catchAndShoot: 72, shootCorner: 68, cut: 55, contest: 70, helpSide: 62, extraPass: 70, pass: 60 },
};

export function tendenciesForStyle(style: PlayStyle, overrides: Partial<Tendencies> = {}): Tendencies {
  return makeTendencies({ ...STYLE_TENDENCIES[style], ...overrides });
}
