/**
 * INPUT (secoes 116, 117, 118).
 *
 * Dois esquemas sobre o MESMO sistema: o iniciante usa botoes simples, o
 * avancado usa o stick direito para drible, arremesso de ritmo e finalizacao
 * direcional. Nao existe "modo facil" separado - o que muda e quanto do
 * sistema fica exposto.
 *
 * Teclado e gamepad produzem exatamente o mesmo UserCommand.
 */
import { Vec2, len2, norm2, v2 } from '../../core/math/vec.js';
import { clamp, clamp01 } from '../../core/math/util.js';
import { UserCommand, emptyCommand } from '../../core/sim/game.js';

export type ControlScheme = 'beginner' | 'advanced';

export interface InputBindings {
  moveUp: string[];
  moveDown: string[];
  moveLeft: string[];
  moveRight: string[];
  sprint: string[];
  shoot: string[];
  pass: string[];
  drive: string[];
  steal: string[];
  block: string[];
  postUp: string[];
  callScreen: string[];
  switchPlayer: string[];
  timeout: string[];
  intentionalFoul: string[];
  moveLeftStick: string[];
  moveRightStick: string[];
  camera: string[];
  pause: string[];
  stickUp: string[];
  stickDown: string[];
  stickLeft: string[];
  stickRight: string[];
}

export const DEFAULT_BINDINGS: InputBindings = {
  moveUp: ['KeyW', 'ArrowUp'],
  moveDown: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space'],
  pass: ['KeyJ'],
  drive: ['KeyK'],
  steal: ['KeyJ'],
  block: ['Space'],
  postUp: ['KeyL'],
  callScreen: ['KeyE'],
  switchPlayer: ['KeyQ'],
  timeout: ['KeyT'],
  intentionalFoul: ['KeyF'],
  moveLeftStick: ['KeyZ'],
  moveRightStick: ['KeyX'],
  camera: ['KeyC'],
  pause: ['Escape'],
  /** "Stick direito" do teclado: setas, quando WASD cuida do movimento. */
  stickUp: ['ArrowUp'],
  stickDown: ['ArrowDown'],
  stickLeft: ['ArrowLeft'],
  stickRight: ['ArrowRight'],
};

/**
 * MOVES DE DRIBLE NO TECLADO (secao 6).
 *
 * O simulador tem 28 moves; o teclado expunha UM (crossover, dois lados). O
 * "stick direito" resolve isso: WASD anda, as setas sao o stick. Direcao
 * escolhe a familia, os modificadores escolhem a variacao -- que e a mesma
 * gramatica do controle, sem inventar um terceiro esquema.
 *
 * `sprint` = agressivo (variacao mais arriscada e mais rapida).
 * `postUp`  = recuar (familia de escape).
 */
export function moveForStick(
  dir: { x: number; y: number },
  aggressive: boolean,
  retreat: boolean,
  doubleTap: boolean,
): { id: string; side: -1 | 1 } | undefined {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  if (ax < 0.4 && ay < 0.4) return undefined;
  const side: -1 | 1 = dir.x >= 0 ? 1 : -1;

  // Lateral puro: crossover e familia.
  if (ax >= ay * 1.3) {
    if (retreat) return { id: aggressive ? 'behind_back_escape' : 'crossover_escape', side };
    if (doubleTap) return { id: aggressive ? 'misdirection_crossover' : 'double_crossover', side };
    if (aggressive) return { id: 'behind_back', side };
    return { id: 'crossover', side };
  }

  // Para a frente: hesitacao e in-and-out (ataca o pe do defensor).
  if (dir.y > 0) {
    if (doubleTap) return { id: 'misdirection_hesitation', side };
    if (aggressive) return { id: 'moving_cross_spin', side };
    return { id: retreat ? 'hesitation_escape' : 'hesitation', side };
  }

  // Para tras: recuo. Com componente lateral vira stepback do lado apontado.
  if (ax > 0.28) return { id: aggressive ? 'stepback_crossover' : 'stepback', side };
  return { id: aggressive ? 'lateral_stepback' : 'between_legs_escape', side };
}

export class InputManager {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  private shootHeldTime = 0;
  /** Relogio interno, so para medir duplo toque. */
  private clock = 0;
  private lastShootHeld = false;
  bindings: InputBindings;
  scheme: ControlScheme = 'advanced';
  gamepadIndex: number | null = null;
  /** Ultimo valor do stick de arremesso (0..1). */
  shootStick = 0;
  /**
   * Alvo apontado pelo mouse, em metros na quadra. O cliente preenche isto a
   * cada quadro desprojetando o cursor no plano do chao. No computador o
   * mouse e o recurso mais desperdicado: da direcao exata sem gastar tecla.
   */
  pointer: { x: number; y: number } | null = null;
  /** Slot (0..4) do companheiro sob o cursor, para passe por icone. */
  pointerTeammate: number | null = null;
  private pointerPass = false;
  private lastStickDir = { x: 0, y: 0 };
  private lastStickAt = -99;
  private stickTapSide = 0;

  constructor(target: EventTarget = window, bindings: InputBindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    target.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      this.keys.add(ev.code);
      this.pressedThisFrame.add(ev.code);
      if (this.isBound(ev.code, 'pause') || this.isBound(ev.code, 'shoot')) ev.preventDefault();
    });
    // Mouse: botao esquerdo passa para quem esta sob o cursor.
    target.addEventListener('mousedown', (e) => {
      const ev = e as MouseEvent;
      if (ev.button === 0) this.pointerPass = true;
      if (ev.button === 2) this.keys.add('MouseRight');
    });
    target.addEventListener('mouseup', (e) => {
      const ev = e as MouseEvent;
      if (ev.button === 2) this.keys.delete('MouseRight');
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    target.addEventListener('keyup', (e) => {
      const ev = e as KeyboardEvent;
      this.keys.delete(ev.code);
      this.releasedThisFrame.add(ev.code);
    });
    target.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = (e as GamepadEvent).gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  private isBound(code: string, action: keyof InputBindings): boolean {
    return this.bindings[action].includes(code);
  }

  private down(action: keyof InputBindings): boolean {
    return this.bindings[action].some((code) => this.keys.has(code));
  }

  private pressed(action: keyof InputBindings): boolean {
    return this.bindings[action].some((code) => this.pressedThisFrame.has(code));
  }

  private released(action: keyof InputBindings): boolean {
    return this.bindings[action].some((code) => this.releasedThisFrame.has(code));
  }

  wasPressed(action: keyof InputBindings): boolean {
    return this.pressed(action);
  }

  /** Le o gamepad, se houver. */
  private gamepad(): Gamepad | null {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] ?? null;
  }

  /**
   * Monta o comando do frame. `cameraForward` gira o input para o referencial
   * da camera: apertar "para cima" e sempre "para longe da camera".
   */
  poll(dt: number, cameraYaw: number): UserCommand {
    this.clock += dt;
    const cmd = emptyCommand();
    const pad = this.gamepad();

    // --- Movimento ---
    // No esquema avancado as SETAS sao o stick direito, entao elas saem do
    // movimento: WASD anda, setas driblam e arremessam. No iniciante as duas
    // coisas continuam andando, que e o que alguem espera na primeira partida.
    const arrowsAreStick = this.scheme === 'advanced';
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyA')) mx -= 1;
    if (this.keys.has('KeyD')) mx += 1;
    if (this.keys.has('KeyW')) my += 1;
    if (this.keys.has('KeyS')) my -= 1;
    if (!arrowsAreStick) {
      if (this.down('stickLeft')) mx -= 1;
      if (this.down('stickRight')) mx += 1;
      if (this.down('stickUp')) my += 1;
      if (this.down('stickDown')) my -= 1;
    }
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.16) mx += ax;
      if (Math.abs(ay) > 0.16) my -= ay;
    }
    const raw = v2(mx, my);
    const mag = Math.min(1, len2(raw));
    if (mag > 0.01) {
      const dir = norm2(raw);
      // Rotaciona para o referencial da camera.
      const cos = Math.cos(cameraYaw);
      const sin = Math.sin(cameraYaw);
      cmd.move = v2((dir.x * cos - dir.y * sin) * mag, (dir.x * sin + dir.y * cos) * mag);
    }

    cmd.sprint = this.down('sprint') || (pad ? (pad.buttons[7]?.value ?? 0) > 0.4 : false);

    // --- Arremesso de ritmo ---
    // Teclado: manter a tecla acumula o "puxao" do stick; soltar libera.
    // Gamepad: o stick direito para baixo e o puxao real.
    let stick = 0;
    if (pad) {
      const ry = pad.axes[3] ?? 0;
      stick = clamp01(ry); // para baixo = positivo
    }
    // Seta para baixo (stick) e botao direito do mouse tambem carregam o
    // arremesso: e o mesmo gesto do controle, puxar e soltar.
    const keyShoot = this.down('shoot')
      || (arrowsAreStick && this.down('stickDown'))
      || this.keys.has('MouseRight');
    if (keyShoot) {
      this.shootHeldTime += dt;
      stick = Math.max(stick, clamp01(this.shootHeldTime / 0.55));
    } else if (!pad || stick < 0.05) {
      this.shootHeldTime = 0;
    }
    this.shootStick = stick;
    cmd.shootStick = stick;
    cmd.shootHeld = stick > 0.12;
    cmd.shootReleased = this.lastShootHeld && !cmd.shootHeld;
    this.lastShootHeld = cmd.shootHeld;

    // --- Acoes ---
    const padPressed = (i: number) => (pad ? (pad.buttons[i]?.pressed ?? false) : false);
    cmd.passRequested = this.pressed('pass') || padPressed(0);
    cmd.driveRequested = this.down('drive') || padPressed(1);
    cmd.stealRequested = this.pressed('steal') || padPressed(2);
    cmd.blockRequested = this.pressed('block') || padPressed(3);
    cmd.postUp = this.down('postUp') || (pad ? (pad.buttons[6]?.value ?? 0) > 0.4 : false);
    cmd.callScreen = this.pressed('callScreen') || padPressed(5);
    cmd.switchPlayer = this.pressed('switchPlayer') || padPressed(4);
    cmd.timeout = this.pressed('timeout');
    cmd.intentionalFoul = this.pressed('intentionalFoul');
    cmd.lobRequested = this.down('sprint') && cmd.passRequested;

    // --- Moves de drible no stick direito (modo avancado) ---
    if (this.scheme === 'advanced' && pad) {
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.abs(rx) > 0.55 && Math.abs(ry) < 0.5) {
        cmd.moveRequest = { id: cmd.sprint ? 'behind_back' : 'crossover', side: rx > 0 ? 1 : -1 };
      } else if (ry < -0.6) {
        cmd.moveRequest = { id: 'hesitation', side: 1 };
      } else if (ry > 0.6 && Math.abs(rx) > 0.35) {
        cmd.moveRequest = { id: 'stepback', side: rx > 0 ? 1 : -1 };
      }
    }
    // Stick de setas no teclado: a mesma gramatica do controle.
    if (arrowsAreStick) {
      let sx = 0;
      let sy = 0;
      if (this.pressed('stickLeft')) sx -= 1;
      if (this.pressed('stickRight')) sx += 1;
      if (this.pressed('stickUp')) sy += 1;
      // Para baixo sozinho e arremesso, nao move; so conta com lateral junto.
      if (this.pressed('stickDown') && (this.down('stickLeft') || this.down('stickRight'))) sy -= 1;

      if (sx !== 0 || sy !== 0) {
        // Duplo toque no mesmo lado em 320 ms sobe para a variacao dupla.
        const now = this.clock;
        const doubleTap = sx !== 0 && sx === this.stickTapSide && now - this.lastStickAt < 0.32;
        this.stickTapSide = sx;
        this.lastStickAt = now;
        const chosen = moveForStick({ x: sx, y: sy }, cmd.sprint, this.down('postUp'), doubleTap);
        if (chosen) cmd.moveRequest = chosen;
      }
      // Z e X continuam valendo como atalho de crossover.
      if (this.pressed('moveLeftStick')) cmd.moveRequest = { id: 'crossover', side: -1 };
      if (this.pressed('moveRightStick')) cmd.moveRequest = { id: 'crossover', side: 1 };
    } else {
      if (this.pressed('moveLeftStick')) cmd.moveRequest = { id: 'crossover', side: -1 };
      if (this.pressed('moveRightStick')) cmd.moveRequest = { id: 'crossover', side: 1 };
    }

    // --- Passe por icone -----------------------------------------------------
    // Teclas 1..5 escolhem o companheiro; o clique escolhe quem esta sob o
    // cursor. Sem alvo, o passe vai para quem estiver mais aberto na direcao
    // apontada -- o simulador decide, nao o teclado.
    for (let i = 0; i < 5; i++) {
      if (this.pressedThisFrame.has(`Digit${i + 1}`)) {
        cmd.passRequested = true;
        cmd.passTargetSlot = i;
      }
    }
    if (this.pointerPass) {
      cmd.passRequested = true;
      if (this.pointerTeammate !== null) cmd.passTargetSlot = this.pointerTeammate;
      this.pointerPass = false;
    }

    // Com o mouse apontando, a direcao do passe e a do cursor, nao a do WASD:
    // no computador da para mirar e correr para outro lado ao mesmo tempo.
    if (this.pointer && cmd.passRequested && cmd.passTargetSlot === undefined) {
      cmd.move = v2(cmd.move.x, cmd.move.y);
    }

    return cmd;
  }

  /** Limpa os eventos de borda. Chamar no fim do frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }
}

/** Controles de toque, para a tela de ajuda no celular. */
export const TOUCH_HELP: { action: string; gesture: string }[] = [
  { action: 'Mover', gesture: 'Toque e arraste em qualquer ponto da metade esquerda (analogico flutuante)' },
  { action: 'Correr', gesture: 'Empurre o analogico ate o fim do curso, ou segure CORRER na defesa' },
  { action: 'Arremessar', gesture: 'Segure ARR, arraste para baixo e solte no tempo certo' },
  { action: 'Arremesso simples', gesture: 'Se preferir, so segure ARR e solte: o medidor enche sozinho' },
  { action: 'Passar', gesture: 'Toque em PASSE' },
  { action: 'Passe alto / alley-oop', gesture: 'Segure ATACAR e toque em PASSE' },
  { action: 'Atacar a cesta', gesture: 'Segure ATACAR' },
  { action: 'Move de drible', gesture: 'Arraste DRIBLE na direcao: lados = crossover, cima = hesitation, baixo = stepback' },
  { action: 'Jogo de costas', gesture: 'Segure POSTE' },
  { action: 'Pedir bloqueio', gesture: 'Toque em BLOQ.' },
  { action: 'Roubar / tocar', gesture: 'Na defesa a botoeira troca sozinha: ROUBO e TOCO' },
  { action: 'Trocar de jogador', gesture: 'Toque em TROCAR (defesa)' },
];

/** Texto de ajuda dos controles (secao 115: acessibilidade/clareza). */
export const CONTROL_HELP: { action: string; keyboard: string; gamepad: string }[] = [
  { action: 'Mover', keyboard: 'WASD', gamepad: 'Analogico esquerdo' },
  { action: 'Correr', keyboard: 'Shift', gamepad: 'RT' },
  { action: 'Arremessar (ritmo)', keyboard: 'Segurar e soltar Espaco, Seta baixo ou botao direito do mouse', gamepad: 'Analogico direito para baixo e soltar' },
  { action: 'Passar', keyboard: 'J', gamepad: 'A' },
  { action: 'Passar para um companheiro', keyboard: '1 a 5, ou clique nele', gamepad: '-' },
  { action: 'Alley-oop', keyboard: 'Shift + J', gamepad: 'Shift + A' },
  { action: 'Atacar a cesta', keyboard: 'K', gamepad: 'B' },
  { action: 'Roubar', keyboard: 'J (defendendo)', gamepad: 'X' },
  { action: 'Tocar', keyboard: 'Espaco (defendendo)', gamepad: 'Y' },
  { action: 'Poste', keyboard: 'L', gamepad: 'LT' },
  { action: 'Pedir bloqueio', keyboard: 'E', gamepad: 'RB' },
  { action: 'Trocar jogador', keyboard: 'Q', gamepad: 'LB' },
  { action: 'Move de drible', keyboard: 'Setas (o stick direito do teclado)', gamepad: 'Analogico direito' },
  { action: '  crossover / behind the back', keyboard: 'Seta lateral / com Shift', gamepad: 'Stick lateral / com RT' },
  { action: '  duplo crossover / misdirection', keyboard: 'Dois toques na seta lateral', gamepad: 'Dois toques no stick' },
  { action: '  hesitacao / cross spin', keyboard: 'Seta cima / com Shift', gamepad: 'Stick cima' },
  { action: '  stepback / stepback crossover', keyboard: 'Seta baixo + lateral / com Shift', gamepad: 'Stick baixo + lateral' },
  { action: '  familia de escape', keyboard: 'Segurar L junto do move', gamepad: 'LT junto do move' },
  { action: 'Camera', keyboard: 'C', gamepad: '-' },
  { action: 'Tempo tecnico', keyboard: 'T', gamepad: '-' },
  { action: 'Falta proposital', keyboard: 'F', gamepad: '-' },
  { action: 'Pausar', keyboard: 'Esc', gamepad: 'Start' },
];
