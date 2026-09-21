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
};

export class InputManager {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  private shootHeldTime = 0;
  private lastShootHeld = false;
  bindings: InputBindings;
  scheme: ControlScheme = 'advanced';
  gamepadIndex: number | null = null;
  /** Ultimo valor do stick de arremesso (0..1). */
  shootStick = 0;

  constructor(target: EventTarget = window, bindings: InputBindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    target.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      this.keys.add(ev.code);
      this.pressedThisFrame.add(ev.code);
      if (this.isBound(ev.code, 'pause') || this.isBound(ev.code, 'shoot')) ev.preventDefault();
    });
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
    const cmd = emptyCommand();
    const pad = this.gamepad();

    // --- Movimento ---
    let mx = 0;
    let my = 0;
    if (this.down('moveLeft')) mx -= 1;
    if (this.down('moveRight')) mx += 1;
    if (this.down('moveUp')) my += 1;
    if (this.down('moveDown')) my -= 1;
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
    const keyShoot = this.down('shoot');
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
    if (this.scheme === 'advanced') {
      if (this.pressed('moveLeftStick')) cmd.moveRequest = { id: 'crossover', side: -1 };
      if (this.pressed('moveRightStick')) cmd.moveRequest = { id: 'crossover', side: 1 };
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

/** Texto de ajuda dos controles (secao 115: acessibilidade/clareza). */
export const CONTROL_HELP: { action: string; keyboard: string; gamepad: string }[] = [
  { action: 'Mover', keyboard: 'WASD / setas', gamepad: 'Analogico esquerdo' },
  { action: 'Correr', keyboard: 'Shift', gamepad: 'RT' },
  { action: 'Arremessar (ritmo)', keyboard: 'Segurar e soltar Espaco', gamepad: 'Analogico direito para baixo e soltar' },
  { action: 'Passar', keyboard: 'J', gamepad: 'A' },
  { action: 'Atacar a cesta', keyboard: 'K', gamepad: 'B' },
  { action: 'Roubar', keyboard: 'J (defendendo)', gamepad: 'X' },
  { action: 'Tocar', keyboard: 'Espaco (defendendo)', gamepad: 'Y' },
  { action: 'Poste', keyboard: 'L', gamepad: 'LT' },
  { action: 'Pedir bloqueio', keyboard: 'E', gamepad: 'RB' },
  { action: 'Trocar jogador', keyboard: 'Q', gamepad: 'LB' },
  { action: 'Move de drible', keyboard: 'Z / X', gamepad: 'Analogico direito' },
  { action: 'Camera', keyboard: 'C', gamepad: '-' },
  { action: 'Tempo tecnico', keyboard: 'T', gamepad: '-' },
  { action: 'Pausar', keyboard: 'Esc', gamepad: 'Start' },
];
