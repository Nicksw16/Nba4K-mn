/**
 * CONTROLES DE TOQUE (secoes 115, 116, 117).
 *
 * Produz exatamente o mesmo `UserCommand` que teclado e controle. Nada no
 * motor sabe que existe toque.
 *
 * Decisoes que importam para jogar de verdade no celular:
 *  - O analogico e FLUTUANTE: aparece onde o dedo encostar na metade esquerda,
 *    em vez de exigir mira em um alvo fixo.
 *  - Correr e automatico no fim do curso do analogico, para nao ocupar um
 *    botao. Ha tambem um botao dedicado para quem prefere.
 *  - O arremesso de ritmo vira ARRASTAR PARA BAIXO e soltar, que e o mesmo
 *    gesto do analogico direito no controle. Segurar sem arrastar tambem
 *    funciona, para quem nao quiser aprender o gesto.
 *  - A botoeira troca sozinha entre ataque e defesa, porque em um celular nao
 *    ha espaco para mostrar as duas ao mesmo tempo.
 */
import { Vec2, v2 } from '../../core/math/vec.js';
import { clamp, clamp01 } from '../../core/math/util.js';
import { UserCommand } from '../../core/sim/game.js';

export type TouchMode = 'offense' | 'defense';

interface StickState {
  active: boolean;
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

interface ButtonSpec {
  id: string;
  label: string;
  hint: string;
  /** Posicao no cluster, em unidades de raio. */
  dx: number;
  dy: number;
  size: number;
  /** Cor de destaque. */
  tone: 'primary' | 'accent' | 'neutral' | 'danger';
  /** Visivel em qual contexto. */
  mode: TouchMode | 'both';
  /** Gesto de arrastar habilitado (arremesso). */
  drag?: 'shoot' | 'move';
}

/**
 * Arco de polegar: o botao principal fica no centro do alcance natural e os
 * demais se abrem em leque para cima e para a esquerda. Nada passa do limite
 * do cluster, entao nenhum botao encosta na borda da tela.
 */
const BUTTONS: ButtonSpec[] = [
  { id: 'shoot', label: 'ARR', hint: 'arraste para baixo e solte', dx: 0, dy: 0, size: 1.32, tone: 'accent', mode: 'offense', drag: 'shoot' },
  { id: 'pass', label: 'PASSE', hint: 'toque', dx: -1.38, dy: 0.35, size: 1, tone: 'primary', mode: 'offense' },
  { id: 'drive', label: 'ATACAR', hint: 'segure', dx: -1.05, dy: -0.95, size: 1, tone: 'primary', mode: 'offense' },
  { id: 'dribble', label: 'DRIBLE', hint: 'arraste a direcao', dx: 0.15, dy: -1.45, size: 1, tone: 'neutral', mode: 'offense', drag: 'move' },
  { id: 'post', label: 'POSTE', hint: 'segure', dx: 1.25, dy: -0.5, size: 0.86, tone: 'neutral', mode: 'offense' },
  { id: 'screen', label: 'BLOQ.', hint: 'pedir bloqueio', dx: -2.02, dy: -0.72, size: 0.8, tone: 'neutral', mode: 'offense' },

  { id: 'block', label: 'TOCO', hint: 'toque', dx: 0, dy: 0, size: 1.32, tone: 'accent', mode: 'defense' },
  { id: 'steal', label: 'ROUBO', hint: 'toque', dx: -1.38, dy: 0.35, size: 1, tone: 'danger', mode: 'defense' },
  { id: 'switch', label: 'TROCAR', hint: 'toque', dx: -1.05, dy: -0.95, size: 1, tone: 'primary', mode: 'defense' },
  { id: 'sprintD', label: 'CORRER', hint: 'segure', dx: 0.15, dy: -1.45, size: 1, tone: 'neutral', mode: 'defense' },
];

export class TouchInput {
  readonly enabled: boolean;
  private root: HTMLElement | null = null;
  private stickBase: HTMLElement | null = null;
  private stickKnob: HTMLElement | null = null;
  private buttons = new Map<string, HTMLElement>();
  private stick: StickState = { active: false, pointerId: -1, originX: 0, originY: 0, x: 0, y: 0 };
  private held = new Set<string>();
  private tapped = new Set<string>();
  private released = new Set<string>();
  private pointerButton = new Map<number, string>();
  /** Arraste do botao de arremesso: 0..1. */
  private shootDrag = 0;
  private shootHeldTime = 0;
  private shootWasHeld = false;
  private moveGesture: { id: string; side: -1 | 1 } | null = null;
  private dragStart = new Map<number, { x: number; y: number }>();
  mode: TouchMode = 'offense';
  private radius = 34;

  constructor(host: HTMLElement) {
    this.enabled = TouchInput.isTouchDevice();
    if (!this.enabled) return;
    this.build(host);
  }

  static isTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return ('ontouchstart' in window) || (navigator.maxTouchPoints ?? 0) > 0;
  }

  private build(host: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'touch-layer';
    root.innerHTML = `
      <div class="touch-stick" hidden>
        <div class="touch-stick-base"></div>
        <div class="touch-stick-knob"></div>
      </div>
      <div class="touch-cluster"></div>
      <div class="touch-hint"></div>
    `;
    host.appendChild(root);
    this.root = root;
    this.stickBase = root.querySelector('.touch-stick') as HTMLElement;
    this.stickKnob = root.querySelector('.touch-stick-knob') as HTMLElement;

    const cluster = root.querySelector('.touch-cluster') as HTMLElement;
    for (const spec of BUTTONS) {
      const el = document.createElement('div');
      el.className = `touch-btn tone-${spec.tone}`;
      el.dataset.id = spec.id;
      el.style.setProperty('--dx', String(spec.dx));
      el.style.setProperty('--dy', String(spec.dy));
      el.style.setProperty('--size', String(spec.size));
      el.innerHTML = `<span>${spec.label}</span>`;
      cluster.appendChild(el);
      this.buttons.set(spec.id, el);
    }

    root.addEventListener('pointerdown', this.onDown, { passive: false });
    root.addEventListener('pointermove', this.onMove, { passive: false });
    root.addEventListener('pointerup', this.onUp, { passive: false });
    root.addEventListener('pointercancel', this.onUp, { passive: false });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.applyMode();
  }

  private specFor(id: string): ButtonSpec | undefined {
    return BUTTONS.find((b) => b.id === id);
  }

  private hitButton(x: number, y: number): string | null {
    for (const [id, el] of this.buttons) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Alvo de toque com folga: o dedo nao e um cursor.
      if (Math.hypot(x - cx, y - cy) <= r.width / 2 + 8) return id;
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    const btn = this.hitButton(e.clientX, e.clientY);
    if (btn) {
      e.preventDefault();
      this.pointerButton.set(e.pointerId, btn);
      this.dragStart.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.held.add(btn);
      this.tapped.add(btn);
      this.buttons.get(btn)?.classList.add('down');
      return;
    }
    // Metade esquerda vira analogico flutuante.
    if (e.clientX < window.innerWidth * 0.5 && !this.stick.active) {
      e.preventDefault();
      this.stick = { active: true, pointerId: e.pointerId, originX: e.clientX, originY: e.clientY, x: 0, y: 0 };
      if (this.stickBase) {
        this.stickBase.hidden = false;
        this.stickBase.style.left = `${e.clientX}px`;
        this.stickBase.style.top = `${e.clientY}px`;
      }
      this.updateKnob();
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.stick.active && e.pointerId === this.stick.pointerId) {
      e.preventDefault();
      const dx = e.clientX - this.stick.originX;
      const dy = e.clientY - this.stick.originY;
      const len = Math.hypot(dx, dy);
      const max = this.radius * 1.55;
      const scale = len > max ? max / len : 1;
      this.stick.x = (dx * scale) / max;
      this.stick.y = (dy * scale) / max;
      this.updateKnob();
      return;
    }
    const btn = this.pointerButton.get(e.pointerId);
    if (!btn) return;
    const spec = this.specFor(btn);
    const start = this.dragStart.get(e.pointerId);
    if (!spec?.drag || !start) return;
    e.preventDefault();
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (spec.drag === 'shoot') {
      // Arrastar para BAIXO carrega o arremesso, como puxar o analogico direito.
      this.shootDrag = clamp01(dy / 96);
    } else if (spec.drag === 'move') {
      if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) {
        this.moveGesture = { id: this.held.has('sprintD') ? 'behind_back' : 'crossover', side: dx > 0 ? 1 : -1 };
      } else if (dy < -26) {
        this.moveGesture = { id: 'hesitation', side: 1 };
      } else if (dy > 26) {
        this.moveGesture = { id: 'stepback', side: dx >= 0 ? 1 : -1 };
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.stick.active && e.pointerId === this.stick.pointerId) {
      this.stick.active = false;
      this.stick.x = 0;
      this.stick.y = 0;
      if (this.stickBase) this.stickBase.hidden = true;
      return;
    }
    const btn = this.pointerButton.get(e.pointerId);
    if (btn) {
      this.pointerButton.delete(e.pointerId);
      this.dragStart.delete(e.pointerId);
      this.held.delete(btn);
      this.released.add(btn);
      this.buttons.get(btn)?.classList.remove('down');
    }
  };

  private updateKnob(): void {
    if (!this.stickKnob) return;
    const max = this.radius * 1.55;
    this.stickKnob.style.transform = `translate(calc(-50% + ${this.stick.x * max}px), calc(-50% + ${this.stick.y * max}px))`;
  }

  /** Alterna a botoeira entre ataque e defesa. */
  setMode(mode: TouchMode): void {
    if (!this.enabled || this.mode === mode) return;
    this.mode = mode;
    this.applyMode();
  }

  private applyMode(): void {
    for (const spec of BUTTONS) {
      const el = this.buttons.get(spec.id);
      if (!el) continue;
      el.hidden = spec.mode !== 'both' && spec.mode !== this.mode;
    }
  }

  setVisible(visible: boolean): void {
    if (this.root) this.root.style.display = visible ? 'block' : 'none';
  }

  showHint(text: string): void {
    const hint = this.root?.querySelector('.touch-hint') as HTMLElement | null;
    if (!hint) return;
    hint.textContent = text;
    hint.classList.add('show');
    window.setTimeout(() => hint.classList.remove('show'), 3200);
  }

  /** Escreve o estado do toque sobre o comando vindo de teclado/controle. */
  apply(cmd: UserCommand, dt: number): UserCommand {
    if (!this.enabled) return cmd;

    // Analogico: a tela tem Y para baixo, o mundo tem Y para cima.
    const mag = Math.hypot(this.stick.x, this.stick.y);
    if (mag > 0.08) {
      cmd.move = v2(this.stick.x, -this.stick.y);
      // Correr no fim do curso, sem gastar um botao.
      if (mag > 0.86) cmd.sprint = true;
    }
    if (this.held.has('sprintD')) cmd.sprint = true;

    // Arremesso de ritmo: arrastar para baixo OU segurar.
    const shootHeld = this.held.has('shoot') || this.held.has('block');
    if (shootHeld) this.shootHeldTime += dt;
    const byTime = clamp01(this.shootHeldTime / 0.55);
    const value = Math.max(this.shootDrag, byTime);
    if (shootHeld) {
      cmd.shootStick = value;
      cmd.shootHeld = value > 0.12;
    }
    cmd.shootReleased = cmd.shootReleased || (this.shootWasHeld && !cmd.shootHeld);
    if (!shootHeld) {
      this.shootHeldTime = 0;
      this.shootDrag = 0;
    }
    this.shootWasHeld = cmd.shootHeld;

    if (this.tapped.has('pass')) cmd.passRequested = true;
    if (this.tapped.has('steal')) cmd.stealRequested = true;
    if (this.tapped.has('switch')) cmd.switchPlayer = true;
    if (this.tapped.has('screen')) cmd.callScreen = true;
    if (this.held.has('drive')) cmd.driveRequested = true;
    if (this.held.has('post')) cmd.postUp = true;
    if (this.released.has('block')) cmd.blockRequested = true;
    if (this.moveGesture) {
      cmd.moveRequest = this.moveGesture;
      this.moveGesture = null;
    }
    // Passe alto: passe com o dedo tambem no botao de atacar.
    if (cmd.passRequested && this.held.has('drive')) cmd.lobRequested = true;

    return cmd;
  }

  /** Limpa eventos de borda. Chamar no fim do frame. */
  endFrame(): void {
    this.tapped.clear();
    this.released.clear();
  }
}
