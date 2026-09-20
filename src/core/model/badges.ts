/**
 * BADGES (secoes 43 a 46).
 *
 * Principios:
 *  - Nenhuma badge e generica. Cada uma responde a uma SITUACAO especifica.
 *    "Catch & shoot" nao melhora arremesso em drible; "Pull-up" nao melhora parado.
 *  - Badges expoem `effects` com chaves tipadas. Os sistemas consultam a chave
 *    apenas no contexto correto, entao a especializacao e verificada em codigo.
 *  - Equipar exige: requisito de atributo + token da categoria + slot livre.
 */

import { Attributes } from './attributes.js';

export type BadgeCategory = 'shooting' | 'finishing' | 'playmaking' | 'defense' | 'rebounding' | 'physicals';

export type BadgeTier = 0 | 1 | 2 | 3 | 4 | 5;
export const TIER_NAMES = ['-', 'Bronze', 'Prata', 'Ouro', 'Platina', 'Lenda'] as const;
/** Multiplicador de magnitude por tier. */
export const TIER_SCALE = [0, 0.45, 0.7, 1, 1.35, 1.75] as const;

/** Chaves de efeito consultadas pelos sistemas de gameplay. */
export type BadgeEffect =
  // SHOOTING
  | 'shot.catchShoot' | 'shot.offDribble' | 'shot.stepback' | 'shot.deep' | 'shot.contested'
  | 'shot.corner' | 'shot.clutch' | 'shot.freeThrow' | 'shot.movementTolerance' | 'shot.greenWindow'
  | 'shot.fatigueResist' | 'shot.postFade' | 'shot.quickRelease' | 'shot.heatCheck' | 'shot.midRangeSpot'
  // FINISHING
  | 'finish.layup' | 'finish.contact' | 'finish.dunkWindow' | 'finish.standingDunk' | 'finish.alleyOop'
  | 'finish.floater' | 'finish.postHook' | 'finish.reverse' | 'finish.putback' | 'finish.drawFoul'
  | 'finish.andOne' | 'finish.gatherControl'
  // PLAYMAKING
  | 'play.ballSecurity' | 'play.separation' | 'play.ankleBreak' | 'play.speedWithBall' | 'play.passAccuracy'
  | 'play.lobAccuracy' | 'play.postPass' | 'play.needleThread' | 'play.outlet' | 'play.handoff'
  | 'play.dimeBonus' | 'play.moveStamina'
  // DEFENSE
  | 'def.contest' | 'def.steal' | 'def.pickpocket' | 'def.block' | 'def.chasedown' | 'def.closeout'
  | 'def.helpSpeed' | 'def.postLockdown' | 'def.onBallPressure' | 'def.foulResist' | 'def.interception'
  | 'def.screenNavigation' | 'def.verticality'
  // REBOUNDING
  | 'reb.boxout' | 'reb.offensive' | 'reb.defensive' | 'reb.tip' | 'reb.prediction' | 'reb.screenSet'
  // PHYSICALS
  | 'phys.staminaCost' | 'phys.sprintEfficiency' | 'phys.contactBalance' | 'phys.adrenalineRegen'
  | 'phys.verticalBoost' | 'phys.strengthHold' | 'phys.reaction' | 'phys.durability';

export interface BadgeRequirement {
  attribute: keyof Attributes;
  min: number;
}

export interface BadgeDef {
  id: string;
  name: string;
  category: BadgeCategory;
  /** Situacao exata em que a badge atua. Exibido na UI. */
  situation: string;
  /** Efeitos base (tier Ouro = magnitude 1.0). */
  effects: Partial<Record<BadgeEffect, number>>;
  /** Requisitos minimos para equipar em cada tier. */
  requirements: BadgeRequirement[];
  /** Custo em slots da categoria (1 a 3). */
  slotCost: number;
}

const B = (
  id: string,
  name: string,
  category: BadgeCategory,
  situation: string,
  effects: Partial<Record<BadgeEffect, number>>,
  requirements: BadgeRequirement[],
  slotCost = 1,
): BadgeDef => ({ id, name, category, situation, effects, requirements, slotCost });

/** 53 badges especializadas. */
export const BADGES: BadgeDef[] = [
  // ---------- SHOOTING (10) ----------
  B('spot_sniper', 'Franco-Atirador', 'shooting', 'Arremesso de pe recebendo passe, sem drible previo.',
    { 'shot.catchShoot': 0.065, 'shot.greenWindow': 0.1 }, [{ attribute: 'threePoint', min: 70 }]),
  B('rhythm_pullup', 'Pull-Up de Ritmo', 'shooting', 'Arremesso apos drible com o corpo em movimento para frente.',
    { 'shot.offDribble': 0.06, 'shot.movementTolerance': 0.2 }, [{ attribute: 'midRange', min: 72 }]),
  B('backstep_artist', 'Artista do Stepback', 'shooting', 'Arremesso imediatamente apos stepback ou lateral stepback.',
    { 'shot.stepback': 0.07, 'shot.greenWindow': 0.08 }, [{ attribute: 'threePoint', min: 76 }, { attribute: 'ballHandle', min: 70 }], 2),
  B('logo_range', 'Alcance Estendido', 'shooting', 'Arremessos a mais de 2 metros alem da linha de tres.',
    { 'shot.deep': 0.085 }, [{ attribute: 'threePoint', min: 84 }], 2),
  B('ice_veins', 'Sangue Frio', 'shooting', 'Ultimos 2 minutos de jogo apertado (diferenca <= 5).',
    { 'shot.clutch': 0.055, 'shot.freeThrow': 0.03 }, [{ attribute: 'shotIQ', min: 72 }]),
  B('corner_specialist', 'Especialista de Canto', 'shooting', 'Arremesso das duas zonas de canto.',
    { 'shot.corner': 0.07 }, [{ attribute: 'threePoint', min: 74 }]),
  B('contested_touch', 'Toque sob Pressao', 'shooting', 'Arremesso com contest medio ou alto na cara.',
    { 'shot.contested': 0.06 }, [{ attribute: 'shotIQ', min: 78 }, { attribute: 'midRange', min: 76 }], 2),
  B('free_throw_ritual', 'Ritual da Linha', 'shooting', 'Somente lances livres.',
    { 'shot.freeThrow': 0.055 }, [{ attribute: 'freeThrow', min: 75 }]),
  B('tireless_shooter', 'Pernas de Aco', 'shooting', 'Arremesso com stamina abaixo de 50%.',
    { 'shot.fatigueResist': 0.55 }, [{ attribute: 'stamina', min: 76 }]),
  B('quick_trigger', 'Gatilho Rapido', 'shooting', 'Reduz o tempo de release de todo arremesso de perimetro.',
    { 'shot.quickRelease': 0.09 }, [{ attribute: 'threePoint', min: 78 }], 2),

  // ---------- FINISHING (10) ----------
  B('acrobat', 'Acrobata', 'finishing', 'Bandeja com gather euro, spin, hop ou reverse.',
    { 'finish.layup': 0.06, 'finish.reverse': 0.05 }, [{ attribute: 'drivingLayup', min: 74 }]),
  B('through_contact', 'Atravessa o Contato', 'finishing', 'Finalizacao com colisao registrada no gather ou no ar.',
    { 'finish.contact': 0.075, 'finish.andOne': 0.08 }, [{ attribute: 'strength', min: 72 }, { attribute: 'drivingLayup', min: 70 }], 2),
  B('posterizer', 'Enterrada em Cima', 'finishing', 'Enterrada em movimento com defensor dentro do raio de contato.',
    { 'finish.dunkWindow': 0.3, 'finish.contact': 0.05 }, [{ attribute: 'drivingDunk', min: 84 }], 2),
  B('rim_anchor', 'Ancora no Aro', 'finishing', 'Enterrada parado dentro da area restritiva.',
    { 'finish.standingDunk': 0.07 }, [{ attribute: 'standingDunk', min: 78 }]),
  B('lob_city', 'Alvo Aereo', 'finishing', 'Recepcao e finalizacao de alley-oop.',
    { 'finish.alleyOop': 0.08 }, [{ attribute: 'vertical', min: 78 }, { attribute: 'hands', min: 70 }]),
  B('soft_touch', 'Toque Suave', 'finishing', 'Floater e runner entre 3 e 5,5 metros.',
    { 'finish.floater': 0.07 }, [{ attribute: 'closeShot', min: 74 }]),
  B('post_craft', 'Oficio de Poste', 'finishing', 'Gancho e finalizacao de costas para a cesta.',
    { 'finish.postHook': 0.07 }, [{ attribute: 'postControl', min: 76 }]),
  B('second_jump', 'Segundo Salto', 'finishing', 'Putback imediato apos rebote ofensivo.',
    { 'finish.putback': 0.08, 'reb.tip': 0.05 }, [{ attribute: 'vertical', min: 74 }, { attribute: 'offensiveRebound', min: 72 }]),
  B('foul_magnet', 'Ima de Falta', 'finishing', 'Ataque ao aro com defensor em posicao ilegal ou tardia.',
    { 'finish.drawFoul': 0.09 }, [{ attribute: 'drawFoul', min: 76 }]),
  B('gather_control', 'Controle de Gather', 'finishing', 'Escolha automatica do melhor gather sob pressao lateral.',
    { 'finish.gatherControl': 0.35 }, [{ attribute: 'drivingLayup', min: 78 }, { attribute: 'agility', min: 72 }], 2),

  // ---------- PLAYMAKING (10) ----------
  B('iron_grip', 'Punho de Ferro', 'playmaking', 'Manter a bola sob poke, contato e trafego.',
    { 'play.ballSecurity': 0.45 }, [{ attribute: 'ballHandle', min: 74 }]),
  B('shifty', 'Quadril Solto', 'playmaking', 'Ganho de separacao em moves laterais (cross, between, behind).',
    { 'play.separation': 0.14 }, [{ attribute: 'ballHandle', min: 80 }, { attribute: 'agility', min: 76 }], 2),
  B('ankle_hunter', 'Cacador de Tornozelos', 'playmaking', 'Move executado contra momentum defensivo contrario.',
    { 'play.ankleBreak': 0.2 }, [{ attribute: 'ballHandle', min: 84 }], 3),
  B('downhill', 'Ladeira Abaixo', 'playmaking', 'Velocidade com bola em linha reta rumo ao aro.',
    { 'play.speedWithBall': 0.08 }, [{ attribute: 'speedWithBall', min: 78 }]),
  B('needle_thread', 'Passe na Agulha', 'playmaking', 'Passe com defensor dentro do raio da linha de passe.',
    { 'play.needleThread': 0.35, 'play.passAccuracy': 0.03 }, [{ attribute: 'passAccuracy', min: 80 }, { attribute: 'passIQ', min: 76 }], 2),
  B('lob_dispatcher', 'Despachante de Lob', 'playmaking', 'Passes alley-oop e lob sobre a defesa.',
    { 'play.lobAccuracy': 0.3 }, [{ attribute: 'passAccuracy', min: 76 }]),
  B('post_dispatcher', 'Saida do Poste', 'playmaking', 'Passe iniciado de costas para a cesta.',
    { 'play.postPass': 0.3 }, [{ attribute: 'passIQ', min: 72 }, { attribute: 'postControl', min: 68 }]),
  B('outlet_cannon', 'Canhao de Saida', 'playmaking', 'Primeiro passe apos rebote defensivo.',
    { 'play.outlet': 0.3 }, [{ attribute: 'passAccuracy', min: 72 }]),
  B('handoff_maestro', 'Maestro do Handoff', 'playmaking', 'Entrega de mao em mao (DHO) e passes de curta distancia em movimento.',
    { 'play.handoff': 0.28 }, [{ attribute: 'passIQ', min: 74 }]),
  B('dime_setter', 'Garcom', 'playmaking', 'Bonus de arremesso concedido ao companheiro que recebe o passe.',
    { 'play.dimeBonus': 0.035 }, [{ attribute: 'passVision', min: 80 }], 2),

  // ---------- DEFENSE (12) ----------
  B('glove', 'Luva', 'defense', 'Marcacao individual dentro de 1,2 m do portador da bola.',
    { 'def.onBallPressure': 0.16 }, [{ attribute: 'perimeterDefense', min: 80 }], 2),
  B('pickpocket', 'Batedor de Carteira', 'defense', 'Roubo durante a animacao de drible do adversario.',
    { 'def.pickpocket': 0.2 }, [{ attribute: 'steal', min: 78 }]),
  B('passing_lane_hawk', 'Falcao de Linha', 'defense', 'Interceptacao de passe fora da bola.',
    { 'def.interception': 0.25 }, [{ attribute: 'defensiveIQ', min: 76 }, { attribute: 'steal', min: 70 }]),
  B('rim_wall', 'Muralha do Aro', 'defense', 'Contest e toco de finalizacao dentro da area restritiva.',
    { 'def.block': 0.14, 'def.verticality': 0.2 }, [{ attribute: 'block', min: 78 }, { attribute: 'interiorDefense', min: 74 }], 2),
  B('chasedown', 'Perseguidor', 'defense', 'Toco vindo por tras em transicao.',
    { 'def.chasedown': 0.3 }, [{ attribute: 'block', min: 74 }, { attribute: 'speed', min: 76 }]),
  B('closeout_king', 'Rei do Closeout', 'defense', 'Chegada rapida ao arremessador sem morder a finta.',
    { 'def.closeout': 0.22, 'def.contest': 0.05 }, [{ attribute: 'lateralQuickness', min: 76 }]),
  B('help_radar', 'Radar de Ajuda', 'defense', 'Rotacao de ajuda vinda do lado fraco.',
    { 'def.helpSpeed': 0.25 }, [{ attribute: 'helpDefenseIQ', min: 78 }]),
  B('post_anchor', 'Ancora de Poste', 'defense', 'Defesa contra jogo de costas dentro do garrafao.',
    { 'def.postLockdown': 0.18 }, [{ attribute: 'interiorDefense', min: 78 }, { attribute: 'strength', min: 74 }]),
  B('clean_hands', 'Maos Limpas', 'defense', 'Reduz falta em tentativas de roubo e toco.',
    { 'def.foulResist': 0.35 }, [{ attribute: 'discipline', min: 74 }]),
  B('screen_slip', 'Passa-Bloqueio', 'defense', 'Navegacao por bloqueios sem perder o marcador.',
    { 'def.screenNavigation': 0.3 }, [{ attribute: 'agility', min: 74 }, { attribute: 'defensiveIQ', min: 70 }]),
  B('contest_reach', 'Envergadura Total', 'defense', 'Contest de arremesso de perimetro com a mao levantada.',
    { 'def.contest': 0.09 }, [{ attribute: 'perimeterDefense', min: 74 }]),
  B('strip_artist', 'Desarme no Gather', 'defense', 'Roubo no momento exato do gather de finalizacao.',
    { 'def.steal': 0.13 }, [{ attribute: 'steal', min: 74 }, { attribute: 'defensiveIQ', min: 72 }]),

  // ---------- REBOUNDING (6) ----------
  B('hip_check', 'Quadril de Aco', 'rebounding', 'Boxout ativo antes de a bola tocar o aro.',
    { 'reb.boxout': 0.22 }, [{ attribute: 'strength', min: 74 }]),
  B('glass_cleaner', 'Limpador de Vidro', 'rebounding', 'Rebote defensivo contestado.',
    { 'reb.defensive': 0.13 }, [{ attribute: 'defensiveRebound', min: 78 }]),
  B('offensive_vulture', 'Abutre Ofensivo', 'rebounding', 'Rebote ofensivo em trafego.',
    { 'reb.offensive': 0.13 }, [{ attribute: 'offensiveRebound', min: 78 }]),
  B('tip_master', 'Mestre do Tip', 'rebounding', 'Tocar a bola de volta ao aro ou para fora do trafego.',
    { 'reb.tip': 0.2 }, [{ attribute: 'offensiveRebound', min: 72 }, { attribute: 'vertical', min: 70 }]),
  B('trajectory_read', 'Leitura de Trajetoria', 'rebounding', 'Antecipa o ponto de queda antes do ricochete.',
    { 'reb.prediction': 0.4 }, [{ attribute: 'defensiveRebound', min: 74 }, { attribute: 'defensiveIQ', min: 72 }], 2),
  B('wall_setter', 'Bloqueio de Concreto', 'rebounding', 'Qualidade do bloqueio (screen) colocado para o portador.',
    { 'reb.screenSet': 0.3 }, [{ attribute: 'strength', min: 76 }]),

  // ---------- PHYSICALS (5) ----------
  B('engine', 'Motor', 'physicals', 'Custo de stamina de sprint e moves.',
    { 'phys.staminaCost': 0.22, 'phys.sprintEfficiency': 0.15 }, [{ attribute: 'stamina', min: 78 }], 2),
  B('immovable', 'Inabalavel', 'physicals', 'Manter equilibrio em contato corporal.',
    { 'phys.contactBalance': 0.28, 'phys.strengthHold': 0.2 }, [{ attribute: 'strength', min: 80 }], 2),
  B('second_wind', 'Segundo Folego', 'physicals', 'Recuperacao de adrenalina fora da bola.',
    { 'phys.adrenalineRegen': 0.35 }, [{ attribute: 'stamina', min: 74 }]),
  B('bounce', 'Mola', 'physicals', 'Altura do salto em saltos repetidos.',
    { 'phys.verticalBoost': 0.07 }, [{ attribute: 'vertical', min: 80 }]),
  B('quick_twitch', 'Reflexo Rapido', 'physicals', 'Tempo de reacao a estimulos defensivos e bolas soltas.',
    { 'phys.reaction': 0.22 }, [{ attribute: 'agility', min: 78 }]),
];

export const BADGE_BY_ID: Map<string, BadgeDef> = new Map(BADGES.map((b) => [b.id, b]));

export function badgesInCategory(cat: BadgeCategory): BadgeDef[] {
  return BADGES.filter((b) => b.category === cat);
}

/** Estado equipado: id -> tier. */
export type BadgeLoadout = Record<string, BadgeTier>;

export interface BadgeSynergy {
  /** FUSE: bonus permanente na badge principal quando ambas estao no mesmo loadout. */
  kind: 'fuse' | 'reaction';
  id: string;
  name: string;
  primary: string;
  secondary: string;
  description: string;
  /** FUSE: multiplicador extra aplicado aos efeitos da primaria. */
  fuseBonus?: number;
  /** REACTION: ativacoes da primaria necessarias para ligar a secundaria temporariamente. */
  activations?: number;
  reactionSeconds?: number;
  reactionBonus?: number;
}

/** Sinergias (secao 45). Todas exigem as duas badges equipadas. */
export const SYNERGIES: BadgeSynergy[] = [
  { kind: 'fuse', id: 'sniper_nest', name: 'Ninho do Atirador', primary: 'spot_sniper', secondary: 'corner_specialist',
    description: 'Franco-Atirador ganha potencia permanente quando o Especialista de Canto esta equipado.', fuseBonus: 0.35 },
  { kind: 'fuse', id: 'downhill_freight', name: 'Trem Desgovernado', primary: 'through_contact', secondary: 'downhill',
    description: 'Atravessa o Contato fica mais forte com Ladeira Abaixo equipado.', fuseBonus: 0.3 },
  { kind: 'fuse', id: 'lockdown_core', name: 'Nucleo Travado', primary: 'glove', secondary: 'screen_slip',
    description: 'Luva ganha potencia ao navegar bloqueios com Passa-Bloqueio.', fuseBonus: 0.3 },
  { kind: 'fuse', id: 'glass_fortress', name: 'Fortaleza de Vidro', primary: 'glass_cleaner', secondary: 'hip_check',
    description: 'Limpador de Vidro se beneficia do boxout de Quadril de Aco.', fuseBonus: 0.35 },
  { kind: 'reaction', id: 'heat_reaction', name: 'Reacao Termica', primary: 'spot_sniper', secondary: 'logo_range',
    description: 'Apos 3 arremessos convertidos de pe, Alcance Estendido ativa por 45 s.', activations: 3, reactionSeconds: 45, reactionBonus: 1 },
  { kind: 'reaction', id: 'predator_reaction', name: 'Reacao Predatoria', primary: 'pickpocket', secondary: 'passing_lane_hawk',
    description: 'Apos 2 roubos, Falcao de Linha ativa por 60 s.', activations: 2, reactionSeconds: 60, reactionBonus: 1 },
  { kind: 'reaction', id: 'rim_reaction', name: 'Reacao do Aro', primary: 'rim_wall', secondary: 'chasedown',
    description: 'Apos 2 tocos, Perseguidor ativa por 60 s.', activations: 2, reactionSeconds: 60, reactionBonus: 1 },
  { kind: 'reaction', id: 'playmaker_reaction', name: 'Reacao do Armador', primary: 'needle_thread', secondary: 'dime_setter',
    description: 'Apos 4 assistencias, Garcom ativa por 90 s.', activations: 4, reactionSeconds: 90, reactionBonus: 1 },
];

export const SYNERGY_BY_PRIMARY: Map<string, BadgeSynergy[]> = (() => {
  const m = new Map<string, BadgeSynergy[]>();
  for (const s of SYNERGIES) {
    const list = m.get(s.primary) ?? [];
    list.push(s);
    m.set(s.primary, list);
  }
  return m;
})();

/** Tier maximo que os atributos atuais permitem equipar. */
export function maxTierFor(def: BadgeDef, attrs: Attributes): BadgeTier {
  let tier: BadgeTier = 5;
  for (const req of def.requirements) {
    const value = attrs[req.attribute];
    if (value < req.min) return 0;
    // Cada +4 acima do minimo libera um tier, comecando em Bronze.
    const allowed = Math.min(5, 1 + Math.floor((value - req.min) / 4));
    tier = Math.min(tier, allowed) as BadgeTier;
  }
  return tier;
}

/** Slots disponiveis por categoria. Derivado do build (secao 44). */
export type BadgeSlots = Record<BadgeCategory, number>;

export function emptySlots(): BadgeSlots {
  return { shooting: 0, finishing: 0, playmaking: 0, defense: 0, rebounding: 0, physicals: 0 };
}

export function slotsUsed(loadout: BadgeLoadout): BadgeSlots {
  const used = emptySlots();
  for (const [id, tier] of Object.entries(loadout)) {
    if (!tier) continue;
    const def = BADGE_BY_ID.get(id);
    if (def) used[def.category] += def.slotCost;
  }
  return used;
}

export interface LoadoutValidation {
  ok: boolean;
  problems: string[];
}

export function validateLoadout(loadout: BadgeLoadout, attrs: Attributes, slots: BadgeSlots, tokens: BadgeSlots): LoadoutValidation {
  const problems: string[] = [];
  const used = slotsUsed(loadout);
  for (const cat of Object.keys(used) as BadgeCategory[]) {
    if (used[cat] > slots[cat]) problems.push(`Slots de ${cat}: usados ${used[cat]} de ${slots[cat]}.`);
  }
  for (const [id, tier] of Object.entries(loadout)) {
    if (!tier) continue;
    const def = BADGE_BY_ID.get(id);
    if (!def) {
      problems.push(`Badge desconhecida: ${id}.`);
      continue;
    }
    const max = maxTierFor(def, attrs);
    if (tier > max) problems.push(`${def.name}: tier ${TIER_NAMES[tier]} exige atributos maiores (maximo atual: ${TIER_NAMES[max]}).`);
    if (tokens[def.category] <= 0 && tier > 0) problems.push(`${def.name}: sem token de ${def.category} disponivel.`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Valor efetivo de um efeito para um loadout. Retorna 0 quando nenhuma badge
 * equipada cobre aquele efeito - e por isso que o sistema chamador pode
 * consultar livremente sem checar se a badge existe.
 */
export function badgeValue(loadout: BadgeLoadout, effect: BadgeEffect, reactionActive?: Set<string>): number {
  let total = 0;
  for (const [id, tier] of Object.entries(loadout)) {
    if (!tier) continue;
    const def = BADGE_BY_ID.get(id);
    if (!def) continue;
    const base = def.effects[effect];
    if (base === undefined) continue;
    let magnitude = base * TIER_SCALE[tier];
    // FUSE: bonus permanente quando a parceira esta equipada.
    for (const syn of SYNERGY_BY_PRIMARY.get(id) ?? []) {
      if (syn.kind === 'fuse' && loadout[syn.secondary] && syn.fuseBonus) magnitude *= 1 + syn.fuseBonus;
    }
    total += magnitude;
  }
  // REACTION: secundarias ligadas temporariamente contam como tier Ouro extra.
  if (reactionActive) {
    for (const synId of reactionActive) {
      const syn = SYNERGIES.find((s) => s.id === synId);
      if (!syn || syn.kind !== 'reaction') continue;
      const def = BADGE_BY_ID.get(syn.secondary);
      const base = def?.effects[effect];
      if (base !== undefined) total += base * (syn.reactionBonus ?? 1);
    }
  }
  return total;
}
