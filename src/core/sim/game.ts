/**
 * MOTOR DE PARTIDA.
 *
 * Um loop de tempo fixo (120 Hz) que integra fisica, contato, bola e acoes,
 * com um tique de decisao mais lento (12 Hz) para a IA - exatamente como um
 * jogo real faz: o corpo e continuo, a cabeca decide em intervalos.
 *
 * Estados de jogo: aquecimento -> bola ao alto -> ao vivo -> bola morta ->
 * reposicao -> lance livre -> fim de periodo -> final.
 *
 * Nenhum jogador e teleportado durante a bola viva. Reposicionamentos so
 * acontecem em bola morta, e mesmo assim andando ate a posicao.
 */
import { Vec2, Vec3, add2, dist2, dot2, fromAngle, len2, mul2, norm2, sub2, toAngle, v2, v3, angleDiff } from '../math/vec.js';
import { clamp, clamp01, lerp } from '../math/util.js';
import { Rng } from '../math/rng.js';
import { Tuning } from '../config/tuning.js';
import { AiProfile, AssistProfile, Sliders, aiProfile, applySliders, assistProfile, shotSuccessMultiplier } from '../config/sliders.js';
import { COURT, Side, clampToCourt, distToHoop, freeThrowSpot, hoopGround, hoopPos, isInPaint, isOutOfBounds, shotValue, shotZone } from '../config/court.js';
import { Gameplan, Team, findPlayer, startersOf } from '../model/team.js';
import { PlayerProfile, fullName, shortName } from '../model/player.js';
import { Actor, addCue, badges, clearAction, createActor, decayMoves, startAction } from './actor.js';
import { refreshEffective } from './effective.js';
import { LocomotionIntent, applyImpulse, idleIntent, jump, stepLocomotion } from './locomotion.js';
import { ContactEvent, applyBoxout, applyCutoff, releaseScreen, resolveContacts, setScreen } from './contact.js';
import { Ball, BallEvent, ShotContext, attachBall, ballGround, createBall, handHeight, predictCatchPoint, releaseBall, solveLaunchVelocity, stepBall } from './ball.js';
import { RhythmMeter, ShotAttempt, ShotTiming, buildAttempt, buildRelease, computeContest, evaluateTiming, greenWindow, inferShotType, releaseTime, shotProbability, updateHeat, decayHeat, assistBonusFrom } from './shooting.js';
import { DunkMeterState, canDunk, dunkProbability, layupProbability, releaseDunkMeter, rollAndOne, selectFinish, startDunkMeter, updateDunkMeter } from './finishing.js';
import { catchCheck, passVelocity, planPass, rankPassTargets } from './passing.js';
import { attemptBlock, attemptSteal, chooseStance, onBallPressure } from './defense.js';
import { contestRebound, predictRebound } from './rebounding.js';
import { stepFatigue, restDuringDeadBall, restOnBench } from './fatigue.js';
import { applyTakeoverEvent, specialtyFor, stepTakeover } from './takeover.js';
import { judgeContact, freeThrowsFor, isFoulOut } from './fouls.js';
import { ballSecurityRisk } from './dribble.js';
import { startDribbleMove, dribbleIntent, resolveBreakPoint, MOVE_BY_ID } from './dribble.js';
import { BoxScore, ShotChartEntry, emptyPlayerStats, emptyTeamStats, estimatePossessions, offensiveRating, recordShot } from '../stats/boxscore.js';
import { EventLog, GameEvent } from './events.js';
import { CourtView, buildCourtView } from '../ai/perception.js';
import { OffenseContext, OffensiveDecision, decideOffBall, decideOnBall, transitionAssignment } from '../ai/offense.js';
import { DefensiveDecision, assignMatchups, decideDefense } from '../ai/defense-ai.js';
import { Play } from '../ai/playbook.js';
import { GameSnapshot, RotationState, buildRotationTargets, callPlay, fullCoachDecision, pickHuntTarget } from '../ai/coach.js';
import { standingReach } from '../model/attributes.js';

export type GamePhase = 'warmup' | 'tipoff' | 'live' | 'dead' | 'free_throw' | 'period_break' | 'final';

export interface UserCommand {
  move: Vec2;
  sprint: boolean;
  /** Valor 0..1 do stick de arremesso (rhythm shooting). */
  shootStick: number;
  shootHeld: boolean;
  shootReleased: boolean;
  passRequested: boolean;
  passTargetSlot?: number;
  lobRequested: boolean;
  driveRequested: boolean;
  moveRequest?: { id: string; side: -1 | 1 };
  stealRequested: boolean;
  blockRequested: boolean;
  postUp: boolean;
  callScreen: boolean;
  switchPlayer: boolean;
  timeout: boolean;
  intentionalFoul: boolean;
}

export function emptyCommand(): UserCommand {
  return {
    move: v2(), sprint: false, shootStick: 0, shootHeld: false, shootReleased: false,
    passRequested: false, lobRequested: false, driveRequested: false,
    stealRequested: false, blockRequested: false, postUp: false, callScreen: false,
    switchPlayer: false, timeout: false, intentionalFoul: false,
  };
}

export interface GameConfig {
  home: Team;
  away: Team;
  tuning: Tuning;
  sliders: Sliders;
  seed: string | number;
  /** Time controlado pelo humano (undefined = CPU x CPU). */
  userTeam?: 0 | 1;
  /** Player lock: id do atleta controlado. Sem isso, controla quem tem a bola. */
  userPlayerId?: string;
}

interface PossessionState {
  team: 0 | 1;
  shotClock: number;
  startedAt: number;
  startedBy: 'tipoff' | 'inbound' | 'rebound' | 'steal' | 'made' | 'turnover';
  /** Quem tocou por ultimo antes do arremesso (candidato a assistencia). */
  lastPasserId?: string;
  lastPassAt: number;
  lastPassQuality: number;
  /** Jogada chamada. */
  play?: Play;
  playStartedAt: number;
  playWing: -1 | 1;
  roleOrder: string[];
  isFastBreak: boolean;
  secondChance: boolean;
  offTurnover: boolean;
}

export class GameSim {
  readonly config: GameConfig;
  readonly t: Tuning;
  readonly rng: Rng;
  readonly events = new EventLog();
  readonly box: BoxScore;
  readonly ball: Ball = createBall();
  readonly actors: Actor[] = [];
  readonly teams: [Team, Team];
  private readonly aiProfileCfg: AiProfile;
  private readonly assist: AssistProfile;

  phase: GamePhase = 'warmup';
  period = 1;
  clock: number;
  possession: PossessionState;
  /** Tempo acumulado de bola morta a consumir antes de reativar. */
  private deadTimer = 0;
  private deadReason = '';
  private inboundTeam: 0 | 1 = 0;
  private inboundPos: Vec2 = v2();
  private freeThrows: { shooterId: string; remaining: number; andOne: boolean } | null = null;
  private decisionAccumulator = 0;
  private readonly decisionInterval = 1 / 12;
  private views: [CourtView | null, CourtView | null] = [null, null];
  private decisions = new Map<string, OffensiveDecision | DefensiveDecision>();
  private rotationStates: [RotationState, RotationState];
  /**
   * Copia do gameplan de cada equipe para esta partida. O tecnico ajusta o
   * plano durante o jogo; se ele escrevesse direto no objeto da liga, a
   * proxima partida comecaria com o estado da anterior - e duas simulacoes
   * com a mesma seed dariam resultados diferentes.
   */
  private gameplans: [Gameplan, Gameplan];
  private lastScore: [number, number] = [0, 0];
  private runTracker: { team: 0 | 1; points: number } = { team: 0, points: 0 };
  private periodPoints: [number, number] = [0, 0];
  private shooterMeters = new Map<string, RhythmMeter>();
  private dunkMeters = new Map<string, DunkMeterState>();
  private boxoutQuality = new Map<string, number>();
  private userCommand: UserCommand = emptyCommand();
  private userActorId?: string;
  private reboundPending = false;
  private reboundSpot: Vec2 = v2();
  private reboundHeight = 1.2;
  private simTime = 0;
  private lastContactByActor = new Map<string, number>();
  private lastCoachTick = -99;
  /** Eventos fisicos da bola no ultimo passo (audio, camera, replay). */
  lastBallEvents: BallEvent[] = [];
  private interceptTried = new Set<string>();

  constructor(config: GameConfig) {
    this.config = config;
    this.t = applySliders(config.tuning, config.sliders);
    this.rng = new Rng(config.seed);
    this.teams = [config.home, config.away];
    this.clock = this.t.game.periodSeconds;

    this.box = {
      players: new Map(),
      teams: [
        emptyTeamStats(0, `${config.home.identity.city} ${config.home.identity.name}`, this.t.game.timeoutsPerTeam),
        emptyTeamStats(1, `${config.away.identity.city} ${config.away.identity.name}`, this.t.game.timeoutsPerTeam),
      ],
      shotChart: [],
    };

    this.gameplans = [
      JSON.parse(JSON.stringify(config.home.gameplan)) as Gameplan,
      JSON.parse(JSON.stringify(config.away.gameplan)) as Gameplan,
    ];
    this.aiProfileCfg = aiProfile(config.sliders);
    this.assist = assistProfile(config.sliders);

    for (const teamIdx of [0, 1] as (0 | 1)[]) {
      const team = this.teams[teamIdx];
      const starters = startersOf(team);
      const starterIds = new Set(starters.map((p) => p.id));
      const bench = team.roster.filter((p) => !starterIds.has(p.id));
      const ordered = [...starters, ...bench];
      ordered.forEach((profile, slot) => {
        const actor = createActor(profile, teamIdx, slot, this.formationSpot(teamIdx, slot), this.t);
        actor.onCourt = slot < 5;
        this.actors.push(actor);
        this.box.players.set(profile.id, emptyPlayerStats(profile.id, fullName(profile), teamIdx));
      });
    }

    for (const a of this.actors) this.actorIndex.set(a.id, a);

    this.rotationStates = [
      { minutes: new Map(), targets: buildRotationTargets(config.home), lastSubClock: this.clock },
      { minutes: new Map(), targets: buildRotationTargets(config.away), lastSubClock: this.clock },
    ];

    this.possession = {
      team: 0, shotClock: this.t.game.shotClock, startedAt: 0, startedBy: 'tipoff',
      lastPassAt: -99, lastPassQuality: 0, playStartedAt: 0, playWing: 1,
      roleOrder: [], isFastBreak: false, secondChance: false, offTurnover: false,
    };

    if (config.userTeam !== undefined) {
      const lock = config.userPlayerId ? this.actors.find((a) => a.id === config.userPlayerId) : undefined;
      if (lock) {
        lock.userControlled = true;
        this.userActorId = lock.id;
      }
    }
  }

  // ------------------------------------------------------------------ setup

  /** Cesta que o time `teamIdx` ataca. */
  attackingSide(teamIdx: 0 | 1): Side {
    // Time 0 ataca a cesta do lado 1 no primeiro tempo.
    const flip = this.period > 2 ? 1 : 0;
    return (((teamIdx + flip) % 2) === 0 ? 1 : 0) as Side;
  }

  defendingSide(teamIdx: 0 | 1): Side {
    return (this.attackingSide(teamIdx) === 0 ? 1 : 0) as Side;
  }

  private formationSpot(teamIdx: 0 | 1, slot: number): Vec2 {
    const defSide = teamIdx === 0 ? 0 : 1;
    const hoop = hoopGround(defSide);
    const dir = defSide === 0 ? 1 : -1;
    const lateral = [-4.5, -2.2, 0, 2.2, 4.5][slot % 5];
    return clampToCourt(v2(hoop.x + dir * (4 + (slot % 5) * 0.8), COURT.width / 2 + lateral), 0.8);
  }

  onCourtActors(teamIdx: 0 | 1): Actor[] {
    return this.actors.filter((a) => a.team === teamIdx && a.onCourt);
  }

  benchActors(teamIdx: 0 | 1): Actor[] {
    return this.actors.filter((a) => a.team === teamIdx && !a.onCourt);
  }

  private actorIndex = new Map<string, Actor>();

  actorById(id: string): Actor | undefined {
    return this.actorIndex.get(id);
  }

  ballHandler(): Actor | undefined {
    return this.ball.ownerId ? this.actorById(this.ball.ownerId) : undefined;
  }

  /** Gameplan efetivo desta partida (inclui ajustes do tecnico). */
  gameplanOf(teamIdx: 0 | 1): Gameplan {
    return this.gameplans[teamIdx];
  }

  score(teamIdx: 0 | 1): number {
    return this.box.teams[teamIdx].points;
  }

  setUserCommand(cmd: UserCommand): void {
    this.userCommand = cmd;
  }

  /** Ator controlado pelo humano neste instante. */
  userActor(): Actor | undefined {
    if (this.config.userTeam === undefined) return undefined;
    if (this.userActorId) return this.actorById(this.userActorId);
    const handler = this.ballHandler();
    if (handler && handler.team === this.config.userTeam) return handler;
    // Sem a bola: controla quem marca o portador.
    const opp = this.ballHandler();
    if (opp) {
      const marker = this.onCourtActors(this.config.userTeam).find((a) => a.assignmentId === opp.id);
      if (marker) return marker;
    }
    return this.onCourtActors(this.config.userTeam)[0];
  }

  start(): void {
    this.phase = 'tipoff';
    this.events.push({ kind: 'tipoff', period: this.period, clock: this.clock, text: 'Bola ao alto' });
    this.resolveTipoff();
  }

  private resolveTipoff(): void {
    const centers = [0, 1].map((i) => {
      const list = this.onCourtActors(i as 0 | 1);
      return list.reduce((best, a) => (a.profile.physique.height > best.profile.physique.height ? a : best), list[0]);
    });
    const a = centers[0];
    const b = centers[1];
    const scoreA = a.profile.physique.height * 45 + a.effective.vertical * 0.5 + a.effective.hustle * 0.2;
    const scoreB = b.profile.physique.height * 45 + b.effective.vertical * 0.5 + b.effective.hustle * 0.2;
    const winner = this.rng.chance(scoreA / (scoreA + scoreB)) ? 0 : 1;
    this.beginPossession(winner as 0 | 1, 'tipoff');
    const guard = this.onCourtActors(winner as 0 | 1).reduce((best, x) => (x.effective.ballHandle > best.effective.ballHandle ? x : best));
    this.giveBall(guard);
    this.phase = 'live';
  }

  // ------------------------------------------------------------------- loop

  /** Avanca a simulacao por `dt` segundos reais. */
  step(dt: number): void {
    if (this.phase === 'final') return;
    const step = this.t.sim.dt;
    let remaining = Math.min(dt, step * this.t.sim.maxSubstepsPerFrame);
    while (remaining > 1e-6) {
      const h = Math.min(step, remaining);
      this.substep(h);
      remaining -= h;
    }
  }

  private substep(dt: number): void {
    this.simTime += dt;

    // 1) Relogios.
    this.advanceClocks(dt);

    // 2) Decisoes + atributos efetivos (tique lento: o corpo e continuo,
    //    a cabeca e a fisiologia sao reavaliadas 12 vezes por segundo).
    this.decisionAccumulator += dt;
    if (this.decisionAccumulator >= this.decisionInterval) {
      const slow = this.decisionAccumulator;
      this.decisionAccumulator = 0;
      for (const a of this.actors) {
        if (!a.onCourt) continue;
        refreshEffective(a, this.t);
        decayMoves(a, slow, this.t);
        decayHeat(a, slow);
        stepTakeover(a, slow, this.t);
      }
      if (this.phase === 'live') this.think();
    }

    // 4) Aplicar intencoes + fisica.
    this.applyIntents(dt);

    // 5) Contato.
    const contacts = resolveContacts(this.actors, dt, this.t, !this.ball.ownerId && this.ball.state !== 'dead' && !this.ball.shotContext);
    this.processContacts(contacts, dt);

    // 6) Bola.
    const ballEvents = stepBall(this.ball, dt, this.t);
    // Exposto para o cliente reagir com audio e camera sem reprocessar fisica.
    this.lastBallEvents = ballEvents;
    this.processBallEvents(ballEvents);
    this.updateHeldBall(dt);

    // 7) Acoes em andamento.
    this.progressActions(dt);

    // 8) Fadiga.
    for (const a of this.actors) {
      const contact = this.lastContactByActor.get(a.id) ?? 0;
      stepFatigue(a, {
        sprinting: a.state === 'sprint',
        defending: a.team !== this.possession.team,
        contact,
        onCourt: a.onCourt,
      }, dt, this.t);
      this.lastContactByActor.set(a.id, Math.max(0, contact - dt * 3));
      if (a.onCourt) {
        const ps = this.box.players.get(a.id);
        // Minutos so correm com o relogio: bola morta e intervalo nao contam,
        // senao a sumula mostra 59 minutos em um jogo de 48.
        if (ps && this.phase === 'live') {
          ps.secondsPlayed += dt;
          const sp = len2(a.vel);
          ps.distanceRun += sp * dt;
          ps.maxSpeed = Math.max(ps.maxSpeed, sp);
        }
        if (this.phase === 'live') {
          const rot = this.rotationStates[a.team];
          rot.minutes.set(a.id, (rot.minutes.get(a.id) ?? 0) + dt);
        }
      }
    }

    // 9) Rebote pendente.
    if (this.reboundPending) this.checkRebound();

    // 10) Bola solta recuperavel.
    if (this.phase === 'live' && !this.ball.ownerId) this.checkLooseBallPickup();
  }

  private advanceClocks(dt: number): void {
    if (this.phase === 'live') {
      this.clock -= dt;
      this.possession.shotClock -= dt;
      if (this.possession.shotClock <= 0 && !this.ball.shotContext) {
        this.violation('shot_clock');
        return;
      }
      if (this.clock <= 0) {
        this.clock = 0;
        this.endPeriod();
      }
    } else if (this.phase === 'dead' || this.phase === 'free_throw') {
      this.deadTimer -= dt;
      for (const a of this.actors) {
        if (a.onCourt) restDuringDeadBall(a, dt, this.t);
        else restOnBench(a, dt, this.t);
      }
      if (this.deadTimer <= 0) {
        if (this.phase === 'free_throw') this.shootFreeThrow();
        else this.resumeFromInbound();
      }
    } else if (this.phase === 'period_break') {
      this.deadTimer -= dt;
      for (const a of this.actors) restOnBench(a, dt * 0.6, this.t);
      if (this.deadTimer <= 0) this.startPeriod();
    }
  }

  // --------------------------------------------------------------- decisoes

  private think(): void {
    const off = this.possession.team;
    const def = (1 - off) as 0 | 1;
    const offense = this.onCourtActors(off);
    const defense = this.onCourtActors(def);
    const handler = this.ballHandler();

    // Marcacoes (recalculadas quando alguem esta sem marcador).
    if (defense.some((d) => !d.assignmentId || !offense.find((o) => o.id === d.assignmentId))) {
      assignMatchups(defense, offense, this.gameplans[def]);
    }

    const view = buildCourtView(offense, defense, handler, this.attackingSide(off), this.t);
    this.views[off] = view;

    // Chamada de jogada.
    if (!this.possession.play && this.phase === 'live') {
      const snapshot = this.snapshot(off);
      const mismatch = view.mismatches[0]?.kind;
      this.possession.play = callPlay(this.teams[off], offense, snapshot, this.possession.isFastBreak, mismatch, this.rng);
      this.possession.playStartedAt = this.simTime;
      this.possession.playWing = this.rng.sign() as -1 | 1;
      this.possession.roleOrder = this.assignRoles(offense, this.possession.play);
      this.events.push({
        kind: 'play_call', period: this.period, clock: this.clock, team: off,
        text: this.possession.play.name, data: { description: this.possession.play.description },
      });
    }

    const possessionAge = this.simTime - this.possession.startedAt;
    const teamFga = this.box.teams[off].fga;
    const playPhase = this.possession.play
      ? clamp01((this.simTime - this.possession.playStartedAt) / this.possession.play.duration)
      : 0;

    // Bola solta: os dez vao atras dela. Antes so a defesa reagia, o que
    // entregava dezenas de bolas para fora e turnovers artificiais.
    const loose = !this.ball.ownerId && this.phase === 'live' && !this.ball.shotContext && this.ball.state !== 'pass';
    if (loose) {
      const spot = ballGround(this.ball);
      for (const a of [...offense, ...defense]) {
        if (a.userControlled) continue;
        const d = dist2(a.pos, spot);
        if (d > 9) continue;
        const dir = sub2(spot, a.pos);
        this.decisions.set(a.id, {
          kind: 'move',
          intent: {
            move: len2(dir) > 0.2 ? norm2(dir) : v2(),
            sprint: true,
            facing: toAngle(dir),
            stance: 'normal',
            brake: len2(dir) <= 0.2,
          },
          reason: 'perseguindo bola solta',
          value: 1,
        });
      }
    }

    // Ofensivos.
    const incomingPass = this.ball.state === 'pass' ? this.ball.passTargetId : undefined;
    for (const a of offense) {
      if (a.userControlled || loose) continue;
      // Quem esta recebendo vai ATE a bola. Um receptor parado transforma
      // qualquer passe levemente impreciso em bola solta.
      if (incomingPass === a.id) {
        const meet = predictCatchPoint(this.ball, 1.2, this.t.ball.catchHeightMax, this.t.sim.gravity, this.t.ball.drag);
        const toBall = sub2(meet.pos, a.pos);
        this.decisions.set(a.id, {
          kind: 'move',
          intent: {
            move: len2(toBall) > 0.25 ? norm2(toBall) : v2(),
            sprint: len2(toBall) > 2.5,
            facing: toAngle(sub2(this.ball.pos.x !== undefined ? v2(this.ball.pos.x, this.ball.pos.y) : meet.pos, a.pos)),
            stance: 'normal',
            brake: len2(toBall) <= 0.25,
          },
          reason: 'indo ao encontro do passe',
          value: 0.9,
        });
        continue;
      }
      const role = Math.max(0, this.possession.roleOrder.indexOf(a.id));
      const ctx: OffenseContext = {
        view,
        gameplan: this.gameplans[off],
        t: this.t,
        profile: this.aiProfileCfg,
        rng: this.rng,
        shotClock: this.possession.shotClock,
        gameClock: this.clock,
        scoreDiff: this.score(off) - this.score(def),
        play: this.possession.play,
        playPhase,
        playWing: this.possession.playWing,
        role,
        timeWithBall: a.ballTime,
        transition: this.possession.isFastBreak,
        possessionAge,
        usageShare: teamFga > 0 ? (this.box.players.get(a.id)?.fga ?? 0) / teamFga : 0.2,
      };
      const decision = this.possession.isFastBreak && !a.hasBall && this.simTime - this.possession.startedAt < 2.5
        ? transitionAssignment(a, ctx, role)
        : a.hasBall ? decideOnBall(a, ctx) : decideOffBall(a, ctx);
      this.decisions.set(a.id, decision);
      this.executeOffensiveDecision(a, decision, view);
    }

    // Defensivos.
    for (const d of defense) {
      if (d.userControlled || loose) continue;
      const decision = decideDefense(d, view, this.gameplans[def], this.t, this.aiProfileCfg, {
        shotInFlight: !!this.ball.shotContext && !this.ball.shotContext.resolved,
        loosePos: !this.ball.ownerId && this.phase === 'live' && !this.ball.shotContext ? ballGround(this.ball) : undefined,
        timeLeft: this.clock,
        scoreDiff: this.score(def) - this.score(off),
      });
      this.decisions.set(d.id, decision);
      this.executeDefensiveDecision(d, decision, view);
    }

    // Tecnico: uma vez a cada 15 s de jogo (nao a cada frame dentro do segundo).
    if (this.simTime - this.lastCoachTick >= 15) {
      this.lastCoachTick = this.simTime;
      this.coachTick(off);
    }
  }

  private assignRoles(offense: Actor[], play: Play): string[] {
    const handler = this.ballHandler();
    const pool = [...offense];
    const order: string[] = [];
    if (handler) {
      order.push(handler.id);
      pool.splice(pool.indexOf(handler), 1);
    }
    const wants = play.wants.slice(order.length);
    for (const want of wants) {
      let pick: Actor | undefined;
      if (want === 'big') pick = pool.sort((a, b) => b.profile.physique.height - a.profile.physique.height)[0];
      else if (want === 'shooter') pick = pool.sort((a, b) => b.effective.threePoint - a.effective.threePoint)[0];
      else if (want === 'handler') pick = pool.sort((a, b) => b.effective.ballHandle - a.effective.ballHandle)[0];
      else if (want === 'wing') pick = pool.sort((a, b) => (b.effective.perimeterDefense + b.effective.drivingLayup) - (a.effective.perimeterDefense + a.effective.drivingLayup))[0];
      else pick = pool[0];
      if (pick) {
        order.push(pick.id);
        pool.splice(pool.indexOf(pick), 1);
      }
    }
    for (const rest of pool) order.push(rest.id);
    return order;
  }

  private snapshot(teamIdx: 0 | 1): GameSnapshot {
    const me = this.box.teams[teamIdx];
    const opp = this.box.teams[(1 - teamIdx) as 0 | 1];
    return {
      period: this.period,
      clock: this.clock,
      scoreFor: me.points,
      scoreAgainst: opp.points,
      opponentPaintPoints: opp.paintPoints,
      opponentThreePoints: opp.tpm * 3,
      opponentTransitionPoints: opp.fastBreakPoints,
      ownTurnovers: me.turnovers,
      ownOffensiveRating: offensiveRating(me),
      opponentOffensiveRating: offensiveRating(opp),
      teamFouls: me.teamFoulsThisPeriod,
      timeoutsLeft: me.timeoutsLeft,
      opponentRun: this.runTracker.team !== teamIdx ? this.runTracker.points : 0,
    };
  }

  private coachTick(offTeam: 0 | 1): void {
    if (this.simTime - this.lastCoachTick < 12 && this.lastCoachTick > 0) {
      // Substituicoes ainda sao avaliadas na bola morta, mas sem reanalisar
      // o gameplan inteiro a cada reposicao.
      for (const teamIdx of [0, 1] as (0 | 1)[]) {
        const subs = fullCoachDecision(
          this.teams[teamIdx], this.onCourtActors(teamIdx), this.benchActors(teamIdx),
          this.rotationStates[teamIdx], this.snapshot(teamIdx), this.aiProfileCfg, this.t,
        ).substitutions;
        if (subs.length) {
          for (const sub of subs) this.substitute(teamIdx, sub.out, sub.in);
          this.rotationStates[teamIdx].lastSubClock = this.clock;
        }
      }
      return;
    }
    this.lastCoachTick = this.simTime;
    for (const teamIdx of [0, 1] as (0 | 1)[]) {
      const team = this.teams[teamIdx];
      const snapshot = this.snapshot(teamIdx);
      const planned: Team = { ...team, gameplan: this.gameplans[teamIdx] };
      const decision = fullCoachDecision(
        planned, this.onCourtActors(teamIdx), this.benchActors(teamIdx),
        this.rotationStates[teamIdx], snapshot, this.aiProfileCfg, this.t,
      );
      if (Object.keys(decision.gameplanChanges).length) {
        Object.assign(this.gameplans[teamIdx], decision.gameplanChanges);
        for (const note of decision.notes) {
          this.events.push({ kind: 'gameplan_change', period: this.period, clock: this.clock, team: teamIdx, text: note });
        }
      }
      if (decision.substitutions.length && (this.phase === 'dead' || this.phase === 'free_throw' || this.phase === 'period_break')) {
        for (const sub of decision.substitutions) this.substitute(teamIdx, sub.out, sub.in);
        this.rotationStates[teamIdx].lastSubClock = this.clock;
      }
      // Matchup hunting.
      if (!this.gameplans[teamIdx].huntTargetId || this.rng.chance(0.15)) {
        this.gameplans[teamIdx].huntTargetId = pickHuntTarget(this.onCourtActors((1 - teamIdx) as 0 | 1));
      }
    }
  }

  private substitute(teamIdx: 0 | 1, outId: string, inId: string): void {
    const out = this.actorById(outId);
    const inn = this.actorById(inId);
    if (!out || !inn || out.hasBall) return;
    out.onCourt = false;
    inn.onCourt = true;
    inn.pos = v2(out.pos.x, out.pos.y);
    inn.vel = v2();
    inn.balance = 1;
    inn.assignmentId = out.assignmentId;
    out.assignmentId = undefined;
    this.events.push({
      kind: 'substitution', period: this.period, clock: this.clock, team: teamIdx,
      playerId: inId, secondaryId: outId,
      text: `${shortName(inn.profile)} entra no lugar de ${shortName(out.profile)}`,
    });
  }

  // --------------------------------------------------------- execucao acoes

  private executeOffensiveDecision(a: Actor, decision: OffensiveDecision, view: CourtView): void {
    if (a.action.kind !== 'none' && a.action.committed) return;
    switch (decision.kind) {
      case 'shoot':
        if (a.hasBall) this.beginShot(a, view);
        break;
      case 'pass':
        if (a.hasBall && decision.passTargetId) {
          const target = this.actorById(decision.passTargetId);
          if (target) this.beginPass(a, target, false);
        }
        break;
      case 'dribble_move':
        if (a.hasBall && decision.moveId && decision.moveSide) {
          const hoop = hoopGround(view.attackingSide);
          startDribbleMove(a, decision.moveId, decision.moveSide, norm2(sub2(hoop, a.pos)), this.t, this.rng);
        }
        break;
      case 'screen':
        setScreen(a, this.decisionInterval);
        break;
      case 'post_up':
        a.state = 'posture_post';
        break;
      default:
        if (a.state === 'screen') releaseScreen(a);
        break;
    }
  }

  private executeDefensiveDecision(d: Actor, decision: DefensiveDecision, view: CourtView): void {
    if (d.action.kind !== 'none' && d.action.committed) return;
    const handler = view.ballHandler;
    const stealReady = (this.stealCooldown.get(d.id) ?? -99) + 4 < this.simTime;
    if (decision.attemptSteal && handler && stealReady && dist2(d.pos, handler.pos) < 1.8) {
      this.stealCooldown.set(d.id, this.simTime);
      const exposure = handler.action.kind === 'dribble_move'
        ? (MOVE_BY_ID.get(String(handler.action.data.moveId))?.exposure ?? 0.3)
        : 0.22;
      const stance = chooseStance(d, handler, view.attackingSide, this.t, this.gameplans[d.team].foulTolerance);
      const result = attemptSteal(d, handler, exposure, this.t, this.rng, stance.posture);
      startAction(d, 'steal_attempt', 0.35, 0.05, {}, true);
      if (result.success) this.resolveSteal(d, handler);
      else if (result.foul) this.callFoul(d, handler, 'reach_in', false, 2);
    }
    if (decision.boxout && decision.boxoutTargetId) {
      const target = this.actorById(decision.boxoutTargetId);
      if (target) {
        const q = applyBoxout(d, target, hoopGround(this.attackingSide(target.team)), this.decisionInterval, this.t);
        this.boxoutQuality.set(d.id, q);
      }
    }
  }

  /**
   * Integracao simultanea: primeiro TODAS as intencoes sao calculadas sobre o
   * mesmo instante, depois todos os corpos avancam. Integrar ator por ator na
   * ordem da lista dava vantagem sistematica a um dos times (o segundo reagia
   * a posicoes ja atualizadas do primeiro) - o teste de espelho mostrou isso
   * como diferenca de rebotes, faltas e posses entre elencos identicos.
   */
  private intentBuffer = new Map<string, LocomotionIntent>();

  private applyIntents(dt: number): void {
    const user = this.userActor();
    this.intentBuffer.clear();

    for (const a of this.actors) {
      if (!a.onCourt) continue;
      let intent: LocomotionIntent;

      if (a === user && this.phase === 'live') {
        intent = this.userIntent(a);
      } else if (a.action.kind === 'dribble_move') {
        intent = dribbleIntent(a, this.t) ?? idleIntent();
      } else if (this.phase === 'dead' || this.phase === 'free_throw' || this.phase === 'period_break') {
        intent = this.deadBallIntent(a);
      } else {
        const decision = this.decisions.get(a.id);
        intent = decision ? decision.intent : idleIntent();
      }

      if (a.action.kind === 'shot_windup' || a.action.kind === 'free_throw') {
        intent = { ...intent, move: mul2(intent.move, 0.15), brake: true };
      }
      if (a.state === 'stumble') intent = { ...intent, move: mul2(intent.move, 0.35), sprint: false };

      this.intentBuffer.set(a.id, intent);
    }

    // Contencao defensiva: calculada sobre as posicoes do inicio do passo.
    if (this.phase === 'live') {
      const handler = this.ballHandler();
      if (handler) {
        const driveDir = len2(handler.vel) > 0.6
          ? norm2(handler.vel)
          : norm2(sub2(hoopGround(this.attackingSide(handler.team)), handler.pos));
        for (const a of this.actors) {
          if (!a.onCourt || a.team === handler.team) continue;
          if (a.assignmentId !== handler.id) continue;
          applyCutoff(a, handler, driveDir, dt, this.t);
        }
      }
    }

    for (const a of this.actors) {
      if (!a.onCourt) continue;
      stepLocomotion(a, this.intentBuffer.get(a.id) ?? idleIntent(), dt, this.t);
      a.pos = clampToCourt(a.pos, 0.25);
    }
  }

  private userIntent(a: Actor): LocomotionIntent {
    const cmd = this.userCommand;
    const hoop = hoopGround(this.attackingSide(a.team));
    const facing = a.hasBall ? toAngle(sub2(hoop, a.pos)) : undefined;
    return {
      move: cmd.move,
      sprint: cmd.sprint && a.adrenaline > 0.02,
      facing: cmd.shootHeld ? toAngle(sub2(hoop, a.pos)) : facing,
      stance: a.hasBall ? 'dribble' : (a.team !== this.possession.team ? 'defense' : 'normal'),
      brake: len2(cmd.move) < 0.08,
    };
  }

  private deadBallIntent(a: Actor): LocomotionIntent {
    const target = this.deadBallSpot(a);
    const d = sub2(target, a.pos);
    return {
      move: len2(d) > 0.3 ? norm2(d) : v2(),
      sprint: len2(d) > 8,
      stance: 'normal',
      brake: len2(d) <= 0.3,
    };
  }

  private deadBallSpot(a: Actor): Vec2 {
    if (this.phase === 'free_throw' && this.freeThrows) {
      const shooterTeam = this.actorById(this.freeThrows.shooterId)?.team ?? 0;
      const side = this.attackingSide(shooterTeam);
      const spot = freeThrowSpot(side);
      if (a.id === this.freeThrows.shooterId) return spot;
      const hoop = hoopGround(side);
      const dir = side === 0 ? 1 : -1;
      const idx = this.onCourtActors(a.team).indexOf(a);
      const lane = a.team === shooterTeam ? 1 : -1;
      return clampToCourt(v2(hoop.x + dir * (1.6 + idx * 0.9), COURT.width / 2 + lane * (2.1 + (idx % 2) * 0.8)), 0.7);
    }
    const attacking = this.attackingSide(this.inboundTeam);
    const isOffense = a.team === this.inboundTeam;
    const side = isOffense ? attacking : this.defendingSide(a.team);
    const hoop = hoopGround(side);
    const dir = side === 0 ? 1 : -1;
    const idx = this.onCourtActors(a.team).indexOf(a);
    const lateral = [-5, -2.5, 0, 2.5, 5][idx % 5];
    return clampToCourt(v2(hoop.x + dir * (isOffense ? 7 + idx * 0.4 : 5 + idx * 0.4), COURT.width / 2 + lateral), 0.8);
  }

  // ---------------------------------------------------------------- acoes

  private beginShot(a: Actor, view: CourtView): void {
    const side = this.attackingSide(a.team);
    const timeSinceCatch = this.simTime - this.possession.lastPassAt;
    const lastMove = a.action.kind === 'dribble_move' ? String(a.action.data.moveId) : undefined;
    const type = inferShotType(a, timeSinceCatch, lastMove);
    const assisted = timeSinceCatch < this.t.passing.assistWindow && !!this.possession.lastPasserId && this.possession.lastPasserId !== a.id;

    const attempt = buildAttempt(a, side, type, {
      assisted,
      assistQuality: this.possession.lastPassQuality,
      assistedById: assisted ? this.possession.lastPasserId : undefined,
      shotClockPressure: this.possession.shotClock < 4,
    });

    // Dentro do garrafao e com alcance: tenta finalizar em vez de arremessar.
    if (attempt.distance < 3.4 && (type !== 'catch_and_shoot' || attempt.distance < 2)) {
      this.beginFinish(a, attempt, view);
      return;
    }

    const rt = releaseTime(a, type, this.t);
    startAction(a, 'shot_windup', rt, rt, { attempt, type }, true);
    if (a.userControlled) this.shooterMeters.set(a.id, new RhythmMeter());
    addCue(a, `shot_${type}`);
  }

  private beginFinish(a: Actor, attempt: ShotAttempt, view: CourtView): void {
    const contact = this.lastContactByActor.get(a.id) ?? 0;
    const selection = selectFinish({ attacker: a, defenders: view.defense, side: attempt.side, contact, t: this.t }, this.rng);
    const dunk = canDunk(a, attempt.distance, contact, this.t);
    const contest = computeContest(attempt, view.defense, this.t);

    if (dunk.possible && (a.profile.tendencies.attackClose > 40 || attempt.distance < 1.6)) {
      const vertical = this.t.finishing.verticalAt25 + (a.effective.vertical / 99) * (this.t.finishing.verticalAt99 - this.t.finishing.verticalAt25);
      jump(a, vertical, this.t);
      const meter = startDunkMeter(a, contest.total, dunk.kind, this.t);
      this.dunkMeters.set(a.id, meter);
      const airTime = Math.max(0.35, 2 * Math.sqrt(2 * vertical / this.t.sim.gravity) * 0.5);
      startAction(a, 'dunk', airTime, airTime * 0.72, { attempt, dunkKind: dunk.kind, contest: contest.total, contact }, true);
      addCue(a, 'dunk_gather');
      return;
    }

    startAction(a, 'layup', selection.gatherTime + 0.28, selection.gatherTime + 0.2, {
      attempt, selection, contest: contest.total, contact,
    }, true);
    a.state = 'gather';
    addCue(a, `gather_${selection.gather}`);
  }

  private beginPass(a: Actor, target: Actor, lob: boolean): void {
    const defenders = this.onCourtActors((1 - a.team) as 0 | 1);
    const plan = planPass(a, target, defenders, this.t, this.rng, {
      type: lob ? 'lob' : undefined,
      assist: a.userControlled ? this.assist.passAssist : 0,
      noLook: !lob && a.profile.tendencies.flashyPass > 55 && this.rng.chance(a.profile.tendencies.flashyPass / 400),
    });
    startAction(a, 'pass', 0.26, 0.16, { plan }, true);
    a.gaze = plan.gaze;
  }

  private progressActions(dt: number): void {
    for (const a of this.actors) {
      if (!a.onCourt || a.action.kind === 'none') continue;
      a.action.t += dt;

      // Dunk meter continua avaliando o contexto durante o voo.
      if (a.action.kind === 'dunk') {
        const meter = this.dunkMeters.get(a.id);
        if (meter) {
          const attempt = a.action.data.attempt as ShotAttempt;
          const contestNow = computeContest(attempt, this.onCourtActors((1 - a.team) as 0 | 1), this.t);
          updateDunkMeter(meter, a, contestNow.total, this.t, dt, a.action.duration);
        }
      }

      if (!a.action.triggered && a.action.t >= a.action.triggerAt) {
        a.action.triggered = true;
        this.triggerAction(a);
      }
      if (a.action.t >= a.action.duration) {
        if (a.state === 'gather') a.state = 'idle';
        clearAction(a);
      }
    }
  }

  private triggerAction(a: Actor): void {
    switch (a.action.kind) {
      case 'shot_windup':
        this.releaseShot(a);
        break;
      case 'pass':
        this.releasePass(a);
        break;
      case 'layup':
        this.resolveLayup(a);
        break;
      case 'dunk':
        this.resolveDunk(a);
        break;
      case 'dribble_move': {
        const defender = this.actorById(a.markedById ?? '');
        const result = resolveBreakPoint(a, defender, this.t);
        if (result.broken && defender) {
          const ps = this.box.players.get(a.id);
          if (ps) ps.ankleBreaks++;
          this.events.push({
            kind: 'ankle_breaker', period: this.period, clock: this.clock, team: a.team,
            playerId: a.id, secondaryId: defender.id, drama: 0.85,
            text: `${shortName(a.profile)} derruba ${shortName(defender.profile)}`,
          });
          applyTakeoverEvent(a, 'assist', this.t);
        }
        break;
      }
      case 'free_throw':
        this.releaseFreeThrow(a);
        break;
      default:
        break;
    }
  }

  private shooterTiming(a: Actor, attempt: ShotAttempt, contest: number): ShotTiming {
    const ideal = a.action.triggerAt;
    if (a.userControlled) {
      const meter = this.shooterMeters.get(a.id);
      const rhythm = meter ? meter.quality(ideal) : 0.5;
      const window = greenWindow(a, attempt, contest, rhythm, this.t) * this.assist.shotWindowScale;
      // O usuario solta o stick: usamos o instante real da soltura.
      const releasedAt = this.userCommand.shootReleased ? a.action.t : ideal + window * 1.6;
      return evaluateTiming(releasedAt, ideal, window, rhythm);
    }
    // CPU: a habilidade de timing vem do perfil de dificuldade + atributo.
    const skill = clamp01(this.aiProfileCfg.shotTimingSkill * 0.6 + (a.effective.shotIQ / 99) * 0.4);
    const rhythm = clamp01(skill + this.rng.normal(0, 0.12));
    const window = greenWindow(a, attempt, contest, rhythm, this.t);
    const error = Math.abs(this.rng.normal(0, lerp(0.16, 0.035, skill)));
    return evaluateTiming(ideal + error, ideal, window, rhythm);
  }

  private releaseShot(a: Actor): void {
    const attempt = a.action.data.attempt as ShotAttempt;
    const defenders = this.onCourtActors((1 - a.team) as 0 | 1);
    const contest = computeContest(attempt, defenders, this.t);
    const timing = this.shooterTiming(a, attempt, contest.total);

    // Toco: apenas o defensor mais proximo tenta (nao os cinco de uma vez).
    const closest = defenders
      .filter((d) => dist2(d.pos, a.pos) <= 2.6)
      .sort((x, y) => dist2(x.pos, a.pos) - dist2(y.pos, a.pos))
      .slice(0, 1);
    for (const d of closest) {
      const releaseHeight = standingReach(a.profile.physique) + a.z + 0.3;
      const blockAttempt = attemptBlock(d, a, releaseHeight, 0.02, this.t, this.rng, false);
      if (blockAttempt.success) {
        this.resolveBlock(d, a, attempt);
        return;
      }
      if (blockAttempt.foul) {
        this.callFoul(d, a, 'shooting', true, attempt.value);
        return;
      }
    }

    const clutch = this.period >= 4 && this.clock < 120 && Math.abs(this.score(0) - this.score(1)) <= 5;
    const breakdown = shotProbability(attempt, timing, contest, this.t, {
      clutch,
      lead: this.score(a.team) - this.score((1 - a.team) as 0 | 1),
      userControlled: a.userControlled,
      successMultiplier: shotSuccessMultiplier(this.config.sliders, a.userControlled),
    });

    const release = buildRelease(attempt, breakdown.final, timing, contest, this.t, this.rng);
    const ctx: ShotContext = {
      shooterId: a.id,
      from: v2(attempt.from.x, attempt.from.y),
      value: attempt.value,
      probability: breakdown.final,
      willMake: release.willMake,
      contest: contest.total,
      timing: timing.quality,
      zone: attempt.zone,
      assistedById: attempt.assistedById,
      resolved: false,
    };
    releaseBall(this.ball, release.origin, release.velocity, release.spin, 'shot', a.id);
    this.ball.shotContext = ctx;
    this.ball.lastShooterId = a.id;
    this.ball.targetSide = attempt.side;
    a.hasBall = false;
    a.ballTime = 0;
    this.shooterMeters.delete(a.id);

    this.events.push({
      kind: 'shot_attempt', period: this.period, clock: this.clock, team: a.team, playerId: a.id,
      pos: attempt.from, value: attempt.value, zone: attempt.zone,
      text: `${shortName(a.profile)} arremessa (${contest.label})`,
      data: { probability: breakdown.final, timing: timing.direction, contest: contest.total, type: attempt.type },
    });
  }

  private releasePass(a: Actor): void {
    const plan = a.action.data.plan as ReturnType<typeof planPass>;
    const from = v3(a.pos.x, a.pos.y, handHeight(a.profile.physique.height, a.z, 'release'));
    const vel = passVelocity(plan, from, this.t);
    releaseBall(this.ball, from, vel, v3(), 'pass', a.id);
    this.ball.passTargetId = plan.target.id;
    this.interceptTried.clear();
    a.hasBall = false;
    a.ballTime = 0;
    this.possession.lastPasserId = a.id;
    this.possession.lastPassAt = this.simTime;
    this.possession.lastPassQuality = plan.quality + assistBonusFrom(a);
    const ps = this.box.players.get(a.id);
    if (ps) ps.passes++;
    addCue(a, `pass_${plan.type}`);
  }

  private resolveLayup(a: Actor): void {
    const attempt = a.action.data.attempt as ShotAttempt;
    const selection = a.action.data.selection as ReturnType<typeof selectFinish>;
    const contest = Number(a.action.data.contest ?? 0);
    const contact = Number(a.action.data.contact ?? 0);
    const defenders = this.onCourtActors((1 - a.team) as 0 | 1);

    // Strip no gather: a bola esta exposta.
    const stripper = defenders
      .filter((d) => dist2(d.pos, a.pos) <= 1.4 && d.profile.tendencies.attemptSteal >= 35)
      .sort((x, y) => dist2(x.pos, a.pos) - dist2(y.pos, a.pos))
      .slice(0, 1);
    for (const d of stripper) {
      const strip = attemptSteal(d, a, selection.exposure, this.t, this.rng, 'neutral');
      if (strip.success) {
        this.resolveSteal(d, a);
        return;
      }
    }

    // Toco na finalizacao: so o defensor mais proximo.
    const closestFinish = defenders
      .filter((d) => dist2(d.pos, a.pos) <= 2.2)
      .sort((x, y) => dist2(x.pos, a.pos) - dist2(y.pos, a.pos))
      .slice(0, 1);
    for (const d of closestFinish) {
      const bh = standingReach(a.profile.physique) + a.z + 0.2;
      const blk = attemptBlock(d, a, bh, 0.05, this.t, this.rng, len2(d.vel) > 5);
      if (blk.success) {
        this.resolveBlock(d, a, attempt);
        return;
      }
      if (blk.foul) {
        this.callFoul(d, a, 'shooting', true, attempt.value);
        return;
      }
    }

    const p = layupProbability({
      attacker: a, selection, distance: attempt.distance, contest, contact,
      side: attempt.side, t: this.t, successMultiplier: shotSuccessMultiplier(this.config.sliders, a.userControlled),
    });
    const made = this.rng.chance(p);
    const andOne = made && rollAndOne(a, contact, this.t, this.rng);

    const vertical = 0.25 + (a.effective.vertical / 99) * 0.3;
    jump(a, vertical, this.t);
    this.launchAtRim(a, attempt, made, p, { total: contest }, 'layup');
    if (andOne) {
      const defender = defenders.sort((x, y) => dist2(x.pos, a.pos) - dist2(y.pos, a.pos))[0];
      if (defender) this.pendingAndOne = { shooterId: a.id, defenderId: defender.id };
    }
    this.events.push({
      kind: 'layup', period: this.period, clock: this.clock, team: a.team, playerId: a.id,
      text: `${shortName(a.profile)}: ${selection.gather} + ${selection.finish}`,
      data: { reason: selection.reason, probability: p },
    });
  }

  private pendingAndOne: { shooterId: string; defenderId: string } | null = null;

  private resolveDunk(a: Actor): void {
    const attempt = a.action.data.attempt as ShotAttempt;
    const kind = a.action.data.dunkKind as 'standing' | 'one_hand' | 'two_hand' | 'power' | 'alley_oop' | 'putback';
    const contact = Number(a.action.data.contact ?? 0);
    const meter = this.dunkMeters.get(a.id);
    const defenders = this.onCourtActors((1 - a.team) as 0 | 1);
    const contestNow = computeContest(attempt, defenders, this.t);

    // Toco na enterrada.
    for (const d of defenders) {
      if (dist2(d.pos, a.pos) > 2.0) continue;
      const bh = COURT.rimHeight + 0.2;
      const blk = attemptBlock(d, a, bh, 0.05, this.t, this.rng, len2(d.vel) > 5);
      if (blk.success) {
        this.resolveBlock(d, a, attempt);
        this.dunkMeters.delete(a.id);
        return;
      }
    }

    const timing = meter
      ? (a.userControlled ? releaseDunkMeter(meter) : clamp01(this.aiProfileCfg.shotTimingSkill + this.rng.normal(0, 0.12)))
      : 0.7;
    const p = dunkProbability(a, kind, timing, contestNow.total, contact, this.t, shotSuccessMultiplier(this.config.sliders, a.userControlled));
    const made = this.rng.chance(p);
    const andOne = made && rollAndOne(a, contact, this.t, this.rng);

    this.launchAtRim(a, attempt, made, p, contestNow, 'dunk');
    this.dunkMeters.delete(a.id);
    if (made) {
      const ps = this.box.players.get(a.id);
      if (ps) ps.dunks++;
      applyTakeoverEvent(a, 'dunk', this.t);
      this.events.push({
        kind: 'dunk', period: this.period, clock: this.clock, team: a.team, playerId: a.id,
        drama: contestNow.total > 0.4 ? 0.95 : 0.7,
        text: `${shortName(a.profile)} enterra${contestNow.total > 0.4 ? ' por cima da marcacao' : ''}`,
      });
    }
    if (andOne) {
      const defender = defenders.sort((x, y) => dist2(x.pos, a.pos) - dist2(y.pos, a.pos))[0];
      if (defender) this.pendingAndOne = { shooterId: a.id, defenderId: defender.id };
    }
  }

  /**
   * Lanca a bola para o aro a partir de uma finalizacao ja decidida.
   *
   * Detalhe que custou caro na calibracao: uma bandeja com trajetoria plana
   * chega ao aro AINDA SUBINDO, e a deteccao de cesta exige a bola descendo
   * pelo circulo. Resultado: bandejas marcadas como convertidas viravam air
   * ball. Agora a bandeja usa arco alto resolvido com arrasto, e a enterrada
   * nasce acima do aro descendo - que e o que fisicamente acontece.
   */
  private launchAtRim(a: Actor, attempt: ShotAttempt, made: boolean, probability: number, contest: { total: number }, kind: 'layup' | 'dunk'): void {
    const hoop = hoopPos(attempt.side);
    const toHoop = norm2(sub2(v2(hoop.x, hoop.y), a.pos));
    const perp = v2(-toHoop.y, toHoop.x);

    let origin: Vec3;
    let velocity: Vec3;
    let spin: Vec3;

    if (kind === 'dunk') {
      // A mao leva a bola acima do aro; ela desce praticamente na vertical.
      const off = made ? this.rng.normal(0, 0.02) : this.rng.range(0.16, 0.3) * this.rng.sign();
      origin = v3(
        hoop.x - toHoop.x * 0.12 + perp.x * off,
        hoop.y - toHoop.y * 0.12 + perp.y * off,
        COURT.rimHeight + 0.34,
      );
      const drop = made ? -4.2 : -3.4;
      velocity = v3(toHoop.x * 0.75 + (made ? 0 : this.rng.normal(0, 0.9)), toHoop.y * 0.75 + (made ? 0 : this.rng.normal(0, 0.9)), drop);
      spin = v3(0, 3, 0);
    } else {
      origin = v3(a.pos.x, a.pos.y, standingReach(a.profile.physique) + a.z + 0.12);
      const jitter = made ? 0.025 : 0;
      const missOff = made ? 0 : this.rng.range(0.12, 0.26) * this.rng.sign();
      const target = v3(
        hoop.x + this.rng.normal(0, jitter) + perp.x * missOff - (made ? 0 : toHoop.x * 0.1),
        hoop.y + this.rng.normal(0, jitter) + perp.y * missOff - (made ? 0 : toHoop.y * 0.1),
        hoop.z + 0.03,
      );
      // Arco alto: a bola precisa PASSAR do aro e descer dentro do circulo.
      const dist = Math.max(0.4, dist2(a.pos, v2(hoop.x, hoop.y)));
      const arc = clamp(64 - dist * 2.5, 48, 68);
      spin = v3(-toHoop.y * 9, toHoop.x * 9, 0);
      velocity = solveLaunchVelocity(origin, target, arc, spin, this.t);
    }

    releaseBall(this.ball, origin, velocity, spin, 'shot', a.id);
    this.ball.shotContext = {
      shooterId: a.id, from: v2(attempt.from.x, attempt.from.y), value: attempt.value,
      probability, willMake: made, contest: contest.total, timing: 1, zone: attempt.zone,
      assistedById: this.simTime - this.possession.lastPassAt < this.t.passing.assistWindow ? this.possession.lastPasserId : undefined,
      resolved: false,
    };
    this.ball.lastShooterId = a.id;
    this.ball.targetSide = attempt.side;
    a.hasBall = false;
    a.ballTime = 0;
    this.events.push({
      kind: 'shot_attempt', period: this.period, clock: this.clock, team: a.team, playerId: a.id,
      pos: attempt.from, value: attempt.value, zone: attempt.zone,
      data: { probability, type: kind },
    });
  }

  // --------------------------------------------------------------- resultados

  private processBallEvents(events: BallEvent[]): void {
    for (const e of events) {
      if (e.kind === 'made') this.onBallThroughHoop(e);
      else if (e.kind === 'out_of_bounds') this.onOutOfBounds();
      else if (e.kind === 'rim_hit' || e.kind === 'backboard_hit') {
        if (this.ball.shotContext && !this.ball.shotContext.resolved && !this.ball.shotContext.willMake) {
          this.missReason = e.kind;
          this.markShotMissed();
        }
      } else if (e.kind === 'floor_bounce' || e.kind === 'settled') {
        if (this.ball.shotContext && !this.ball.shotContext.resolved) {
          this.missReason = `${e.kind}/willMake=${this.ball.shotContext.willMake}`;
          this.markShotMissed();
        }
      }
    }
    // Arremesso que desce sem tocar em nada (air ball).
    const ctx = this.ball.shotContext;
    if (ctx && !ctx.resolved && this.ball.pos.z < COURT.rimHeight - 0.4 && this.ball.vel.z < 0) {
      this.missReason = `airball/willMake=${ctx.willMake}/z=${this.ball.pos.z.toFixed(2)}`;
      this.markShotMissed();
    }
  }

  private onBallThroughHoop(e: BallEvent): void {
    const ctx = this.ball.shotContext;
    if (ctx?.isFreeThrow || (this.phase === 'free_throw' && this.freeThrows)) {
      if (ctx) ctx.resolved = true;
      this.ball.shotContext = undefined;
      this.onFreeThrowResult(true);
      return;
    }
    if (!ctx || ctx.resolved) return;
    ctx.resolved = true;
    const shooter = this.actorById(ctx.shooterId);
    if (!shooter) return;
    const teamIdx = shooter.team;
    const points = ctx.value;
    const entry: ShotChartEntry = {
      x: ctx.from.x, y: ctx.from.y, made: true, value: ctx.value, zone: ctx.zone as any,
      contest: ctx.contest, period: this.period, clock: this.clock, shooterId: ctx.shooterId,
    };
    recordShot(this.box, entry, teamIdx, points);
    this.addPoints(teamIdx, points, ctx);

    updateHeat(shooter, true, ctx.value);
    applyTakeoverEvent(shooter, ctx.value === 3 ? 'made3' : 'made2', this.t);

    // Assistencia.
    if (ctx.assistedById && ctx.assistedById !== shooter.id) {
      const passer = this.box.players.get(ctx.assistedById);
      if (passer) passer.assists++;
      this.box.teams[teamIdx].assists++;
      const passerActor = this.actorById(ctx.assistedById);
      if (passerActor) applyTakeoverEvent(passerActor, 'assist', this.t);
      this.events.push({
        kind: 'assist', period: this.period, clock: this.clock, team: teamIdx,
        playerId: ctx.assistedById, secondaryId: shooter.id,
      });
    }

    this.events.push({
      kind: 'shot_made', period: this.period, clock: this.clock, team: teamIdx, playerId: shooter.id,
      pos: ctx.from, value: ctx.value, zone: ctx.zone as any,
      drama: ctx.value === 3 ? 0.6 : 0.4,
      text: `${shortName(shooter.profile)} converte de ${ctx.value}`,
    });

    if (this.pendingAndOne && this.pendingAndOne.shooterId === shooter.id) {
      const defender = this.actorById(this.pendingAndOne.defenderId);
      this.pendingAndOne = null;
      if (defender) {
        this.callFoul(defender, shooter, 'shooting', true, ctx.value, true);
        return;
      }
    }

    this.ball.shotContext = undefined;
    this.deadBall('made', (1 - teamIdx) as 0 | 1, this.inboundSpotAfterMade(teamIdx));
  }

  /** Diagnostico: por que cada arremesso foi resolvido como erro. */
  readonly missReasons = new Map<string, number>();
  private missReason = '?';

  private markShotMissed(): void {
    this.missReasons.set(this.missReason, (this.missReasons.get(this.missReason) ?? 0) + 1);
    const ctx = this.ball.shotContext;
    if (!ctx || ctx.resolved) return;
    ctx.resolved = true;
    if (ctx.isFreeThrow) {
      this.ball.shotContext = undefined;
      this.onFreeThrowResult(false);
      return;
    }
    const shooter = this.actorById(ctx.shooterId);
    if (shooter) {
      const entry: ShotChartEntry = {
        x: ctx.from.x, y: ctx.from.y, made: false, value: ctx.value, zone: ctx.zone as any,
        contest: ctx.contest, period: this.period, clock: this.clock, shooterId: ctx.shooterId,
      };
      recordShot(this.box, entry, shooter.team, 0);
      updateHeat(shooter, false, ctx.value);
      applyTakeoverEvent(shooter, 'miss', this.t);
      this.events.push({
        kind: 'shot_missed', period: this.period, clock: this.clock, team: shooter.team,
        playerId: shooter.id, pos: ctx.from, value: ctx.value, zone: ctx.zone as any,
      });
    }
    this.ball.shotContext = undefined;
    this.beginReboundPhase();
  }

  private beginReboundPhase(): void {
    const predicted = predictCatchPoint(this.ball, 2.6, 2.5, this.t.sim.gravity, this.t.ball.drag);
    this.reboundPending = true;
    this.reboundSpot = predicted.pos;
    this.reboundHeight = predicted.height;
    this.ball.state = 'loose';
  }

  private checkRebound(): void {
    // A disputa resolve quando a bola chega a altura de captura.
    if (this.ball.pos.z > this.t.ball.catchHeightMax || this.ball.vel.z > 0) return;
    const spot = ballGround(this.ball);
    const candidates = this.actors.filter((a) => a.onCourt && dist2(a.pos, spot) < 5.6);
    if (!candidates.length) {
      if (this.ball.pos.z < 0.4) {
        // Ninguem perto: vira bola solta comum.
        this.reboundPending = false;
      }
      return;
    }
    const offensiveSide = this.possession.team;
    const result = contestRebound(candidates, spot, this.ball.pos.z, (1 - offensiveSide) as Side, this.boxoutQuality, this.t, this.rng);
    if (!result.winner) return;
    this.reboundPending = false;
    this.boxoutQuality.clear();

    const winner = result.winner;
    const offensive = winner.team === offensiveSide;
    const ps = this.box.players.get(winner.id);
    if (ps) {
      if (offensive) ps.oreb++;
      else ps.dreb++;
    }
    const ts = this.box.teams[winner.team];
    if (offensive) ts.oreb++;
    else ts.dreb++;
    applyTakeoverEvent(winner, 'rebound', this.t);

    this.events.push({
      kind: 'rebound', period: this.period, clock: this.clock, team: winner.team, playerId: winner.id,
      text: `${shortName(winner.profile)} pega o rebote ${offensive ? 'ofensivo' : 'defensivo'}`,
      data: { offensive, tip: result.tip },
    });

    if (result.tip) {
      // Tip: a bola volta ao ar, disputa continua.
      const target = v3(this.ball.pos.x + this.rng.normal(0, 1.4), this.ball.pos.y + this.rng.normal(0, 1.4), 3.1);
      releaseBall(this.ball, this.ball.pos, v3((target.x - this.ball.pos.x) * 1.5, (target.y - this.ball.pos.y) * 1.5, 3.4), v3(), 'loose', winner.id);
      this.reboundPending = true;
      return;
    }

    this.giveBall(winner);
    if (offensive) {
      this.possession.shotClock = Math.max(this.possession.shotClock, this.t.game.shotClockOffensiveRebound);
      this.possession.secondChance = true;
      this.possession.play = undefined;
    } else {
      this.beginPossession(winner.team, 'rebound');
    }
  }

  private checkLooseBallPickup(): void {
    if (this.ball.state === 'shot' || this.ball.shotContext) return;
    if (this.ball.pos.z > this.t.ball.catchHeightMax) return;
    const spot = ballGround(this.ball);

    // Recepcao de passe.
    if (this.ball.state === 'pass' && this.ball.passTargetId) {
      // Interceptacao: estar perto nao basta. E preciso ler a linha, chegar com
      // a mao e converter - e cada defensor tenta uma unica vez por passe.
      for (const d of this.actors) {
        if (!d.onCourt || d.team === this.possession.team) continue;
        if (dist2(d.pos, spot) >= this.t.ball.catchRadius) continue;
        if (this.ball.pos.z >= standingReach(d.profile.physique) + 0.4) continue;
        const key = `${d.id}|${this.ball.age.toFixed(0)}`;
        if (this.interceptTried.has(key)) continue;
        this.interceptTried.add(key);
        const reach = clamp01(1 - dist2(d.pos, spot) / this.t.ball.catchRadius);
        const skill = clamp01(
          (d.effective.steal / 99) * 0.35 + (d.effective.defensiveIQ / 99) * 0.3 + (d.effective.hands / 99) * 0.2 + reach * 0.15,
        );
        // Tres desfechos, nesta ordem: nao encostar (o mais comum), encostar e
        // desviar, ou encostar e dominar. Tratar "estar perto" como roubo dava
        // dezenas de turnovers por jogo.
        const touch = clamp01(0.2 + skill * 0.22) * (0.6 + reach * 0.6);
        if (!this.rng.chance(touch)) continue;
        if (this.rng.chance(clamp01(0.24 + skill * 0.18))) {
          const passer = this.actorById(this.ball.lastTouchId ?? '');
          this.resolveInterception(d, passer);
          return;
        }
        // Desvio: a bola perde energia e fica viva perto de onde estava.
        this.ball.vel = v3(this.ball.vel.x * 0.3, this.ball.vel.y * 0.3, Math.max(0.6, this.ball.vel.z * 0.3));
        this.ball.state = 'loose';
        this.ball.passTargetId = undefined;
        const ds = this.box.players.get(d.id);
        if (ds) ds.deflections++;
        this.events.push({
          kind: 'deflection', period: this.period, clock: this.clock, team: d.team, playerId: d.id,
          text: `${shortName(d.profile)} desvia o passe`,
        });
        return;
      }
      const target = this.actorById(this.ball.passTargetId);
      if (target && dist2(target.pos, spot) < this.t.ball.catchRadius + 0.6) {
        const contested = this.actors.some((d) => d.onCourt && d.team !== target.team && dist2(d.pos, target.pos) < 1.4);
        const handler = this.actorById(this.ball.lastTouchId ?? '');
        const plan = handler?.action.data.plan as ReturnType<typeof planPass> | undefined;
        const ok = plan ? catchCheck(target, plan, contested, this.t, this.rng) : true;
        if (ok) {
          this.giveBall(target);
          const ps = this.box.players.get(target.id);
          if (ps) {
            ps.touches++;
            if (isInPaint(target.pos, this.attackingSide(target.team))) ps.paintTouches++;
          }
        } else {
          this.ball.state = 'loose';
          this.ball.passTargetId = undefined;
        }
        return;
      }
    }

    // Passe que passou do alvo vira bola solta perto de onde errou, em vez de
    // seguir em linha reta ate sair de quadra.
    if (this.ball.state === 'pass' && this.ball.age > 0.9) {
      this.ball.state = 'loose';
      this.ball.passTargetId = undefined;
      this.ball.vel = v3(this.ball.vel.x * 0.45, this.ball.vel.y * 0.45, this.ball.vel.z);
    }

    // Bola solta no chao.
    if (this.ball.state === 'loose' || this.ball.state === 'rolling') {
      let best: Actor | undefined;
      let bestDist = this.t.ball.catchRadius;
      for (const a of this.actors) {
        if (!a.onCourt) continue;
        const d = dist2(a.pos, spot);
        if (d < bestDist) {
          bestDist = d;
          best = a;
        }
      }
      if (best) {
        const wasOpponent = best.team !== this.possession.team;
        this.giveBall(best);
        if (wasOpponent) this.beginPossession(best.team, 'turnover');
      }
    }
  }

  private resolveInterception(defender: Actor, passer: Actor | undefined): void {
    const ps = this.box.players.get(defender.id);
    if (ps) ps.steals++;
    this.box.teams[defender.team].steals++;
    if (passer) {
      const pp = this.box.players.get(passer.id);
      if (pp) pp.turnovers++;
      this.box.teams[passer.team].turnovers++;
      applyTakeoverEvent(passer, 'turnover', this.t);
    }
    applyTakeoverEvent(defender, 'steal', this.t);
    this.events.push({
      kind: 'steal', period: this.period, clock: this.clock, team: defender.team, playerId: defender.id,
      secondaryId: passer?.id, drama: 0.7,
      text: `${shortName(defender.profile)} intercepta o passe`,
    });
    this.giveBall(defender);
    this.beginPossession(defender.team, 'steal');
  }

  private resolveSteal(defender: Actor, victim: Actor): void {
    const ps = this.box.players.get(defender.id);
    if (ps) ps.steals++;
    this.box.teams[defender.team].steals++;
    const vs = this.box.players.get(victim.id);
    if (vs) vs.turnovers++;
    this.box.teams[victim.team].turnovers++;
    applyTakeoverEvent(defender, 'steal', this.t);
    applyTakeoverEvent(victim, 'turnover', this.t);
    this.events.push({
      kind: 'steal', period: this.period, clock: this.clock, team: defender.team, playerId: defender.id,
      secondaryId: victim.id, drama: 0.75,
      text: `${shortName(defender.profile)} rouba de ${shortName(victim.profile)}`,
    });
    victim.hasBall = false;
    clearAction(victim);
    this.giveBall(defender);
    this.beginPossession(defender.team, 'steal');
  }

  private resolveBlock(defender: Actor, shooter: Actor, attempt: ShotAttempt): void {
    const ps = this.box.players.get(defender.id);
    if (ps) ps.blocks++;
    this.box.teams[defender.team].blocks++;
    const ss = this.box.players.get(shooter.id);
    if (ss) {
      ss.fga++;
      if (attempt.value === 3) ss.tpa++;
    }
    this.box.teams[shooter.team].fga++;
    applyTakeoverEvent(defender, 'block', this.t);
    applyTakeoverEvent(shooter, 'miss', this.t);
    this.events.push({
      kind: 'block', period: this.period, clock: this.clock, team: defender.team, playerId: defender.id,
      secondaryId: shooter.id, drama: 0.9,
      text: `${shortName(defender.profile)} bloqueia ${shortName(shooter.profile)}`,
    });
    shooter.hasBall = false;
    clearAction(shooter);
    // A bola sai na direcao do toco.
    const dir = norm2(sub2(shooter.pos, defender.pos));
    const out = v3(shooter.pos.x + dir.x * 0.6, shooter.pos.y + dir.y * 0.6, 2.4);
    releaseBall(this.ball, out, v3(dir.x * 2.6 + this.rng.normal(0, 1), dir.y * 2.6 + this.rng.normal(0, 1), 1.3), v3(), 'loose', defender.id);
    this.ball.shotContext = undefined;
    this.reboundPending = true;
  }

  /**
   * Um contato sustentado (dois corpos encostados) e UM episodio, nao 120
   * episodios por segundo. Sem esse controle, qualquer encosto vira falta em
   * fracoes de segundo - foi exatamente o que aconteceu na primeira calibracao.
   */
  private contactEpisodes = new Map<string, number>();
  private stealCooldown = new Map<string, number>();

  private processContacts(contacts: ContactEvent[], dt: number): void {
    if (this.phase !== 'live') return;
    for (const c of contacts) {
      this.lastContactByActor.set(c.a.id, Math.max(this.lastContactByActor.get(c.a.id) ?? 0, c.severity));
      this.lastContactByActor.set(c.b.id, Math.max(this.lastContactByActor.get(c.b.id) ?? 0, c.severity));
      if (c.severity < 0.1) continue;

      // No basquete real a falta quase sempre envolve a bola. Contato entre
      // dois jogadores longe da jogada raramente e marcado.
      const ballInvolved = c.a.hasBall || c.b.hasBall
        || c.type === 'screen' || c.type === 'loose_ball' || c.type === 'boxout'
        || (!this.ball.ownerId && !!this.ball.shotContext);
      if (!ballInvolved) continue;

      const pairKey = c.a.id < c.b.id ? `${c.a.id}|${c.b.id}` : `${c.b.id}|${c.a.id}`;
      const last = this.contactEpisodes.get(pairKey) ?? -99;
      // Novo episodio so apos 0,7 s sem contato relevante entre os dois corpos.
      if (this.simTime - last < 0.7) continue;
      this.contactEpisodes.set(pairKey, this.simTime);

      const shooterInvolved = (c.a.action.kind === 'shot_windup' || c.a.action.kind === 'layup' || c.a.action.kind === 'dunk')
        || (c.b.action.kind === 'shot_windup' || c.b.action.kind === 'layup' || c.b.action.kind === 'dunk');
      const aggressor = c.aggressorIsA ? c.a : c.b;
      const victim = c.aggressorIsA ? c.b : c.a;
      const foul = judgeContact(c, this.t, this.rng, {
        shooting: shooterInvolved && victim.hasBall,
        foulTolerance: this.gameplans[aggressor.team].foulTolerance,
      });
      if (foul) {
        const by = this.actorById(foul.byId);
        const on = this.actorById(foul.onId);
        if (!by || !on) continue;
        if (foul.kind === 'offensive_charge' || foul.kind === 'offensive_illegal_screen') {
          this.callOffensiveFoul(by, foul.kind);
        } else {
          this.callFoul(by, on, foul.kind, shooterInvolved && on.hasBall, 2);
        }
        return;
      }
    }
  }

  // ----------------------------------------------------------------- faltas

  private callFoul(by: Actor, on: Actor, kind: string, shooting: boolean, shotValue: 2 | 3, andOne = false): void {
    by.fouls++;
    const ps = this.box.players.get(by.id);
    if (ps) ps.fouls++;
    const ts = this.box.teams[by.team];
    ts.fouls++;
    ts.teamFoulsThisPeriod++;

    this.events.push({
      kind: 'foul', period: this.period, clock: this.clock, team: by.team, playerId: by.id, secondaryId: on.id,
      text: `Falta de ${shortName(by.profile)} sobre ${shortName(on.profile)}${andOne ? ' (and-one)' : ''}`,
      data: { kind, shooting },
    });

    if (isFoulOut(by, this.t)) {
      by.onCourt = false;
      const replacement = this.benchActors(by.team).sort((x, y) => y.effective.stamina - x.effective.stamina)[0];
      if (replacement) {
        replacement.onCourt = true;
        replacement.pos = v2(by.pos.x, by.pos.y);
      }
      this.events.push({
        kind: 'foul_out', period: this.period, clock: this.clock, team: by.team, playerId: by.id,
        text: `${shortName(by.profile)} eliminado por faltas`, drama: 0.6,
      });
    }

    const shots = andOne ? 1 : freeThrowsFor(shooting ? 'shooting' : 'personal', shooting ? shotValue : 0, andOne, ts.teamFoulsThisPeriod, this.t);
    if (shots > 0) {
      this.freeThrows = { shooterId: on.id, remaining: shots, andOne };
      this.phase = 'free_throw';
      this.deadTimer = this.t.game.freeThrowInterval;
      this.ball.state = 'dead';
      this.ball.ownerId = undefined;
      on.hasBall = false;
    } else {
      // Reposicao lateral para o time que sofreu.
      this.deadBall('foul', on.team, v2(on.pos.x, on.pos.y));
    }
  }

  private callOffensiveFoul(by: Actor, kind: string): void {
    by.fouls++;
    const ps = this.box.players.get(by.id);
    if (ps) {
      ps.fouls++;
      ps.turnovers++;
    }
    this.box.teams[by.team].fouls++;
    this.box.teams[by.team].teamFoulsThisPeriod++;
    this.box.teams[by.team].turnovers++;
    this.events.push({
      kind: 'foul', period: this.period, clock: this.clock, team: by.team, playerId: by.id,
      text: `Falta de ataque de ${shortName(by.profile)}`, data: { kind },
    });
    by.hasBall = false;
    this.deadBall('turnover', (1 - by.team) as 0 | 1, v2(by.pos.x, by.pos.y));
  }

  private shootFreeThrow(): void {
    if (!this.freeThrows || this.ftAwaitingResult) return;
    const shooter = this.actorById(this.freeThrows.shooterId);
    if (!shooter) {
      this.freeThrows = null;
      return;
    }
    const side = this.attackingSide(shooter.team);
    const spot = freeThrowSpot(side);
    // O atleta precisa estar na linha; se ainda nao chegou, espera mais um pouco.
    if (dist2(shooter.pos, spot) > 0.9) {
      this.deadTimer = 0.25;
      return;
    }
    shooter.vel = v2();
    const attempt = buildAttempt(shooter, side, 'free_throw');
    startAction(shooter, 'free_throw', 0.9, 0.8, { attempt }, true);
    attachBall(this.ball, shooter.pos, handHeight(shooter.profile.physique.height, 0, 'hold'), shooter.id);
    this.deadTimer = 1.6;
  }

  private releaseFreeThrow(a: Actor): void {
    const attempt = a.action.data.attempt as ShotAttempt;
    const timing = this.shooterTiming(a, attempt, 0);
    const breakdown = shotProbability(attempt, timing, { total: 0, proximity: 0, hand: 0, height: 0, timing: 0, closing: 0, label: 'aberto' }, this.t, {
      clutch: false, lead: 0, userControlled: a.userControlled,
      successMultiplier: shotSuccessMultiplier(this.config.sliders, a.userControlled),
    });
    const release = buildRelease(attempt, breakdown.final, timing, { total: 0, proximity: 0, hand: 0, height: 0, timing: 0, closing: 0, label: 'aberto' }, this.t, this.rng);
    releaseBall(this.ball, release.origin, release.velocity, release.spin, 'shot', a.id);
    this.ball.targetSide = attempt.side;
    this.ball.lastShooterId = a.id;
    // O lance livre tambem carrega contexto: sem isso, um erro nunca resolveria
    // e a partida travaria esperando um resultado que nao chega.
    this.ball.shotContext = {
      shooterId: a.id, from: v2(attempt.from.x, attempt.from.y), value: attempt.value,
      probability: breakdown.final, willMake: release.willMake, contest: 0, timing: timing.quality,
      zone: attempt.zone, resolved: false, isFreeThrow: true,
    };
    this.ftAwaitingResult = true;
    this.deadTimer = 6;
  }

  private ftAwaitingResult = false;

  private onFreeThrowResult(made: boolean): void {
    this.ftAwaitingResult = false;
    if (!this.freeThrows) return;
    const shooter = this.actorById(this.freeThrows.shooterId);
    if (!shooter) return;
    const ps = this.box.players.get(shooter.id);
    const ts = this.box.teams[shooter.team];
    ts.fta++;
    if (ps) ps.fta++;
    if (made) {
      ts.ftm++;
      if (ps) {
        ps.ftm++;
        ps.points++;
      }
      ts.points++;
      this.registerScoreChange(shooter.team, 1);
    }
    this.events.push({
      kind: 'free_throw', period: this.period, clock: this.clock, team: shooter.team, playerId: shooter.id,
      value: made ? 1 : 0, text: `${shortName(shooter.profile)}: lance livre ${made ? 'convertido' : 'errado'}`,
    });

    this.freeThrows.remaining--;
    this.ball.shotContext = undefined;
    if (this.freeThrows.remaining > 0) {
      this.phase = 'free_throw';
      this.deadTimer = this.t.game.freeThrowInterval;
      this.ball.state = 'dead';
      return;
    }

    const team = shooter.team;
    this.freeThrows = null;
    if (made) {
      this.deadBall('made', (1 - team) as 0 | 1, this.inboundSpotAfterMade(team));
    } else {
      // Ultimo lance errado: rebote vivo.
      this.phase = 'live';
      this.beginReboundPhase();
    }
  }

  // --------------------------------------------------------------- posse

  private beginPossession(team: 0 | 1, startedBy: PossessionState['startedBy']): void {
    const previous = this.possession;
    // Posse so conta quando o time do ataque muda. Uma falta ou lateral que
    // devolve a bola ao mesmo ataque e a MESMA posse - contar duas vezes
    // inflava o ritmo e destruia todos os ratings por 100 posses.
    if (!previous || previous.team !== team || startedBy === 'tipoff') {
      this.box.teams[team].possessions++;
    }
    const wasFast = startedBy === 'steal' || startedBy === 'rebound';
    this.possession = {
      team,
      shotClock: this.t.game.shotClock,
      startedAt: this.simTime,
      startedBy,
      lastPassAt: -99,
      lastPassQuality: 0,
      play: undefined,
      playStartedAt: this.simTime,
      playWing: this.rng.sign() as -1 | 1,
      roleOrder: [],
      isFastBreak: wasFast,
      secondChance: false,
      offTurnover: startedBy === 'steal' || startedBy === 'turnover',
    };
    const offense = this.onCourtActors(team);
    const defense = this.onCourtActors((1 - team) as 0 | 1);
    assignMatchups(defense, offense, this.gameplans[(1 - team) as 0 | 1]);
    if (previous && previous.team !== team) {
      for (const d of defense) applyTakeoverEvent(d, 'stop', this.t);
    }
  }

  private giveBall(a: Actor): void {
    for (const other of this.actors) other.hasBall = false;
    a.hasBall = true;
    a.ballTime = 0;
    attachBall(this.ball, a.pos, handHeight(a.profile.physique.height, a.z, 'dribble'), a.id);
    this.ball.state = 'dribbling';
    this.ball.passTargetId = undefined;
    this.ball.shotContext = undefined;
    const ps = this.box.players.get(a.id);
    if (ps) ps.touches++;
  }

  private updateHeldBall(dt: number): void {
    const owner = this.ballHandler();
    if (!owner) return;
    owner.ballTime += dt;
    const bounce = Math.abs(Math.sin(this.simTime * 7.5)) * 0.55;
    const front = fromAngle(owner.heading, 0.42);
    const hand = owner.ballHand === 'right' ? 1 : -1;
    const side = mul2(v2(-front.y, front.x), hand * 0.22);
    this.ball.pos = v3(
      owner.pos.x + front.x * 0.35 + side.x,
      owner.pos.y + front.y * 0.35 + side.y,
      owner.z + (owner.state === 'gather' || !owner.grounded ? handHeight(owner.profile.physique.height, owner.z, 'gather') : 0.25 + bounce * 0.75),
    );
    this.ball.state = owner.grounded && owner.action.kind === 'none' ? 'dribbling' : 'held';

    // Seguranca da bola sob pressao.
    if (this.phase === 'live' && owner.grounded) {
      const defenders = this.onCourtActors((1 - owner.team) as 0 | 1);
      let pressure = 0;
      let traffic = 0;
      for (const d of defenders) {
        const dd = dist2(d.pos, owner.pos);
        if (dd < 2.4) {
          pressure = Math.max(pressure, onBallPressure(d, owner, this.t));
          traffic += 1;
        }
      }
      const exposure = owner.action.kind === 'dribble_move'
        ? (MOVE_BY_ID.get(String(owner.action.data.moveId))?.exposure ?? 0.25)
        : 0.18;
      const contact = this.lastContactByActor.get(owner.id) ?? 0;
      const risk = ballSecurityRisk(owner, { pressure, contact, exposure, traffic: clamp01(traffic / 3) }, this.t) * dt;
      if (this.rng.chance(risk)) this.fumble(owner);
    }
  }

  private fumble(owner: Actor): void {
    owner.hasBall = false;
    clearAction(owner);
    const dir = fromAngle(owner.heading + this.rng.range(-1.6, 1.6));
    releaseBall(this.ball, v3(owner.pos.x, owner.pos.y, 0.8), v3(dir.x * 2.1, dir.y * 2.1, 0.9), v3(), 'loose', owner.id);
    this.events.push({
      kind: 'turnover', period: this.period, clock: this.clock, team: owner.team, playerId: owner.id,
      text: `${shortName(owner.profile)} perde o controle da bola`,
      data: { kind: 'fumble' },
    });
    addCue(owner, 'fumble');
  }

  private addPoints(teamIdx: 0 | 1, points: number, ctx: ShotContext): void {
    const ts = this.box.teams[teamIdx];
    const shooter = this.actorById(ctx.shooterId);
    if (ctx.zone === 'rim' || ctx.zone === 'paint') ts.paintPoints += points;
    if (this.possession.isFastBreak && this.simTime - this.possession.startedAt < 6) {
      ts.fastBreakPoints += points;
      const ps = this.box.players.get(ctx.shooterId);
      if (ps) ps.fastBreakPoints += points;
    }
    if (this.possession.secondChance) {
      ts.secondChancePoints += points;
      const ps = this.box.players.get(ctx.shooterId);
      if (ps) ps.secondChancePoints += points;
    }
    if (this.possession.offTurnover) ts.pointsOffTurnovers += points;
    if (shooter && !this.teams[teamIdx].starters.includes(shooter.id)) ts.benchPoints += points;
    this.registerScoreChange(teamIdx, points);
  }

  private registerScoreChange(teamIdx: 0 | 1, points: number): void {
    if (this.runTracker.team === teamIdx) this.runTracker.points += points;
    else this.runTracker = { team: teamIdx, points };
    const ts = this.box.teams[teamIdx];
    ts.largestRun = Math.max(ts.largestRun, this.runTracker.points);
    const lead = this.score(teamIdx) - this.score((1 - teamIdx) as 0 | 1);
    ts.biggestLead = Math.max(ts.biggestLead, lead);
    this.periodPoints[teamIdx] += points;

    // Plus/minus.
    for (const a of this.actors) {
      if (!a.onCourt) continue;
      const ps = this.box.players.get(a.id);
      if (ps) ps.plusMinus += a.team === teamIdx ? points : -points;
    }
  }

  private inboundSpotAfterMade(scoringTeam: 0 | 1): Vec2 {
    const side = this.attackingSide(scoringTeam);
    const hoop = hoopGround(side);
    const dir = side === 0 ? -1 : 1;
    return v2(clamp(hoop.x + dir * 1.2, 0.4, COURT.length - 0.4), COURT.width / 2 + this.rng.range(-2.5, 2.5));
  }

  private deadBall(reason: string, inboundTeam: 0 | 1, pos: Vec2): void {
    this.phase = 'dead';
    this.deadReason = reason;
    this.deadTimer = this.t.game.deadBallInbound;
    this.inboundTeam = inboundTeam;
    this.inboundPos = clampToCourt(pos, 0.3);
    this.ball.state = 'dead';
    this.ball.ownerId = undefined;
    this.ball.shotContext = undefined;
    this.reboundPending = false;
    for (const a of this.actors) {
      a.hasBall = false;
      if (a.state === 'screen' || a.state === 'boxout') a.state = 'idle';
      clearAction(a);
    }
    // Rotacao acontece em bola morta.
    this.coachTick(this.possession.team);
  }

  private resumeFromInbound(): void {
    const team = this.inboundTeam;
    const inbounder = this.onCourtActors(team)
      .sort((a, b) => dist2(a.pos, this.inboundPos) - dist2(b.pos, this.inboundPos))[0];
    if (!inbounder) return;
    this.beginPossession(team, 'inbound');
    this.giveBall(inbounder);
    this.phase = 'live';
    this.events.push({ kind: 'jump_ball', period: this.period, clock: this.clock, team, text: `Reposicao (${this.deadReason})` });
  }

  private onOutOfBounds(): void {
    // Bola morta ja tratada nao gera novo evento.
    if (this.phase !== 'live') return;
    const lastTouch = this.actorById(this.ball.lastTouchId ?? '');
    const team = lastTouch ? ((1 - lastTouch.team) as 0 | 1) : this.possession.team;
    if (lastTouch && lastTouch.team === this.possession.team && !this.ball.shotContext) {
      const ps = this.box.players.get(lastTouch.id);
      if (ps) ps.turnovers++;
      this.box.teams[lastTouch.team].turnovers++;
    }
    this.events.push({ kind: 'out_of_bounds', period: this.period, clock: this.clock, team, playerId: lastTouch?.id });
    this.ball.shotContext = undefined;
    this.deadBall('lateral', team, ballGround(this.ball));
  }

  private violation(kind: 'shot_clock' | 'backcourt'): void {
    const team = this.possession.team;
    const handler = this.ballHandler();
    if (handler) {
      const ps = this.box.players.get(handler.id);
      if (ps) ps.turnovers++;
    }
    this.box.teams[team].turnovers++;
    this.events.push({
      kind: kind === 'shot_clock' ? 'shot_clock_violation' : 'backcourt',
      period: this.period, clock: this.clock, team,
      text: kind === 'shot_clock' ? 'Violacao dos 24 segundos' : 'Volta ao ataque',
    });
    this.deadBall(kind, (1 - team) as 0 | 1, ballGround(this.ball));
  }

  // -------------------------------------------------------------- periodos

  private endPeriod(): void {
    this.box.teams[0].pointsByPeriod.push(this.periodPoints[0]);
    this.box.teams[1].pointsByPeriod.push(this.periodPoints[1]);
    this.periodPoints = [0, 0];
    this.events.push({ kind: 'period_end', period: this.period, clock: 0, text: `Fim do periodo ${this.period}` });

    const tied = this.score(0) === this.score(1);
    if (this.period >= this.t.game.periods && !tied) {
      this.phase = 'final';
      this.events.push({
        kind: 'game_end', period: this.period, clock: 0, drama: 1,
        text: `Final: ${this.box.teams[0].name} ${this.score(0)} x ${this.score(1)} ${this.box.teams[1].name}`,
      });
      return;
    }
    this.period++;
    this.phase = 'period_break';
    this.deadTimer = this.period === 3 ? 12 : 6;
    for (const ts of this.box.teams) ts.teamFoulsThisPeriod = 0;
  }

  private startPeriod(): void {
    this.clock = this.period > this.t.game.periods ? this.t.game.overtimeSeconds : this.t.game.periodSeconds;
    this.events.push({ kind: 'period_start', period: this.period, clock: this.clock, text: `Inicio do periodo ${this.period}` });
    // Posse alterna por periodo.
    const team = (this.period % 2 === 0 ? 1 : 0) as 0 | 1;
    this.inboundTeam = team;
    this.inboundPos = v2(COURT.length / 2, this.period % 2 === 0 ? 0.4 : COURT.width - 0.4);
    this.phase = 'dead';
    this.deadTimer = this.t.game.deadBallInbound;
  }

  /** Simula ate o fim da partida (uso headless). */
  runToCompletion(maxSeconds = 60 * 90): void {
    if (this.phase === 'warmup') this.start();
    const dt = this.t.sim.dt;
    let elapsed = 0;
    while (this.phase !== 'final' && elapsed < maxSeconds) {
      this.substep(dt);
      elapsed += dt;
    }
    if (this.phase !== 'final') {
      this.phase = 'final';
      this.events.push({ kind: 'game_end', period: this.period, clock: 0, text: 'Partida encerrada por limite de tempo' });
    }
    this.finalizeStats();
  }

  finalizeStats(): void {
    for (const idx of [0, 1] as (0 | 1)[]) {
      const ts = this.box.teams[idx];
      const opp = this.box.teams[(1 - idx) as 0 | 1];
      if (ts.possessions === 0) ts.possessions = Math.round(estimatePossessions(ts, opp));
    }
  }
}
