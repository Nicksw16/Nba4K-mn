/**
 * TUNING - todo valor critico de gameplay vive aqui (secao 137: data-driven design).
 * Nenhum sistema deve hardcodar constantes de balanceamento; todos leem daqui.
 * O objeto e clonavel e serializavel, o que permite sliders, presets de dificuldade
 * e perfis de "realismo" sem recompilar nada.
 */

export interface Tuning {
  sim: {
    /** Passo fixo da simulacao (s). 120 Hz da estabilidade ao contato. */
    dt: number;
    maxSubstepsPerFrame: number;
    gravity: number;
  };
  locomotion: {
    /** Velocidade de pico (m/s) para atributo speed=99 em corrida livre. */
    topSpeedAt99: number;
    topSpeedAt25: number;
    /** Aceleracao (m/s^2) de pico para acceleration=99. */
    accelAt99: number;
    accelAt25: number;
    /** Desaceleracao (freio) e um multiplo da aceleracao. */
    brakeFactor: number;
    /** Fracao da velocidade maxima mantida driblando (sem sprint). */
    dribbleSpeedFactor: number;
    /** Multiplicador de sprint (consome stamina/adrenalina). */
    sprintFactor: number;
    /** Penalidade de velocidade lateral/defensiva (shuffle). */
    lateralFactor: number;
    /** Penalidade de velocidade de re (backpedal). */
    backpedalFactor: number;
    /** Taxa maxima de giro do corpo (rad/s) em velocidade baixa. */
    turnRateBase: number;
    /** Reducao da taxa de giro conforme a velocidade sobe. */
    turnRateSpeedPenalty: number;
    /** Massa de referencia (kg) para o calculo de inercia. */
    referenceMass: number;
    /** Quanto a massa acima da referencia retarda a mudanca de direcao. */
    massInertiaScale: number;
    /** Tempo minimo (s) entre plantas de pe em corrida. */
    strideBase: number;
    /** Perda de equilibrio por mudanca brusca de direcao (0..1 por unidade). */
    balanceLossScale: number;
    /** Recuperacao de equilibrio por segundo. */
    balanceRecovery: number;
    /** Abaixo deste equilibrio o atleta tropeca/escorrega. */
    stumbleThreshold: number;
  };
  ball: {
    radius: number;
    /** Coeficiente de restituicao por superficie. */
    restitutionFloor: number;
    restitutionRim: number;
    restitutionBackboard: number;
    /** Atrito tangencial em cada quique. */
    friction: number;
    /** Arrasto aerodinamico (1/s). */
    drag: number;
    /** Efeito Magnus a partir do backspin. */
    magnus: number;
    spinDecay: number;
    /** Velocidade abaixo da qual a bola e considerada parada. */
    restSpeed: number;
    /** Raio em que um atleta pode agarrar a bola solta. */
    catchRadius: number;
    catchHeightMax: number;
  };
  shooting: {
    /** Tempo base de release (s) por tipo. */
    releaseSet: number;
    releaseOffDribble: number;
    releasePullup: number;
    releaseStepback: number;
    releaseFadeaway: number;
    releaseFloater: number;
    /** Janela verde base (s) para timing perfeito. */
    greenWindowBase: number;
    /** Ganho de janela por atributo do tipo de arremesso. */
    greenWindowAttrGain: number;
    /** Multiplicador da janela com ritmo (rhythm shooting) perfeito. */
    rhythmWindowBonus: number;
    /** Penalidade da janela por contest total. */
    contestWindowPenalty: number;
    /** Probabilidade base com timing perfeito, sem marcacao, no ponto ideal. */
    basePerfect: number;
    /** Probabilidade base com timing ruim. */
    baseBadTiming: number;
    /** Queda de porcentagem por metro alem da distancia confortavel. */
    distanceFalloff: number;
    /** Distancia confortavel derivada do atributo (m). */
    comfortDistAt99: number;
    comfortDistAt25: number;
    /** Impacto maximo do contest (reducao absoluta de probabilidade). */
    contestImpact: number;
    /** Impacto do desequilibrio. */
    balanceImpact: number;
    /** Impacto da fadiga na probabilidade. */
    fatigueImpact: number;
    /** Impacto do movimento lateral no release. */
    movementImpact: number;
    /** Bonus de arremesso apos passe (qualidade do passe / catch-and-shoot). */
    assistBonus: number;
    /** Faixa hot/cold (multiplicador aplicado a probabilidade final). */
    hotColdRange: number;
    /** Desvio angular maximo do erro de mira (rad). */
    missSpreadMax: number;
    /** Arco alvo (graus) de saida por distancia. */
    arcNear: number;
    arcFar: number;
    freeThrowBase: number;
  };
  finishing: {
    /** Probabilidade base de bandeja aberta no aro. */
    layupBase: number;
    dunkBase: number;
    /** Altura minima de alcance para enterrada (m) = altura + envergadura*fator. */
    reachFactor: number;
    /** Impulsao (m) por atributo vertical. */
    verticalAt99: number;
    verticalAt25: number;
    /** Altura minima acima do aro para enterrar com controle. */
    dunkClearance: number;
    /** Impacto do contato na finalizacao. */
    contactImpact: number;
    /** Janela do dunk meter (s) em situacao aberta. */
    dunkWindowOpen: number;
    dunkWindowContested: number;
    /** Ganho por finalizar com a mao protegida (inside/outside hand). */
    handProtectionBonus: number;
    /** Chance de and-one em contato forte convertido. */
    andOneChance: number;
  };
  dribble: {
    /** Custo base de stamina por move. */
    staminaCostBase: number;
    /** Custo de adrenalina por move explosivo. */
    adrenalineCostBase: number;
    /** Tempo base de execucao (s). */
    durationBase: number;
    /** Ganho de separacao (m) de um move bem executado. */
    separationBase: number;
    /** Quanto o momentum contrario do defensor amplia a separacao. */
    momentumLeverage: number;
    /** Limiar de desequilibrio do defensor para ankle breaker. */
    ankleBreakThreshold: number;
    /** Escala de perda de equilibrio do defensor. */
    defenderBalanceScale: number;
    /** Anti-cheese: custo crescente por repetir o mesmo move. */
    repetitionPenalty: number;
    repetitionDecay: number;
    /** Risco base de perder a bola ao driblar sob pressao. */
    fumbleBase: number;
  };
  passing: {
    /** Velocidades (m/s) por tipo. */
    speedChest: number;
    speedBounce: number;
    speedBullet: number;
    speedLob: number;
    speedTouch: number;
    /** Erro angular base (rad) modulado por pass accuracy. */
    errorBase: number;
    /** Penalidade de erro por passe sem olhar / flashy. */
    noLookPenalty: number;
    flashyPenalty: number;
    /** Raio de leitura da linha de passe para interceptacao. */
    laneRadius: number;
    /** Chance base de interceptacao quando o defensor esta na linha. */
    interceptBase: number;
    /** Penalidade por pressao no passador. */
    pressurePenalty: number;
    /** Janela (s) em que uma recepcao conta como assistencia. */
    assistWindow: number;
  };
  defense: {
    /** Distancia de body-up efetiva (m). */
    bodyUpRange: number;
    /** Empurrao lateral de contencao aplicado ao atacante (m/s^2). */
    cutoffForce: number;
    /** Alcance de contest (m). */
    contestRange: number;
    /** Peso do contest por proximidade, mao e altura. */
    contestProximityWeight: number;
    contestHandWeight: number;
    contestHeightWeight: number;
    contestTimingWeight: number;
    /** Chance base de roubo por tentativa. */
    stealBase: number;
    /** Chance base de falta na tentativa de roubo. */
    stealFoulBase: number;
    /** Chance base de toco quando o timing esta correto. */
    blockBase: number;
    blockFoulBase: number;
    /** Aggressive hands-up: multiplicadores. */
    aggressiveContestMult: number;
    aggressiveFoulMult: number;
    conservativeContestMult: number;
    conservativeFoulMult: number;
    /** Tempo de reacao base (s) do defensor CPU por IQ. */
    reactionAt99: number;
    reactionAt25: number;
  };
  rebounding: {
    /** Peso de posicao vs atributos na disputa. */
    positionWeight: number;
    attributeWeight: number;
    boxoutWeight: number;
    /** Alcance vertical extra por vertical/altura. */
    reachWeight: number;
    /** Chance de tip-out em disputa equilibrada. */
    tipChance: number;
    /** Fracao de rebotes ofensivos alvo (calibracao). */
    targetOffensiveRate: number;
  };
  fatigue: {
    /** Drenos por segundo. */
    sprintDrain: number;
    moveDrain: number;
    defenseDrain: number;
    contactDrain: number;
    jumpDrain: number;
    /** Recuperacao em quadra (por segundo) e no banco. */
    recoverOnCourt: number;
    recoverIdle: number;
    recoverBench: number;
    /** Escala do atributo stamina sobre drenos. */
    staminaScale: number;
    /** Efeitos da fadiga (fracao perdida em stamina 0). */
    speedPenalty: number;
    verticalPenalty: number;
    shootingPenalty: number;
    controlPenalty: number;
    reactionPenalty: number;
  };
  adrenaline: {
    max: number;
    regenPerSec: number;
    regenIdleBonus: number;
    sprintCost: number;
    explosiveMoveCost: number;
    /** Perda de explosividade quando zerado. */
    depletedPenalty: number;
  };
  takeover: {
    /** Meter 0..1 por disciplina; ganho por evento positivo. */
    gainMade2: number;
    gainMade3: number;
    gainAssist: number;
    gainRebound: number;
    gainSteal: number;
    gainBlock: number;
    gainDunk: number;
    gainStop: number;
    /** Perda por evento negativo. */
    lossMiss: number;
    lossTurnover: number;
    lossScoredOn: number;
    /** Decaimento natural por segundo. */
    decayPerSec: number;
    /** Limiares dos estados. */
    frozenBelow: number;
    coldBelow: number;
    warmAbove: number;
    hotAbove: number;
    takeoverAt: number;
    /** Duracao (s) do takeover ativo e drenagem. */
    activeDrainPerSec: number;
    /** Multiplicador de atributo concedido pelo takeover. */
    boost: number;
  };
  fouls: {
    /** Chance base de falta por contato ilegal severo. */
    contactBase: number;
    /** Escala de falta por discipline/IQ defensivo. */
    disciplineScale: number;
    /** Bonus de lance livre a partir de N faltas de equipe por periodo. */
    teamFoulBonus: number;
    foulOutLimit: number;
    /** Chance de falta de ataque em carga. */
    chargeBase: number;
  };
  game: {
    periods: number;
    periodSeconds: number;
    overtimeSeconds: number;
    shotClock: number;
    shotClockOffensiveRebound: number;
    backcourtSeconds: number;
    timeoutsPerTeam: number;
    /** Tempo (s) de bola morta entre jogadas. */
    deadBallInbound: number;
    freeThrowInterval: number;
  };
  ai: {
    /** Peso das heuristicas na escolha de acao. */
    shotQualityThreshold: number;
    passWillingness: number;
    driveWillingness: number;
    /** Urgencia quando o relogio de posse aperta. */
    clockPressureStart: number;
    /** Espacamento alvo (m) entre companheiros. */
    spacingTarget: number;
    /** Gravidade de um arremessador de elite no canto. */
    cornerGravity: number;
    /** Distancia de ajuda (help) do lado fraco. */
    helpDistance: number;
    /** Tempo (s) de closeout. */
    closeoutTime: number;
    /** Limiar de mismatch (diferenca de atributo) para cacar matchup. */
    mismatchThreshold: number;
  };
}

export const DEFAULT_TUNING: Tuning = {
  sim: { dt: 1 / 120, maxSubstepsPerFrame: 8, gravity: 9.81 },
  locomotion: {
    topSpeedAt99: 8.2,
    topSpeedAt25: 5.6,
    accelAt99: 11.5,
    accelAt25: 6.4,
    brakeFactor: 1.45,
    dribbleSpeedFactor: 0.8,
    sprintFactor: 1.18,
    lateralFactor: 0.62,
    backpedalFactor: 0.7,
    turnRateBase: 9.5,
    turnRateSpeedPenalty: 0.55,
    referenceMass: 95,
    massInertiaScale: 0.55,
    strideBase: 0.28,
    balanceLossScale: 0.075,
    balanceRecovery: 1.05,
    stumbleThreshold: 0.28,
  },
  ball: {
    radius: 0.119,
    restitutionFloor: 0.74,
    restitutionRim: 0.44,
    restitutionBackboard: 0.52,
    friction: 0.35,
    drag: 0.09,
    magnus: 0.055,
    spinDecay: 0.6,
    restSpeed: 0.35,
    catchRadius: 0.95,
    catchHeightMax: 2.45,
  },
  shooting: {
    releaseSet: 0.62,
    releaseOffDribble: 0.52,
    releasePullup: 0.56,
    releaseStepback: 0.6,
    releaseFadeaway: 0.66,
    releaseFloater: 0.44,
    greenWindowBase: 0.055,
    greenWindowAttrGain: 0.07,
    rhythmWindowBonus: 1.45,
    contestWindowPenalty: 0.55,
    basePerfect: 0.86,
    baseBadTiming: 0.3,
    distanceFalloff: 0.05,
    comfortDistAt99: 8.4,
    comfortDistAt25: 4.2,
    contestImpact: 0.42,
    balanceImpact: 0.3,
    fatigueImpact: 0.16,
    movementImpact: 0.18,
    assistBonus: 0.06,
    hotColdRange: 0.12,
    missSpreadMax: 0.1,
    arcNear: 52,
    arcFar: 46,
    freeThrowBase: 0.92,
  },
  finishing: {
    layupBase: 0.84,
    dunkBase: 0.955,
    reachFactor: 0.52,
    verticalAt99: 1.02,
    verticalAt25: 0.5,
    dunkClearance: 0.16,
    contactImpact: 0.36,
    dunkWindowOpen: 0.34,
    dunkWindowContested: 0.12,
    handProtectionBonus: 0.1,
    andOneChance: 0.33,
  },
  dribble: {
    staminaCostBase: 0.012,
    adrenalineCostBase: 0.06,
    durationBase: 0.46,
    separationBase: 0.42,
    momentumLeverage: 0.55,
    ankleBreakThreshold: 0.34,
    defenderBalanceScale: 0.9,
    repetitionPenalty: 0.22,
    repetitionDecay: 0.35,
    fumbleBase: 0.012,
  },
  passing: {
    speedChest: 14.5,
    speedBounce: 11.5,
    speedBullet: 19.5,
    speedLob: 9.5,
    speedTouch: 13,
    errorBase: 0.075,
    noLookPenalty: 1.55,
    flashyPenalty: 1.85,
    laneRadius: 1.25,
    interceptBase: 0.3,
    pressurePenalty: 1.5,
    assistWindow: 2.6,
  },
  defense: {
    bodyUpRange: 0.95,
    cutoffForce: 7.5,
    contestRange: 2.4,
    contestProximityWeight: 0.5,
    contestHandWeight: 0.22,
    contestHeightWeight: 0.16,
    contestTimingWeight: 0.12,
    stealBase: 0.14,
    stealFoulBase: 0.1,
    blockBase: 0.3,
    blockFoulBase: 0.12,
    aggressiveContestMult: 1.28,
    aggressiveFoulMult: 2.1,
    conservativeContestMult: 0.82,
    conservativeFoulMult: 0.45,
    reactionAt99: 0.13,
    reactionAt25: 0.42,
  },
  rebounding: {
    positionWeight: 0.44,
    attributeWeight: 0.36,
    boxoutWeight: 0.2,
    reachWeight: 0.3,
    tipChance: 0.14,
    targetOffensiveRate: 0.26,
  },
  fatigue: {
    sprintDrain: 0.0125,
    moveDrain: 0.006,
    defenseDrain: 0.0055,
    contactDrain: 0.011,
    jumpDrain: 0.008,
    recoverOnCourt: 0.0075,
    recoverIdle: 0.014,
    recoverBench: 0.033,
    staminaScale: 0.55,
    speedPenalty: 0.2,
    verticalPenalty: 0.24,
    shootingPenalty: 0.16,
    controlPenalty: 0.2,
    reactionPenalty: 0.25,
  },
  adrenaline: {
    max: 1,
    regenPerSec: 0.11,
    regenIdleBonus: 0.13,
    sprintCost: 0.1,
    explosiveMoveCost: 0.16,
    depletedPenalty: 0.3,
  },
  takeover: {
    gainMade2: 0.09,
    gainMade3: 0.13,
    gainAssist: 0.08,
    gainRebound: 0.07,
    gainSteal: 0.14,
    gainBlock: 0.14,
    gainDunk: 0.15,
    gainStop: 0.05,
    lossMiss: 0.035,
    lossTurnover: 0.08,
    lossScoredOn: 0.03,
    decayPerSec: 0.004,
    frozenBelow: 0.1,
    coldBelow: 0.28,
    warmAbove: 0.5,
    hotAbove: 0.75,
    takeoverAt: 1,
    activeDrainPerSec: 0.022,
    boost: 0.14,
  },
  fouls: {
    contactBase: 0.1,
    disciplineScale: 0.55,
    teamFoulBonus: 5,
    foulOutLimit: 6,
    chargeBase: 0.16,
  },
  game: {
    periods: 4,
    periodSeconds: 720,
    overtimeSeconds: 300,
    shotClock: 24,
    shotClockOffensiveRebound: 14,
    backcourtSeconds: 8,
    timeoutsPerTeam: 6,
    deadBallInbound: 3.5,
    freeThrowInterval: 2.2,
  },
  ai: {
    shotQualityThreshold: 0.48,
    passWillingness: 0.55,
    driveWillingness: 0.5,
    clockPressureStart: 7,
    spacingTarget: 5.2,
    cornerGravity: 0.65,
    helpDistance: 4.6,
    closeoutTime: 0.75,
    mismatchThreshold: 12,
  },
};

export function cloneTuning(t: Tuning = DEFAULT_TUNING): Tuning {
  return JSON.parse(JSON.stringify(t)) as Tuning;
}

/** Aplica um patch parcial e profundo sobre o tuning (usado por sliders/dificuldade). */
export function patchTuning(base: Tuning, patch: DeepPartial<Tuning>): Tuning {
  const out = cloneTuning(base);
  deepAssign(out as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  return out;
}

function deepAssign(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (pv === undefined) continue;
    if (pv !== null && typeof pv === 'object' && !Array.isArray(pv)) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      deepAssign(target[key] as Record<string, unknown>, pv as Record<string, unknown>);
    } else {
      target[key] = pv;
    }
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
