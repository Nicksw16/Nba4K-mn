/**
 * COURTSIDE: LEGACY - cliente.
 *
 * Um unico loop de animacao: simulacao com passo fixo, render interpolado por
 * frame. Os menus sao DOM (rapidos, acessiveis, com foco de teclado) e a
 * quadra e canvas. Nenhum botao e decorativo: cada tela opera sobre o mesmo
 * nucleo que o simulador headless usa.
 */
import { GameSim, UserCommand, emptyCommand } from '../core/sim/game.js';
import { DEFAULT_TUNING } from '../core/config/tuning.js';
import { DEFAULT_SLIDERS, Difficulty, Sliders } from '../core/config/sliders.js';
import { League, generateLeague } from '../core/data/generator.js';
import { Team, teamLabel } from '../core/model/team.js';
import { CameraMode, CameraState, addShake, buildProjection, createCamera, framingFor, updateCamera } from './render/camera.js';
import {
  ActorRenderInfo, DEFAULT_RENDER_OPTIONS, RenderOptions, TeamColors,
  drawActorOverlays, drawActors, drawBall, drawCourt, drawHoops, drawPlayArt, drawPointer,
} from './render/renderer.js';
import { HudState, createHudState, drawMatchupInfo, drawPlayerPanel, drawScorebug, drawShotFeedback, drawShotMeter, drawTicker } from './ui/hud.js';
import { AudioEngine, crowdLevelFor } from './audio/audio.js';
import { drawApron, drawHall, drawJumbotron, drawRibbon, drawStands } from './render/arena.js';
import { Renderer3D } from './gl/renderer3d.js';
import { skinToneFor } from './render/body.js';
import { createBall } from '../core/sim/ball.js';
import { CONTROL_HELP, TOUCH_HELP, InputManager } from './input/input.js';
import { TouchInput } from './input/touch.js';
import { el, clear, card, sliderRow, selectRow, table } from './ui/dom.js';
import { COURT, hoopGround } from '../core/config/court.js';
import { v2, v3 } from '../core/math/vec.js';
import { clamp, clamp01, damp, formatClock, pct } from '../core/math/util.js';
import { BOX_HEADER, formatPlayerLine, offensiveRating } from '../core/stats/boxscore.js';
import { SaveManager, SettingsSave } from '../core/save/save.js';
import { openBuilder } from './screens/builder.js';
import { openFranchise } from './screens/franchise.js';
import { openCareer } from './screens/career.js';
import { openPractice } from './screens/practice.js';

export type Screen = 'main' | 'quickplay' | 'game' | 'boxscore' | 'settings' | 'controls' | 'builder' | 'franchise' | 'career' | 'practice';

export interface AppContext {
  league: League;
  sliders: Sliders;
  saves: SaveManager;
  audio: AudioEngine;
  render: RenderOptions;
  go(screen: Screen): void;
  startGame(home: Team, away: Team, opts?: { userTeam?: 0 | 1; userPlayerId?: string; onEnd?: (sim: GameSim) => void }): void;
  ui: HTMLElement;
  app: App;
}

export class App {
  canvas: HTMLCanvasElement;
  /** Tela 2D por cima do palco 3D: scorebug, nomes, medidores. */
  private hudCanvas!: HTMLCanvasElement;
  /** Renderizador 3D, ou null quando o navegador nao tem WebGL2. */
  private gl3d: Renderer3D | null = null;
  /** Contexto 2D do PALCO, so no caminho de reserva. */
  private ctx2d: CanvasRenderingContext2D | null = null;
  private glError = '';
  ctx: CanvasRenderingContext2D;
  ui: HTMLElement;
  input: InputManager;
  touch: TouchInput;
  /** True em celular/tablet: muda qualidade, HUD e controles. */
  readonly isMobile: boolean;
  audio = new AudioEngine();
  camera: CameraState = createCamera();
  render: RenderOptions = { ...DEFAULT_RENDER_OPTIONS };
  hud: HudState = createHudState();
  saves = new SaveManager();
  sliders: Sliders = { ...DEFAULT_SLIDERS };
  league: League;
  sim: GameSim | null = null;
  screen: Screen = 'main';
  paused = false;
  private last = 0;
  private accumulator = 0;
  private timeScale = 1;
  private onGameEnd: ((sim: GameSim) => void) | null = null;
  private idleCameraAngle = 0;
  /** Energia da torcida amortecida: a arquibancada nao levanta num quadro. */
  private crowdEnergy = 0.25;
  /** Cursor em pixels do canvas, para desprojetar na quadra. */
  private mouse: { x: number; y: number } | null = null;
  /** Ultima projecao usada no desenho, reaproveitada para desprojetar. */
  private lastProj: ReturnType<typeof buildProjection> | null = null;
  private flashText = '';
  private flashUntil = 0;
  accessibility = {
    colorblind: 'none' as 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia',
    textScale: 1,
    shotCues: true,
    audioCues: true,
    reducedMotion: false,
  };

  constructor() {
    this.canvas = document.getElementById('stage') as HTMLCanvasElement;
    this.hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
    // Sem canvas 2D nao ha jogo. Melhor dizer isso do que estourar em
    // qualquer chamada de desenho la na frente, com uma pilha ilegivel.
    const ctx = this.hudCanvas?.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Este navegador nao liberou o canvas 2D, que e o que desenha o HUD.');
    this.ctx = ctx;

    // Palco em WebGL2 quando der. O Canvas 2D fica de reserva: navegador sem
    // WebGL2 (ou com a aceleracao desligada) continua jogando, so com a
    // apresentacao mais simples.
    try {
      window.__courtsideStage?.('preparando o 3D');
      this.gl3d = new Renderer3D(this.canvas);
    } catch (err) {
      this.gl3d = null;
      this.glError = err instanceof Error ? err.message : String(err);
      const fallback = this.canvas.getContext('2d', { alpha: false });
      if (!fallback) throw new Error('Este navegador nao liberou nem WebGL2 nem canvas 2D.');
      this.ctx2d = fallback;
    }
    this.ui = document.getElementById('ui') as HTMLElement;
    this.input = new InputManager(window);
    this.touch = new TouchInput(this.ui);
    this.isMobile = this.touch.enabled;
    if (this.isMobile) {
      // Celular: menos custo de render e HUD mais limpo por padrao.
      this.render.quality = 'medium';
      this.render.showNames = false;
      this.input.scheme = 'beginner';
    }
    this.touch.setVisible(false);
    window.__courtsideStage?.('gerando a liga');
    this.league = generateLeague('courtside-legacy');
    window.__courtsideStage?.('lendo seus ajustes');
    this.loadSettings();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // O mouse so importa no computador: no celular nao existe cursor.
    if (!this.isMobile) {
      window.addEventListener('mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; });
      window.addEventListener('mouseleave', () => { this.mouse = null; });
    }
    // WebAudio exige gesto do usuario.
    const unlock = () => {
      void this.audio.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private loadSettings(): void {
    const saved = this.saves.read<SettingsSave>('settings', 'default');
    if (saved) {
      this.sliders = { ...this.sliders, ...saved.sliders };
      this.audio.setVolume(saved.audioVolume);
      this.camera.mode = (saved.cameraMode as CameraMode) ?? 'broadcast';
      this.input.scheme = saved.controlScheme ?? 'advanced';
      if (saved.accessibility) this.accessibility = { ...this.accessibility, ...saved.accessibility };
    }
  }

  saveSettings(): void {
    this.saves.write<SettingsSave>({
      meta: { slot: 'default', kind: 'settings', label: 'Ajustes', updatedAt: 0, version: 0 },
      sliders: this.sliders,
      audioVolume: this.audio.volume,
      cameraMode: this.camera.mode,
      controlScheme: this.input.scheme,
      accessibility: this.accessibility,
    });
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.hudCanvas.width = w;
    this.hudCanvas.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gl3d?.resize(w, h);
  }

  get width(): number { return this.canvas.width / Math.min(2, window.devicePixelRatio || 1); }
  get height(): number { return this.canvas.height / Math.min(2, window.devicePixelRatio || 1); }

  context(): AppContext {
    return {
      league: this.league,
      sliders: this.sliders,
      saves: this.saves,
      audio: this.audio,
      render: this.render,
      go: (s) => this.go(s),
      startGame: (home, away, opts) => this.startGame(home, away, opts),
      ui: this.ui,
      app: this,
    };
  }

  go(screen: Screen): void {
    this.screen = screen;
    clear(this.ui);
    // `clear` remove a camada de toque junto: recriar e so mostrar no jogo.
    if (this.touch.enabled) {
      this.touch = new TouchInput(this.ui);
      this.touch.setVisible(screen === 'game');
    }
    switch (screen) {
      case 'main': this.renderMainMenu(); break;
      case 'quickplay': this.renderQuickPlay(); break;
      case 'settings': this.renderSettings(); break;
      case 'controls': this.renderControls(); break;
      case 'boxscore': this.renderBoxScore(); break;
      case 'builder': openBuilder(this.context()); break;
      case 'franchise': openFranchise(this.context()); break;
      case 'career': openCareer(this.context()); break;
      case 'practice': openPractice(this.context()); break;
      case 'game': this.renderGameOverlay(); break;
    }
    this.addFootroom();
  }

  /**
   * Espaco rolavel DEPOIS da barra de acao.
   *
   * A barra fica grudada no rodape, mas em celular a barra do navegador
   * aparece e some e come uns 50 px sem avisar. Com o botao encostado no fim
   * do conteudo nao ha para onde rolar, entao o que a barra do navegador
   * cobre fica inalcancavel. Com conteudo depois dele, a pessoa rola mais um
   * pouco e traz o botao para o meio do polegar -- e o botao continua
   * grudado, porque `sticky` so solta no fim do bloco.
   *
   * O que vai aqui e informacao de verdade: versao do arquivo, o que o motor
   * esta rodando e o lembrete de controle. Encher com texto decorativo
   * contraria a regra do proprio projeto (secao 135).
   */
  private addFootroom(): void {
    const screen = this.ui.querySelector('.screen');
    if (!screen || !screen.querySelector(':scope > .toolbar')) return;
    const hz = Math.round(1 / DEFAULT_TUNING.sim.dt);
    const dicas = this.isMobile
      ? TOUCH_HELP.slice(0, 3).map((h) => `${h.action}: ${h.gesture}`)
      : CONTROL_HELP.slice(0, 3).map((h) => `${h.action}: ${h.keyboard}`);
    screen.appendChild(el('div', { class: 'footroom' }, [
      ...dicas.map((t) => el('p', { text: t })),
      el('p', { text: `Simulacao a ${hz} Hz com passo fixo; o render interpola por frame. Times, atletas e arenas sao ficticios e gerados proceduralmente a partir de uma semente.` }),
      el('p', { class: 'versao', text: window.__courtsideVersao ? `versao ${window.__courtsideVersao}` : 'COURTSIDE: LEGACY' }),
    ]));
  }

  // ------------------------------------------------------------------ telas

  private brand(): HTMLElement {
    return el('div', { class: 'brand' }, [
      el('h1', { text: 'COURTSIDE: LEGACY' }),
      el('p', { text: 'simulacao de basquete · fisica continua · carreira e franquia' }),
    ]);
  }

  private renderMainMenu(): void {
    const screen = el('div', { class: 'screen' }, [
      this.brand(),
      el('div', { class: 'menu' }, [
        card('Partida rapida', 'Escolha dois times e jogue agora com o motor fisico completo.', () => this.go('quickplay')),
        card('Carreira', 'Crie um atleta, escolha a era e construa uma trajetoria do banco ao legado.', () => this.go('career')),
        card('Franquia', 'Assuma uma equipe: elenco, rotacao, trocas, free agency, draft e temporadas.', () => this.go('franchise')),
        card('Criar atleta', 'Builder completo com trade-offs reais de altura, peso e envergadura.', () => this.go('builder')),
        card('Treino', 'Quadra livre para testar drible, arremesso, finalizacao e defesa.', () => this.go('practice')),
        card('Ajustes', 'Dificuldade, sliders de simulacao, camera, audio e acessibilidade.', () => this.go('settings')),
        card('Controles', 'Esquema de teclado e controle, modo iniciante e avancado.', () => this.go('controls')),
      ]),
      el('p', { class: 'hint', text: 'Times, atletas, arenas e marcas sao ficticios e gerados proceduralmente. A simulacao roda a 120 Hz com passo fixo; o render interpola por frame.' }),
    ]);
    this.ui.appendChild(screen);
  }

  private renderQuickPlay(): void {
    let homeIdx = 0;
    let awayIdx = 1;
    let userSide: 'home' | 'away' | 'none' = 'home';

    const teamOptions = this.league.teams.map((t, i) => ({ value: String(i), label: teamLabel(t.identity) }));

    const panel = el('div', { class: 'panel' }, [
      el('h2', { text: 'Partida rapida' }),
      selectRow('Time da casa', String(homeIdx), teamOptions, (v) => { homeIdx = Number(v); }),
      selectRow('Time visitante', String(awayIdx), teamOptions, (v) => { awayIdx = Number(v); }),
      selectRow('Voce controla', userSide, [
        { value: 'home', label: 'Time da casa' },
        { value: 'away', label: 'Time visitante' },
        { value: 'none', label: 'Ninguem (assistir)' },
      ], (v) => { userSide = v as typeof userSide; }),
      selectRow('Dificuldade', this.sliders.difficulty, [
        { value: 'rookie', label: 'Novato' },
        { value: 'pro', label: 'Profissional' },
        { value: 'allstar', label: 'All-Star' },
        { value: 'superstar', label: 'Superestrela' },
        { value: 'legend', label: 'Lenda' },
      ], (v) => { this.sliders.difficulty = v as Difficulty; }),
      sliderRow('Duracao do periodo', this.sliders.quarterLengthSeconds / 60, 2, 12, 1, (v) => `${v} min`, (v) => {
        this.sliders.quarterLengthSeconds = v * 60;
      }),
      selectRow('Camera', this.camera.mode, [
        { value: 'broadcast', label: 'Transmissao' },
        { value: 'action', label: 'Acao' },
        { value: 'player_lock', label: 'Foco no atleta' },
        { value: 'street', label: 'Rua' },
      ], (v) => { this.camera.mode = v as CameraMode; }),
    ]);

    const start = el('button', { class: 'action', text: 'Iniciar partida', onclick: () => {
      if (homeIdx === awayIdx) awayIdx = (homeIdx + 1) % this.league.teams.length;
      this.startGame(this.league.teams[homeIdx], this.league.teams[awayIdx], {
        userTeam: userSide === 'none' ? undefined : userSide === 'home' ? 0 : 1,
      });
    } });

    this.ui.appendChild(el('div', { class: 'screen' }, [
      this.brand(),
      panel,
      el('div', { class: 'toolbar' }, [start, el('button', { class: 'ghost', text: 'Voltar', onclick: () => this.go('main') })]),
    ]));
  }

  private renderSettings(): void {
    const s = this.sliders;
    const panel = el('div', { class: 'panel' }, [
      el('h2', { text: 'Simulacao' }),
      selectRow('Modo', s.simulationMode ? 'sim' : 'arcade', [
        { value: 'sim', label: 'Simulacao (posses longas, estatistica realista)' },
        { value: 'arcade', label: 'Ritmo acelerado' },
      ], (v) => { s.simulationMode = v === 'sim'; }),
      selectRow('Modo imersao', s.immersionMode ? 'on' : 'off', [
        { value: 'off', label: 'Desligado' },
        { value: 'on', label: 'Ligado (HUD minimo, camera cinematografica)' },
      ], (v) => { s.immersionMode = v === 'on'; this.render.immersion = s.immersionMode; }),
      sliderRow('Velocidade de jogo', s.gameSpeed, 0.6, 1.4, 0.05, (v) => `${v.toFixed(2)}x`, (v) => { s.gameSpeed = v; }),
      sliderRow('Sucesso de arremesso (voce)', s.userShotSuccess, 0.5, 1.5, 0.05, (v) => v.toFixed(2), (v) => { s.userShotSuccess = v; }),
      sliderRow('Sucesso de arremesso (CPU)', s.cpuShotSuccess, 0.5, 1.5, 0.05, (v) => v.toFixed(2), (v) => { s.cpuShotSuccess = v; }),
      sliderRow('Frequencia de falta', s.foulFrequency, 0, 2, 0.05, (v) => v.toFixed(2), (v) => { s.foulFrequency = v; }),
      sliderRow('Frequencia de roubo', s.stealFrequency, 0, 2, 0.05, (v) => v.toFixed(2), (v) => { s.stealFrequency = v; }),
      sliderRow('Frequencia de toco', s.blockFrequency, 0, 2, 0.05, (v) => v.toFixed(2), (v) => { s.blockFrequency = v; }),
      sliderRow('Ritmo de fadiga', s.fatigueRate, 0.2, 2, 0.05, (v) => v.toFixed(2), (v) => { s.fatigueRate = v; }),
      sliderRow('Velocidade de passe', s.passSpeed, 0.6, 1.5, 0.05, (v) => v.toFixed(2), (v) => { s.passSpeed = v; }),
      sliderRow('Reacao da IA', s.aiReaction, 0.5, 1.6, 0.05, (v) => v.toFixed(2), (v) => { s.aiReaction = v; }),
      sliderRow('Contest (voce)', s.userContest, 0.4, 1.6, 0.05, (v) => v.toFixed(2), (v) => { s.userContest = v; }),
      sliderRow('Contest (CPU)', s.cpuContest, 0.4, 1.6, 0.05, (v) => v.toFixed(2), (v) => { s.cpuContest = v; }),
    ]);

    const audioPanel = el('div', { class: 'panel' }, [
      el('h2', { text: 'Audio e apresentacao' }),
      sliderRow('Volume geral', this.audio.volume, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => this.audio.setVolume(v)),
      selectRow('Qualidade de render', this.render.quality, [
        { value: 'high', label: 'Alta' },
        { value: 'medium', label: 'Media' },
        { value: 'low', label: 'Baixa (prioriza FPS)' },
      ], (v) => { this.render.quality = v as RenderOptions['quality']; }),
      selectRow('Nomes na quadra', this.render.showNames ? 'on' : 'off', [
        { value: 'on', label: 'Mostrar' }, { value: 'off', label: 'Ocultar' },
      ], (v) => { this.render.showNames = v === 'on'; }),
      selectRow('Arte de jogada', this.render.showPlayArt ? 'on' : 'off', [
        { value: 'on', label: 'Mostrar' }, { value: 'off', label: 'Ocultar' },
      ], (v) => { this.render.showPlayArt = v === 'on'; }),
      selectRow('Ferramentas de depuracao', this.render.showDebug ? 'on' : 'off', [
        { value: 'off', label: 'Desligado' },
        { value: 'on', label: 'Ligado (vetores de direcao e peso)' },
      ], (v) => { this.render.showDebug = v === 'on'; }),
    ]);

    const access = el('div', { class: 'panel' }, [
      el('h2', { text: 'Acessibilidade' }),
      selectRow('Daltonismo', this.accessibility.colorblind, [
        { value: 'none', label: 'Nenhum' },
        { value: 'protanopia', label: 'Protanopia' },
        { value: 'deuteranopia', label: 'Deuteranopia' },
        { value: 'tritanopia', label: 'Tritanopia' },
      ], (v) => { this.accessibility.colorblind = v as typeof this.accessibility.colorblind; }),
      sliderRow('Escala de texto', this.accessibility.textScale, 0.85, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => {
        this.accessibility.textScale = v;
        document.documentElement.style.fontSize = `${16 * v}px`;
      }),
      selectRow('Pistas visuais de arremesso', this.accessibility.shotCues ? 'on' : 'off', [
        { value: 'on', label: 'Ligadas' }, { value: 'off', label: 'Desligadas' },
      ], (v) => { this.accessibility.shotCues = v === 'on'; }),
      selectRow('Movimento reduzido', this.accessibility.reducedMotion ? 'on' : 'off', [
        { value: 'off', label: 'Desligado' }, { value: 'on', label: 'Ligado (menos tremor de camera)' },
      ], (v) => { this.accessibility.reducedMotion = v === 'on'; }),
      selectRow('Esquema de controle', this.input.scheme, [
        { value: 'beginner', label: 'Iniciante' },
        { value: 'advanced', label: 'Avancado' },
      ], (v) => { this.input.scheme = v as 'beginner' | 'advanced'; }),
    ]);

    this.ui.appendChild(el('div', { class: 'screen' }, [
      this.brand(),
      panel, audioPanel, access,
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'action', text: 'Salvar ajustes', onclick: () => { this.saveSettings(); this.flash('AJUSTES SALVOS'); } }),
        el('button', { class: 'ghost', text: 'Restaurar padroes', onclick: () => { this.sliders = { ...DEFAULT_SLIDERS }; this.go('settings'); } }),
        el('button', { class: 'ghost', text: 'Voltar', onclick: () => this.go('main') }),
      ]),
    ]));
  }

  private renderControls(): void {
    const panels: HTMLElement[] = [];
    if (this.isMobile) {
      panels.push(el('div', { class: 'panel' }, [
        el('h2', { text: 'Toque' }),
        el('p', { class: 'hint', text: 'A botoeira troca sozinha entre ataque e defesa. Nao ha botao de trocar de modo.' }),
        table(['Acao', 'Gesto'], TOUCH_HELP.map((c) => [c.action, c.gesture])),
      ]));
    }
    panels.push(el('div', { class: 'panel' }, [
      el('h2', { text: this.isMobile ? 'Teclado e controle (se conectar um)' : 'Controles' }),
      table(['Acao', 'Teclado', 'Controle'], CONTROL_HELP.map((c) => [c.action, c.keyboard, c.gamepad])),
    ]));
    this.ui.appendChild(el('div', { class: 'screen' }, [
      this.brand(),
      ...panels,
      el('div', { class: 'panel' }, [
        el('h2', { text: 'Como o arremesso funciona' }),
        el('p', { class: 'hint', html: 'O arremesso e de <b>ritmo</b>: segurar acumula o movimento, soltar libera a bola. A janela verde muda de tamanho conforme a marcacao, o equilibrio, a fadiga e a suavidade do proprio gesto. Soltar cedo deixa a bola curta; soltar tarde, longa. Nao existe "botao de acertar".' }),
      ]),
      el('div', { class: 'toolbar' }, [el('button', { class: 'ghost', text: 'Voltar', onclick: () => this.go('main') })]),
    ]));
  }

  private renderBoxScore(): void {
    const sim = this.sim;
    if (!sim) { this.go('main'); return; }
    const t0 = sim.box.teams[0];
    const t1 = sim.box.teams[1];
    const panels: HTMLElement[] = [];
    for (const team of [t0, t1]) {
      const players = [...sim.box.players.values()]
        .filter((p) => p.teamIdx === team.teamIdx && p.secondsPlayed > 1)
        .sort((a, b) => b.secondsPlayed - a.secondsPlayed);
      panels.push(el('div', { class: 'panel' }, [
        el('h2', { text: `${team.name} · ${team.points} pts` }),
        el('p', { class: 'hint', text: `FG ${team.fgm}-${team.fga} (${pct(team.fgm, team.fga)}%) · 3PT ${team.tpm}-${team.tpa} (${pct(team.tpm, team.tpa)}%) · LL ${team.ftm}-${team.fta} · REB ${team.oreb + team.dreb} · AST ${team.assists} · ERR ${team.turnovers} · Rating ${offensiveRating(team).toFixed(1)}` }),
        el('div', { class: 'scroll' }, [
          table(
            ['Jogador', 'MIN', 'PTS', 'FG', '3PT', 'LL', 'REB', 'AST', 'ROU', 'TOC', 'ERR', 'FAL', '+/-'],
            players.map((p) => [
              p.name, formatClock(p.secondsPlayed), p.points, `${p.fgm}-${p.fga}`, `${p.tpm}-${p.tpa}`,
              `${p.ftm}-${p.fta}`, p.oreb + p.dreb, p.assists, p.steals, p.blocks, p.turnovers, p.fouls,
              p.plusMinus > 0 ? `+${p.plusMinus}` : String(p.plusMinus),
            ]),
          ),
        ]),
      ]));
    }
    this.ui.appendChild(el('div', { class: 'screen' }, [
      el('div', { class: 'brand' }, [
        el('h1', { text: `${t0.points} — ${t1.points}` }),
        el('p', { text: `${t0.name} x ${t1.name}` }),
      ]),
      ...panels,
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'action', text: 'Voltar ao menu', onclick: () => { this.sim = null; this.go('main'); } }),
      ]),
    ]));
  }

  private renderGameOverlay(): void {
    const pause = el('div', { id: 'pause' }, [
      el('div', { class: 'panel' }, [
        el('h2', { text: 'Pausa' }),
        el('div', { class: 'toolbar' }, [
          el('button', { class: 'action', text: 'Continuar', onclick: () => this.togglePause(false) }),
          el('button', { class: 'ghost', text: 'Trocar camera', onclick: () => this.cycleCamera() }),
          el('button', { class: 'ghost', text: 'Sumula parcial', onclick: () => { this.togglePause(false); this.go('boxscore'); } }),
          el('button', { class: 'ghost', text: 'Abandonar', onclick: () => { this.sim = null; this.go('main'); } }),
        ]),
      ]),
    ]);
    this.ui.appendChild(pause);
    const flash = el('div', { class: 'flash', id: 'flash' });
    this.ui.appendChild(flash);
  }

  // ------------------------------------------------------------------ jogo

  startGame(home: Team, away: Team, opts: { userTeam?: 0 | 1; userPlayerId?: string; onEnd?: (sim: GameSim) => void } = {}): void {
    this.sim = new GameSim({
      home, away,
      tuning: DEFAULT_TUNING,
      sliders: this.sliders,
      seed: `${home.identity.id}-${away.identity.id}-${Date.now()}`,
      userTeam: opts.userTeam,
      userPlayerId: opts.userPlayerId,
    });
    this.onGameEnd = opts.onEnd ?? null;
    this.render.immersion = this.sliders.immersionMode;
    // A quadra e pintada com as cores do mandante uma vez por partida, nao a
    // cada quadro: e uma imagem de quase mil pixels de largura.
    this.gl3d?.setCourt(home.identity.colors.primary, home.identity.colors.accent);
    this.sim.start();
    this.paused = false;
    this.go('game');
    this.wireGameEvents();
    if (this.isMobile) {
      void this.enterImmersiveMode();
      this.touch.showHint('Analogico na esquerda · arraste ARR para baixo e solte para arremessar');
    }
  }

  private wireGameEvents(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.events.subscribe((e) => {
      const pan = e.pos && 'x' in e.pos ? clamp(((e.pos as { x: number }).x / COURT.length) * 2 - 1, -1, 1) : 0;
      switch (e.kind) {
        case 'shot_made':
          this.audio.swish(pan);
          this.audio.setCrowd(e.team === (sim.config.userTeam ?? 0) ? 'loud' : 'alert', 1);
          if ((e.drama ?? 0) > 0.55 && !this.accessibility.reducedMotion) addShake(this.camera, 0.2);
          break;
        case 'dunk':
          this.audio.setCrowd('explosive', 1.2);
          if (!this.accessibility.reducedMotion) addShake(this.camera, 0.45);
          this.flash('ENTERRADA');
          break;
        case 'block':
          this.audio.contact(0.7, pan);
          this.audio.setCrowd('explosive', 1);
          this.flash('TOCO');
          break;
        case 'steal':
          this.audio.setCrowd('loud', 0.9);
          break;
        case 'ankle_breaker':
          this.audio.setCrowd('explosive', 1.1);
          this.flash('DESEQUILIBRIO');
          break;
        case 'foul':
          this.audio.whistle();
          break;
        case 'shot_clock_violation':
        case 'backcourt':
          this.audio.whistle();
          break;
        case 'game_end':
          this.flash('FIM DE JOGO');
          window.setTimeout(() => {
            if (this.onGameEnd && this.sim) this.onGameEnd(this.sim);
            else this.go('boxscore');
          }, 1400);
          break;
        default:
          break;
      }
    });
  }

  /** Tela cheia e travar na horizontal, quando o navegador permitir. */
  private async enterImmersiveMode(): Promise<void> {
    try {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      }
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (orientation?.lock) await orientation.lock('landscape');
    } catch {
      // Safari no iOS nao permite nenhum dos dois. O aviso de girar a tela cobre o caso.
    }
  }

  flash(text: string): void {
    this.flashText = text;
    this.flashUntil = performance.now() + 1500;
  }

  togglePause(value?: boolean): void {
    this.paused = value ?? !this.paused;
    const pause = document.getElementById('pause');
    if (pause) pause.style.display = this.paused ? 'flex' : 'none';
  }

  cycleCamera(): void {
    const modes: CameraMode[] = ['broadcast', 'action', 'player_lock', 'street', 'cinematic'];
    const i = modes.indexOf(this.camera.mode);
    this.camera.mode = modes[(i + 1) % modes.length];
    this.flash(this.camera.mode.toUpperCase());
  }

  // ------------------------------------------------------------------ loop

  start(): void {
    this.go('main');
    this.last = performance.now();
    const frame = (now: number) => {
      const dtRaw = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dtRaw, now / 1000);
      this.draw(now / 1000);
      this.watchPerformance(dtRaw);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /**
   * Traduz o cursor em algo que o jogo entende: o ponto da quadra sob ele e,
   * se houver, o companheiro apontado. Sem isso o mouse seria decorativo.
   */
  private updatePointer(sim: GameSim): void {
    this.input.pointer = null;
    this.input.pointerTeammate = null;
    if (this.isMobile || !this.mouse || !this.lastProj) return;

    const ground = this.lastProj.unproject(this.mouse.x, this.mouse.y);
    if (!ground) return;
    this.input.pointer = { x: ground.x, y: ground.y };

    // Companheiro mais proximo do cursor EM TELA, nao no mundo: o que vale e
    // o que a pessoa ve sob o ponteiro.
    const user = sim.userActor();
    if (!user) return;
    let melhor = -1;
    // Raio em pixels de tela (CSS), que e a mesma unidade de clientX/clientY
    // e da projecao. Multiplicar por devicePixelRatio aqui dobrava o alcance
    // em tela retina e o cursor "pegava" companheiro do outro lado da quadra.
    let menor = 70;
    for (const a of sim.onCourtActors(user.team)) {
      if (a.id === user.id) continue;
      const p = this.lastProj.project(v3(a.pos.x, a.pos.y, 1));
      if (!p) continue;
      const d = Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y);
      if (d < menor) { menor = d; melhor = a.slot; }
    }
    if (melhor >= 0) this.input.pointerTeammate = melhor;
  }

  private update(dt: number, time: number): void {
    this.audio.update(dt);

    if (this.screen !== 'game' || !this.sim) {
      // Camera lenta em orbita no menu.
      this.idleCameraAngle += dt * 0.06;
      const r = 19;
      this.camera.pos = v3(
        COURT.length / 2 + Math.cos(this.idleCameraAngle) * r,
        COURT.width / 2 + Math.sin(this.idleCameraAngle) * r,
        9.5,
      );
      this.camera.target = v3(COURT.length / 2, COURT.width / 2, 1.4);
      return;
    }

    if (this.input.wasPressed('pause')) this.togglePause();
    if (this.input.wasPressed('camera')) this.cycleCamera();
    if (this.paused) {
      this.input.endFrame();
      return;
    }

    const sim = this.sim;
    // Input do usuario com o referencial da camera.
    const yaw = Math.atan2(sim ? 1 : 1, 1) * 0 + Math.PI / 2 * 0; // a camera broadcast olha do -Y para +Y
    this.updatePointer(sim);
    const cmd: UserCommand = this.touch.apply(this.input.poll(dt, 0), dt);
    sim.setUserCommand(cmd);
    // A botoeira segue o contexto: nao cabe ataque e defesa juntos na tela.
    if (sim.config.userTeam !== undefined) {
      this.touch.setMode(sim.possession.team === sim.config.userTeam ? 'offense' : 'defense');
    }

    const scaled = dt * this.sliders.gameSpeed * this.timeScale;
    sim.step(scaled);

    // Audio derivado dos eventos fisicos da bola.
    for (const e of sim.lastBallEvents) {
      const pan = clamp((e.pos.x / COURT.length) * 2 - 1, -1, 1);
      if (e.kind === 'floor_bounce') this.audio.bounce(clamp01(e.speed / 6), pan);
      else if (e.kind === 'rim_hit') this.audio.rim(clamp01(e.speed / 5), pan);
      else if (e.kind === 'backboard_hit') this.audio.backboard(clamp01(e.speed / 6), pan);
    }
    // Rangido do tenis vem do deslizamento real dos pes.
    for (const a of sim.actors) {
      if (!a.onCourt || a.feet.slip < 0.25) continue;
      if (Math.random() < a.feet.slip * 0.09) {
        this.audio.squeak(clamp01(a.feet.slip * 0.6), clamp((a.pos.x / COURT.length) * 2 - 1, -1, 1));
      }
    }

    // Torcida contextual.
    const lastDrama = sim.events.recent(1)[0]?.drama ?? 0;
    const crowd = crowdLevelFor({
      homeRun: 0,
      scoreDiff: sim.score(0) - sim.score(1),
      clock: sim.clock,
      period: sim.period,
      lastEventDrama: lastDrama,
    });
    this.audio.setCrowd(crowd.level, crowd.intensity);
    this.crowdEnergy = damp(this.crowdEnergy, crowd.intensity, 1.4, dt);

    // Camera segue a acao.
    const user = sim.userActor();
    const focus = {
      ball: v3(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z),
      action: v3(sim.ball.pos.x, sim.ball.pos.y, 1.2),
      attackingSide: sim.attackingSide(sim.possession.team),
      flow: 0,
      locked: user ? v3(user.pos.x, user.pos.y, 1.2) : undefined,
    };
    if (sim.phase === 'free_throw' && this.camera.mode !== 'free_throw') {
      this.camera.mode = 'free_throw';
    } else if (sim.phase !== 'free_throw' && this.camera.mode === 'free_throw') {
      this.camera.mode = 'broadcast';
    }
    updateCamera(this.camera, focus, dt, this.accessibility.reducedMotion ? 0.6 : 1, this.width / Math.max(1, this.height));

    // Shot meter do usuario.
    const handler = sim.ballHandler();
    if (user && handler === user && cmd.shootHeld) {
      this.hud.showMeter = true;
      this.hud.meterValue = cmd.shootStick;
      this.hud.meterIdeal = 0.78;
      this.hud.meterWindow = 0.16;
    } else {
      this.hud.showMeter = false;
    }

    this.input.endFrame();
    this.touch.endFrame();
  }

  /**
   * Cena em WebGL2. Monta a lista de instancias do quadro e manda desenhar.
   * O tom de pele sai do id do atleta, igual ao caminho 2D, para o mesmo
   * atleta ter sempre o mesmo tom nos dois renderizadores.
   */
  private drawScene3D(time: number): void {
    const gl = this.gl3d;
    if (!gl) return;
    const sim = this.sim;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const shift = framingFor(this.width / Math.max(1, this.height)).shift;

    if (!sim || this.screen !== 'game') {
      // Sem partida em curso: so a arena. A bola vai para fora de vista.
      const parada = createBall();
      parada.pos = v3(-99, -99, -99);
      gl.build([], parada, null, time, this.crowdEnergy);
      gl.render(this.camera, w, h, this.crowdEnergy, shift);
      return;
    }

    const infos = sim.actors.filter((a) => a.onCourt).map((a) => ({
      actor: a,
      colors: sim.teams[a.team].identity.colors,
      skin: skinToneFor(a.id).map((c) => Math.pow(c / 255, 2.2)) as [number, number, number],
    }));
    gl.build(infos, sim.ball, sim.ball.pos, time, this.crowdEnergy);
    gl.render(this.camera, w, h, this.crowdEnergy, shift);
  }

  /**
   * TROCA AUTOMATICA PARA O 2D.
   *
   * WebGL2 existir nao quer dizer que exista GPU. Navegador com aceleracao
   * desligada, maquina virtual ou driver na lista negra caem no rasterizador
   * por software, que roda a menos de 10 fps com sombra e publico. Um jogo a
   * 8 fps e pior que um jogo 2D a 60, entao aqui a gente mede e decide.
   *
   * A medida so comeca depois de alguns quadros: os primeiros incluem
   * compilacao de shader e upload de textura, que nao representam o regime.
   */
  private frameSamples = 0;
  private frameTimeSum = 0;

  private watchPerformance(dtSeconds: number): void {
    if (!this.gl3d || this.screen !== 'game') return;
    this.frameSamples++;
    // Os 30 primeiros quadros sao aquecimento.
    if (this.frameSamples <= 30) return;
    this.frameTimeSum += dtSeconds;
    const medidos = this.frameSamples - 30;
    if (medidos < 90) return;

    const medio = this.frameTimeSum / medidos;
    if (medio > 0.04) {
      this.fallbackTo2D(`o 3D rodou a ${(1 / medio).toFixed(0)} quadros por segundo`);
    }
    // Uma medida so por partida.
    this.frameSamples = -1e9;
  }

  /**
   * Um canvas tem UM tipo de contexto para sempre: pedir 2D depois de webgl2
   * devolve null. Entao a troca exige um elemento novo no lugar do antigo.
   */
  private fallbackTo2D(motivo: string): void {
    if (!this.gl3d) return;
    const novo = document.createElement('canvas');
    novo.id = 'stage';
    this.canvas.replaceWith(novo);
    this.canvas = novo;
    const ctx = novo.getContext('2d', { alpha: false });
    if (!ctx) return;
    this.ctx2d = ctx;
    this.gl3d = null;
    this.glError = motivo;
    this.resize();
    // O ticker do HUD ja e o canal de aviso durante a partida.
    this.hud.ticker.unshift(`Apresentacao simplificada: ${motivo}.`);
  }

  private draw(time: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const shift = framingFor(w / Math.max(1, h)).shift;
    const proj = buildProjection(this.camera, w, h, time, shift);
    this.lastProj = proj;
    const colors: [TeamColors, TeamColors] = this.sim
      ? [this.sim.teams[0].identity.colors, this.sim.teams[1].identity.colors]
      : [this.league.teams[0].identity.colors, this.league.teams[1].identity.colors];

    // O HUD e sempre 2D e vive na sua propria tela, entao ela e limpa a cada
    // quadro -- no caminho 3D a cena ja foi desenhada por baixo.
    ctx.clearRect(0, 0, w, h);

    if (this.gl3d) {
      this.drawScene3D(time);
    } else {
      const c2 = this.ctx2d!;
      drawHall(c2, w, h);
      drawStands(c2, proj, time, this.crowdEnergy, this.render.quality);
      drawRibbon(c2, proj, time, colors[0].primary, colors[1].primary);
      drawApron(c2, proj);
      drawCourt(c2, proj, this.render, colors[0]);
      drawHoops(c2, proj);
      if (this.sim && this.render.quality !== 'low') {
        drawJumbotron(
          c2, proj,
          [this.sim.score(0), this.sim.score(1)],
          [this.sim.teams[0].identity.abbreviation, this.sim.teams[1].identity.abbreviation],
          formatClock(this.sim.clock),
          `${this.sim.period}o`,
        );
      }
    }

    const sim = this.sim;
    if (!sim || this.screen !== 'game') return;

    // Arte de jogada.
    if (this.render.showPlayArt && !this.render.immersion && sim.possession.play) {
      const routes = sim.onCourtActors(sim.possession.team).slice(0, 5).map((a) => ({
        from: v2(a.pos.x, a.pos.y),
        to: v2(a.pos.x + a.vel.x * 0.7, a.pos.y + a.vel.y * 0.7),
        kind: a.state === 'screen' ? 'screen' : 'move',
      }));
      drawPlayArt(ctx, proj, routes);
    }

    const user = sim.userActor();
    const handler = sim.ballHandler();
    const infos: ActorRenderInfo[] = sim.actors
      .filter((a) => a.onCourt)
      .map((a) => ({
        actor: a,
        colors: sim.teams[a.team].identity.colors,
        isUser: user?.id === a.id,
        isBallHandler: handler?.id === a.id,
        label: `${a.profile.lastName}`,
      }));
    if (!this.gl3d) {
      // A bola vai junto: a mao de drible segue a bola de verdade, entao o
      // quique e o braco nunca divergem.
      drawActors(this.ctx2d!, proj, infos, this.render, sim.ball.pos, time);
      drawBall(this.ctx2d!, proj, sim.ball, time);
    } else {
      // Em 3D os corpos ja foram rasterizados; aqui so sai o que e
      // informacao: nome, anel do controlado, barra de energia, micro-reacoes.
      drawActorOverlays(ctx, proj, infos, this.render);
    }

    // Mira do mouse: onde o cursor toca a quadra e quem ele esta apontando.
    if (!this.isMobile && !this.render.immersion) {
      const alvo = this.input.pointerTeammate !== null
        ? sim.onCourtActors(sim.userActor()?.team ?? 0).find((a) => a.slot === this.input.pointerTeammate)
        : undefined;
      drawPointer(ctx, proj, this.input.pointer, alvo ? { x: alvo.pos.x, y: alvo.pos.y } : null, time);
    }


    // O HUD e desenhado em coordenadas logicas e escalado: em tela de celular
    // o mesmo scorebug ocuparia metade da largura.
    const uiScale = clamp(Math.min(w / 940, h / 560), 0.58, 1);
    const lw = w / uiScale;
    const lh = h / uiScale;
    ctx.save();
    ctx.scale(uiScale, uiScale);
    if (!this.render.immersion) {
      drawScorebug(ctx, sim, lw, colors);
      if (!this.isMobile) drawMatchupInfo(ctx, sim, lw);
      if (user) drawPlayerPanel(ctx, user, sim, 16, this.isMobile ? 78 : lh - 116);
      if (!this.isMobile) drawTicker(ctx, sim.events.all(), lw, lh);
    }
    drawShotMeter(ctx, this.hud, lw / 2, lh - (this.isMobile ? 34 : 58));
    drawShotFeedback(ctx, this.hud, lw, lh, time);
    ctx.restore();

    // Flash de apresentacao.
    const flash = document.getElementById('flash');
    if (flash) {
      const remaining = this.flashUntil - performance.now();
      flash.textContent = this.flashText;
      flash.style.opacity = remaining > 0 ? String(clamp01(remaining / 700)) : '0';
    }

    if (this.render.showDebug) {
      ctx.fillStyle = 'rgba(210,225,255,0.75)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      const lines = [
        `fase: ${sim.phase}  periodo: ${sim.period}  relogio: ${formatClock(sim.clock)}`,
        `posse: ${sim.teams[sim.possession.team].identity.abbreviation}  shot clock: ${sim.possession.shotClock.toFixed(1)}`,
        `jogada: ${sim.possession.play?.name ?? '-'}`,
        `bola: ${sim.ball.state} z=${sim.ball.pos.z.toFixed(2)}`,
      ];
      lines.forEach((l, i) => ctx.fillText(l, 16, 120 + i * 14));
    }
  }
}

/**
 * Boot com rede de seguranca: se qualquer coisa falhar aqui, a tela de
 * carregamento vira diagnostico em vez de deixar a pagina preta e muda.
 */
declare global {
  interface Window {
    courtside?: App;
    __courtsideBooted?: () => void;
    __courtsideStage?: (nome: string) => void;
    __courtsideVersao?: string;
  }
}

/** Marca na tela de carregamento por onde o boot ja passou. */
const stage = (nome: string): void => window.__courtsideStage?.(nome);

try {
  stage('montando o jogo');
  const app = new App();
  window.courtside = app;
  stage('abrindo o menu');
  app.start();
  // So remove a tela de carregamento depois do primeiro quadro desenhado: assim
  // ela cobre tambem uma falha que so apareceria no primeiro render.
  stage('desenhando o primeiro quadro');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.__courtsideBooted?.());
  });
  // Rede extra: em aba oculta o navegador congela o requestAnimationFrame e a
  // tela ficaria presa mesmo com o jogo inteiro de pe. Aqui o app ja existe e
  // qualquer falha do render ja teria sido reportada, entao liberar e correto.
  setTimeout(() => window.__courtsideBooted?.(), 4000);
} catch (err) {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const box = document.getElementById('boot');
  const msg = document.getElementById('boot-msg');
  const pre = document.getElementById('boot-err');
  box?.classList.add('error');
  if (msg) msg.textContent = 'O jogo nao conseguiu iniciar neste navegador.';
  if (pre) {
    pre.hidden = false;
    pre.textContent = detail.slice(0, 700);
  }
}
