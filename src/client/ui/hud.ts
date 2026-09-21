/**
 * HUD (secoes 93, 94, 20, 27).
 *
 * Regra: mostrar o necessario e sumir quando nao e necessario. O shot meter so
 * existe durante o arremesso; o medidor de takeover so aparece quando esta
 * carregando; o play art some quando a jogada acaba.
 */
import { clamp, clamp01, formatClock, lerp, pct } from '../../core/math/util.js';
import { GameSim } from '../../core/sim/game.js';
import { Actor } from '../../core/sim/actor.js';
import { TAKEOVER_CATEGORIES, TAKEOVER_LABELS, takeoverState } from '../../core/sim/takeover.js';
import { TeamColors, shade } from '../render/renderer.js';
import { GameEvent } from '../../core/sim/events.js';

type Ctx = CanvasRenderingContext2D;

export interface HudState {
  /** Feedback do ultimo arremesso (secao 20). */
  lastShot?: { timing: string; contest: string; probability: number; at: number; made?: boolean };
  /** Texto de apresentacao/comentario corrente. */
  ticker: string[];
  showMeter: boolean;
  meterValue: number;
  meterWindow: number;
  meterIdeal: number;
}

export function createHudState(): HudState {
  return { ticker: [], showMeter: false, meterValue: 0, meterWindow: 0.1, meterIdeal: 0.5 };
}

export function drawScorebug(ctx: Ctx, sim: GameSim, w: number, colors: [TeamColors, TeamColors]): void {
  const t0 = sim.box.teams[0];
  const t1 = sim.box.teams[1];
  const bw = 460;
  const bh = 52;
  const x = (w - bw) / 2;
  const y = 14;

  ctx.save();
  ctx.fillStyle = 'rgba(8,11,18,0.82)';
  rounded(ctx, x, y, bw, bh, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Barras de cor dos times
  ctx.fillStyle = colors[0].primary;
  rounded(ctx, x, y, 8, bh, 4);
  ctx.fill();
  ctx.fillStyle = colors[1].primary;
  rounded(ctx, x + bw - 8, y, 8, bh, 4);
  ctx.fill();

  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = '#e8eefc';
  ctx.textAlign = 'left';
  ctx.fillText(sim.teams[0].identity.abbreviation, x + 18, y + bh / 2 - 6);
  ctx.textAlign = 'right';
  ctx.fillText(sim.teams[1].identity.abbreviation, x + bw - 18, y + bh / 2 - 6);

  ctx.font = 'bold 27px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(t0.points), x + 66, y + bh / 2 - 4);
  ctx.textAlign = 'right';
  ctx.fillText(String(t1.points), x + bw - 66, y + bh / 2 - 4);

  ctx.textAlign = 'center';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(formatClock(sim.clock), x + bw / 2, y + bh / 2 - 7);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(200,215,240,0.8)';
  const periodLabel = sim.period > 4 ? `PRO ${sim.period - 4}` : `${sim.period}o PERIODO`;
  ctx.fillText(periodLabel, x + bw / 2, y + bh / 2 + 11);

  // Relogio de posse
  const sc = Math.max(0, sim.possession.shotClock);
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillStyle = sc <= 5 ? '#ff6b5e' : '#ffd166';
  ctx.textAlign = 'left';
  ctx.fillText(sc.toFixed(sc < 5 ? 1 : 0), x + 118, y + bh / 2 + 12);

  // Faltas de equipe
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(190,205,230,0.7)';
  ctx.textAlign = 'left';
  ctx.fillText(`FALTAS ${t0.teamFoulsThisPeriod}`, x + 18, y + bh / 2 + 13);
  ctx.textAlign = 'right';
  ctx.fillText(`${t1.teamFoulsThisPeriod} FALTAS`, x + bw - 18, y + bh / 2 + 13);
  ctx.restore();
}

/**
 * SHOT METER de ritmo (secao 18). Mostra a fase do movimento, a janela verde
 * (que muda de tamanho conforme contest e ritmo) e o ponto de soltura.
 */
export function drawShotMeter(ctx: Ctx, hud: HudState, x: number, y: number): void {
  if (!hud.showMeter) return;
  const w = 168;
  const h = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,22,0.8)';
  rounded(ctx, x - w / 2, y, w, h, 6);
  ctx.fill();

  // Janela verde
  const gw = clamp(hud.meterWindow, 0.02, 0.5) * w;
  const gx = x - w / 2 + hud.meterIdeal * w - gw / 2;
  ctx.fillStyle = 'rgba(94,230,140,0.85)';
  rounded(ctx, gx, y, gw, h, 5);
  ctx.fill();

  // Preenchimento atual
  ctx.fillStyle = 'rgba(235,240,255,0.92)';
  rounded(ctx, x - w / 2, y, clamp01(hud.meterValue) * w, h * 0.42, 3);
  ctx.fill();

  // Marcador
  const mx = x - w / 2 + clamp01(hud.meterValue) * w;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx, y - 3);
  ctx.lineTo(mx, y + h + 3);
  ctx.stroke();
  ctx.restore();
}

export function drawShotFeedback(ctx: Ctx, hud: HudState, w: number, h: number, now: number): void {
  const s = hud.lastShot;
  if (!s || now - s.at > 2.2) return;
  const alpha = clamp01(1 - (now - s.at) / 2.2);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px system-ui, sans-serif';
  const color = s.timing === 'perfect' ? '#5ee68c' : s.timing === 'early' ? '#ffd166' : '#ff8a5e';
  ctx.fillStyle = color;
  const label = s.timing === 'perfect' ? 'TIMING PERFEITO' : s.timing === 'early' ? 'CEDO' : 'TARDE';
  ctx.fillText(label, w / 2, h - 96);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(220,230,250,0.9)';
  ctx.fillText(`marcacao: ${s.contest} · chance ${(s.probability * 100).toFixed(0)}%`, w / 2, h - 78);
  ctx.restore();
}

/** Painel do atleta controlado: stamina, adrenalina, takeover. */
export function drawPlayerPanel(ctx: Ctx, a: Actor, sim: GameSim, x: number, y: number): void {
  ctx.save();
  const w = 226;
  const h = 96;
  ctx.fillStyle = 'rgba(8,11,18,0.78)';
  rounded(ctx, x, y, w, h, 10);
  ctx.fill();

  ctx.fillStyle = '#e8eefc';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${a.profile.jersey} ${a.profile.lastName}`, x + 12, y + 16);

  bar(ctx, x + 12, y + 28, w - 24, 7, a.stamina, '#5ee68c', 'ENERGIA');
  bar(ctx, x + 12, y + 44, w - 24, 7, a.adrenaline, '#6cc8ff', 'ADRENALINA');

  // Takeover: somente disciplinas que ja sairam do zero.
  let ty = y + 60;
  for (const cat of TAKEOVER_CATEGORIES) {
    const v = a.takeover[cat];
    if (v < 0.04 && a.activeTakeover !== cat) continue;
    const st = takeoverState(v, sim.t);
    const color = a.activeTakeover === cat ? '#ffd166' : st === 'hot' ? '#ff8a5e' : st === 'warm' ? '#f2c14e' : '#6f7d99';
    bar(ctx, x + 12, ty, w - 24, 5, a.activeTakeover === cat ? a.takeoverEnergy : v, color, TAKEOVER_LABELS[cat]);
    ty += 13;
    if (ty > y + h - 8) break;
  }
  ctx.restore();
}

function bar(ctx: Ctx, x: number, y: number, w: number, h: number, value: number, color: string, label: string): void {
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  rounded(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  rounded(ctx, x, y, Math.max(2, w * clamp01(value)), h, h / 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(210,220,240,0.62)';
  ctx.font = '8px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 2, y - 3);
}

/** Ticker de apresentacao: ultimas jogadas relevantes. */
export function drawTicker(ctx: Ctx, events: readonly GameEvent[], w: number, h: number): void {
  const recent = events.slice(-3).reverse();
  if (!recent.length) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = h - 26;
  for (const e of recent) {
    if (!e.text) continue;
    ctx.fillStyle = 'rgba(8,11,18,0.7)';
    const text = e.text;
    ctx.font = '12px system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 18;
    rounded(ctx, 16, y - 9, tw, 18, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(225,235,255,0.9)';
    ctx.fillText(text, 25, y);
    y -= 22;
  }
  ctx.restore();
}

/** Indicador de matchup e cobertura ativa. */
export function drawMatchupInfo(ctx: Ctx, sim: GameSim, w: number): void {
  const handler = sim.ballHandler();
  if (!handler) return;
  const def = sim.actorById(handler.markedById ?? '');
  ctx.save();
  ctx.textAlign = 'right';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(205,220,245,0.75)';
  const gp = sim.gameplanOf((1 - handler.team) as 0 | 1);
  ctx.fillText(`cobertura: ${gp.pnrCoverage} · ajuda: ${(gp.helpAggression * 100).toFixed(0)}%`, w - 18, 86);
  if (def) ctx.fillText(`${handler.profile.lastName} x ${def.profile.lastName}`, w - 18, 102);
  ctx.restore();
}

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
