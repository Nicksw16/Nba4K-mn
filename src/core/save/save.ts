/**
 * SAVE (secao 133).
 *
 * Serializacao versionada com migracao. Multiplos slots de carreira e de
 * franquia, autosave e recuperacao de backup. Usa localStorage quando
 * disponivel e cai para memoria em ambientes sem DOM (testes, CLI).
 */
import { CareerState } from '../career/career.js';
import { League } from '../data/generator.js';
import { SeasonState } from '../franchise/league.js';
import { Sliders } from '../config/sliders.js';
import { BuildInput } from '../model/build.js';

export const SAVE_VERSION = 3;

export interface SaveMeta {
  slot: string;
  kind: 'career' | 'franchise' | 'settings' | 'build';
  label: string;
  updatedAt: number;
  version: number;
}

export interface CareerSave {
  meta: SaveMeta;
  career: CareerState;
  build: BuildInput;
  leagueSeed: string;
  season: number;
}

export interface FranchiseSave {
  meta: SaveMeta;
  leagueSeed: string;
  season: number;
  userTeamId: string;
  standings: [string, { wins: number; losses: number; pointsFor: number; pointsAgainst: number; streak: number }][];
  day: number;
  trust: number;
}

export interface SettingsSave {
  meta: SaveMeta;
  sliders: Sliders;
  audioVolume: number;
  cameraMode: string;
  controlScheme: 'beginner' | 'advanced';
  accessibility: {
    colorblind: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
    textScale: number;
    shotCues: boolean;
    audioCues: boolean;
    reducedMotion: boolean;
  };
}

interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get(key: string): string | null { return this.map.get(key) ?? null; }
  set(key: string, value: string): void { this.map.set(key, value); }
  remove(key: string): void { this.map.delete(key); }
  keys(): string[] { return [...this.map.keys()]; }
}

class BrowserStorage implements Storage {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  set(key: string, value: string): void {
    try { window.localStorage.setItem(key, value); } catch { /* cota cheia: o autosave simplesmente nao grava */ }
  }
  remove(key: string): void {
    try { window.localStorage.removeItem(key); } catch { /* ignorado */ }
  }
  keys(): string[] {
    try {
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k) out.push(k);
      }
      return out;
    } catch { return []; }
  }
}

const PREFIX = 'courtside:';

export class SaveManager {
  private storage: Storage;

  constructor() {
    this.storage = SaveManager.canUseLocalStorage() ? new BrowserStorage() : new MemoryStorage();
  }

  /**
   * So LER `window.localStorage` ja lanca SecurityError em alguns navegadores
   * quando a pagina vem de arquivo local ou os dados de site estao bloqueados.
   * Um `typeof` nao protege: ele avalia o getter do mesmo jeito. Por isso o
   * teste e uma escrita de verdade dentro de try/catch.
   */
  private static canUseLocalStorage(): boolean {
    try {
      if (typeof window === 'undefined') return false;
      const ls = window.localStorage;
      if (!ls) return false;
      const probe = `${PREFIX}probe`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  private key(kind: string, slot: string): string {
    return `${PREFIX}${kind}:${slot}`;
  }

  write<T extends { meta: SaveMeta }>(data: T): void {
    data.meta.updatedAt = Date.now();
    data.meta.version = SAVE_VERSION;
    const key = this.key(data.meta.kind, data.meta.slot);
    // Backup do estado anterior antes de sobrescrever (secao 133).
    const previous = this.storage.get(key);
    if (previous) this.storage.set(`${key}:bak`, previous);
    this.storage.set(key, JSON.stringify(data));
  }

  read<T extends { meta: SaveMeta }>(kind: SaveMeta['kind'], slot: string): T | null {
    const raw = this.storage.get(this.key(kind, slot));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as T;
      return migrate(parsed);
    } catch {
      return this.restoreBackup<T>(kind, slot);
    }
  }

  restoreBackup<T extends { meta: SaveMeta }>(kind: SaveMeta['kind'], slot: string): T | null {
    const raw = this.storage.get(`${this.key(kind, slot)}:bak`);
    if (!raw) return null;
    try { return migrate(JSON.parse(raw) as T); } catch { return null; }
  }

  list(kind?: SaveMeta['kind']): SaveMeta[] {
    const out: SaveMeta[] = [];
    for (const k of this.storage.keys()) {
      if (!k.startsWith(PREFIX) || k.endsWith(':bak')) continue;
      const raw = this.storage.get(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { meta: SaveMeta };
        if (!kind || parsed.meta.kind === kind) out.push(parsed.meta);
      } catch { /* entrada corrompida e ignorada na listagem */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  delete(kind: SaveMeta['kind'], slot: string): void {
    this.storage.remove(this.key(kind, slot));
    this.storage.remove(`${this.key(kind, slot)}:bak`);
  }
}

/** Migracao entre versoes de save. */
function migrate<T extends { meta: SaveMeta }>(data: T): T {
  if (!data.meta) return data;
  if (data.meta.version === SAVE_VERSION) return data;
  // v1 -> v2: progressao ganhou trilhas separadas.
  const anyData = data as unknown as Record<string, unknown>;
  if (data.meta.version < 2 && anyData.career) {
    const career = anyData.career as Record<string, unknown>;
    const prog = career.progression as Record<string, unknown> | undefined;
    if (prog && !prog.tracks) {
      prog.tracks = { shooting: 0, finishing: 0, playmaking: 0, defense: 0, rebounding: 0, physicals: 0 };
    }
  }
  // v2 -> v3: moedas separadas.
  if (data.meta.version < 3 && anyData.career) {
    const career = anyData.career as Record<string, unknown>;
    if (!career.currency) career.currency = { earned: 0, cosmetic: 0 };
  }
  data.meta.version = SAVE_VERSION;
  return data;
}
