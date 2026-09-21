/**
 * Eventos da partida. Um unico fluxo alimenta estatistica, apresentacao,
 * audio, comentario, replay e o ticker de highlights.
 */
import { Vec2, Vec3 } from '../math/vec.js';
import { ShotZone } from '../config/court.js';

export type GameEventKind =
  | 'tipoff' | 'period_start' | 'period_end' | 'game_end'
  | 'shot_attempt' | 'shot_made' | 'shot_missed' | 'free_throw'
  | 'dunk' | 'layup' | 'block' | 'steal' | 'turnover' | 'deflection'
  | 'rebound' | 'assist' | 'foul' | 'timeout' | 'substitution'
  | 'ankle_breaker' | 'screen_assist' | 'fast_break' | 'and_one'
  | 'jump_ball' | 'out_of_bounds' | 'shot_clock_violation' | 'backcourt'
  | 'takeover_start' | 'takeover_end' | 'injury' | 'foul_out'
  | 'play_call' | 'gameplan_change' | 'run';

export interface GameEvent {
  kind: GameEventKind;
  period: number;
  clock: number;
  team?: 0 | 1;
  playerId?: string;
  secondaryId?: string;
  pos?: Vec2 | Vec3;
  value?: number;
  zone?: ShotZone;
  text?: string;
  /** Intensidade 0..1: alimenta torcida, replay e camera. */
  drama?: number;
  data?: Record<string, unknown>;
}

export class EventLog {
  private events: GameEvent[] = [];
  private listeners: ((e: GameEvent) => void)[] = [];

  push(e: GameEvent): void {
    this.events.push(e);
    for (const l of this.listeners) l(e);
  }

  subscribe(fn: (e: GameEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  all(): readonly GameEvent[] {
    return this.events;
  }

  recent(n: number): GameEvent[] {
    return this.events.slice(-n);
  }

  /** Eventos com maior valor de drama: base do Replay Director (secao 96). */
  highlights(min = 0.6): GameEvent[] {
    return this.events.filter((e) => (e.drama ?? 0) >= min);
  }

  clear(): void {
    this.events = [];
  }
}
