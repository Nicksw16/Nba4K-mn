/**
 * RENDERER (secoes 36, 40, 100, 129).
 *
 * Canvas 2D com projecao perspectiva de verdade (ver camera.ts). Cada corpo e
 * desenhado a partir do estado FISICO do ator: posicao dos pes, altura do
 * quadril, inclinacao pela aceleracao, orientacao do tronco e do quadril.
 * Nada aqui inventa movimento - o desenho e consequencia da simulacao.
 */
import { Vec2, Vec3, v2, v3, add2, len2, mul2, norm2, sub2, toAngle, angleDiff, fromAngle } from '../../core/math/vec.js';
import { clamp, clamp01, lerp } from '../../core/math/util.js';
import { COURT, Side, hoopGround, hoopPos, backboardPlaneX } from '../../core/config/court.js';
import { Projection } from './camera.js';
import { Actor } from '../../core/sim/actor.js';
import { Ball } from '../../core/sim/ball.js';
import { standingReach } from '../../core/model/attributes.js';
import { BodyInfo, drawBody, drawBodyReflection, drawBodyShadow } from './body.js';
import { ARENA_LIGHT, drawSphere, hexToRgb, lightScreenDir } from './shading.js';

export interface TeamColors {
  primary: string;
  secondary: string;
  accent: string;
}

export interface RenderOptions {
  showPlayArt: boolean;
  showNames: boolean;
  showIndicators: boolean;
  showDebug: boolean;
  immersion: boolean;
  quality: 'low' | 'medium' | 'high';
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showPlayArt: true,
  showNames: true,
  showIndicators: true,
  showDebug: false,
  immersion: false,
  quality: 'high',
};

type Ctx = CanvasRenderingContext2D;

export function drawArena(ctx: Ctx, w: number, h: number, options: RenderOptions): void {
  // Atmosfera: arquibancada escura com luz concentrada na quadra.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#05070d');
  g.addColorStop(0.55, '#0a0f1a');
  g.addColorStop(1, '#05070d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (options.quality !== 'low') {
    // Publico sugerido por ruido de pontos - barato e legivel a distancia.
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 480; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12345.6789) % 1;
      const px = Math.abs(x) * w;
      const py = Math.abs(y) * h * 0.42;
      const s = 1 + (Math.abs(x * y) % 1) * 1.6;
      ctx.fillStyle = i % 7 === 0 ? '#2a3550' : i % 3 === 0 ? '#1b2436' : '#141a28';
      ctx.fillRect(px, py, s, s);
    }
    ctx.restore();
  }
}

function poly(ctx: Ctx, proj: Projection, pts: Vec3[], close = true): boolean {
  let started = false;
  for (const p of pts) {
    const s = proj.project(p);
    if (!s) return false;
    if (!started) {
      ctx.moveTo(s.x, s.y);
      started = true;
    } else {
      ctx.lineTo(s.x, s.y);
    }
  }
  if (close) ctx.closePath();
  return started;
}

function arcPoints(center: Vec2, radius: number, from: number, to: number, steps: number, z = 0.01): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = lerp(from, to, i / steps);
    pts.push(v3(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius, z));
  }
  return pts;
}

export function drawCourt(ctx: Ctx, proj: Projection, options: RenderOptions, homeColors: TeamColors): void {
  const z = 0.012;
  // Piso
  ctx.beginPath();
  if (poly(ctx, proj, [v3(0, 0, 0), v3(COURT.length, 0, 0), v3(COURT.length, COURT.width, 0), v3(0, COURT.width, 0)])) {
    const grad = ctx.createLinearGradient(0, 0, proj.width, proj.height);
    grad.addColorStop(0, '#9a6633');
    grad.addColorStop(0.45, '#b8803f');
    grad.addColorStop(1, '#8a5a2c');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Veio da madeira
  if (options.quality === 'high') {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#5d3a17';
    ctx.lineWidth = 1;
    for (let y = 0.6; y < COURT.width; y += 0.62) {
      ctx.beginPath();
      poly(ctx, proj, [v3(0, y, 0), v3(COURT.length, y, 0)], false);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Garrafoes pintados
  for (const side of [0, 1] as Side[]) {
    const x0 = side === 0 ? 0 : COURT.length - COURT.paintDepth;
    const x1 = side === 0 ? COURT.paintDepth : COURT.length;
    ctx.beginPath();
    if (poly(ctx, proj, [
      v3(x0, COURT.width / 2 - COURT.paintWidth / 2, z),
      v3(x1, COURT.width / 2 - COURT.paintWidth / 2, z),
      v3(x1, COURT.width / 2 + COURT.paintWidth / 2, z),
      v3(x0, COURT.width / 2 + COURT.paintWidth / 2, z),
    ])) {
      ctx.fillStyle = side === 0 ? `${homeColors.primary}66` : `${homeColors.secondary}44`;
      ctx.fill();
    }
  }

  ctx.strokeStyle = '#f4efe6';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  const lines: Vec3[][] = [];
  // Limites
  lines.push([v3(0, 0, z), v3(COURT.length, 0, z), v3(COURT.length, COURT.width, z), v3(0, COURT.width, z), v3(0, 0, z)]);
  // Meio
  lines.push([v3(COURT.length / 2, 0, z), v3(COURT.length / 2, COURT.width, z)]);
  // Circulo central
  lines.push(arcPoints(v2(COURT.length / 2, COURT.width / 2), COURT.centerCircleRadius / 2, 0, Math.PI * 2, 48, z));

  for (const side of [0, 1] as Side[]) {
    const hoop = hoopGround(side);
    const dir = side === 0 ? 1 : -1;
    // Garrafao
    const px0 = side === 0 ? 0 : COURT.length;
    const px1 = px0 + dir * COURT.paintDepth;
    lines.push([
      v3(px0, COURT.width / 2 - COURT.paintWidth / 2, z),
      v3(px1, COURT.width / 2 - COURT.paintWidth / 2, z),
      v3(px1, COURT.width / 2 + COURT.paintWidth / 2, z),
      v3(px0, COURT.width / 2 + COURT.paintWidth / 2, z),
    ]);
    // Circulo do lance livre
    lines.push(arcPoints(v2(px1, COURT.width / 2), COURT.freeThrowCircleRadius / 2, 0, Math.PI * 2, 36, z));
    // Area restritiva: o semicirculo precisa abrir para DENTRO da quadra.
    // Interpolar do angulo errado desenhava o arco por tras da tabela.
    const baseAngle = side === 0 ? -Math.PI / 2 : Math.PI / 2;
    lines.push(arcPoints(v2(hoop.x, hoop.y), COURT.restrictedRadius, baseAngle, baseAngle + Math.PI, 24, z));

    // Linha de tres: cantos retos + arco
    const cornerY0 = COURT.threeCornerY;
    const cornerY1 = COURT.width - COURT.threeCornerY;
    const dx = Math.sqrt(Math.max(0, COURT.threeArcRadius ** 2 - (COURT.width / 2 - COURT.threeCornerY) ** 2));
    const breakX = hoop.x + dir * dx;
    lines.push([v3(px0, cornerY0, z), v3(breakX, cornerY0, z)]);
    lines.push([v3(px0, cornerY1, z), v3(breakX, cornerY1, z)]);
    let a0 = Math.atan2(cornerY0 - hoop.y, breakX - hoop.x);
    let a1 = Math.atan2(cornerY1 - hoop.y, breakX - hoop.x);
    // O arco tem de passar pelo lado da quadra, nao por tras da cesta.
    if (side === 1) {
      const tmp = a1;
      a1 = a0 < 0 ? a0 + Math.PI * 2 : a0;
      a0 = tmp;
    }
    lines.push(arcPoints(v2(hoop.x, hoop.y), COURT.threeArcRadius, a0, a1, 56, z));
  }

  for (const l of lines) {
    ctx.beginPath();
    poly(ctx, proj, l, false);
    ctx.stroke();
  }
}

export function drawHoops(ctx: Ctx, proj: Projection): void {
  for (const side of [0, 1] as Side[]) {
    const hoop = hoopPos(side);
    const planeX = backboardPlaneX(side);
    const halfW = COURT.backboardWidth / 2;

    // Tabela
    ctx.beginPath();
    if (poly(ctx, proj, [
      v3(planeX, COURT.width / 2 - halfW, COURT.backboardBottom),
      v3(planeX, COURT.width / 2 + halfW, COURT.backboardBottom),
      v3(planeX, COURT.width / 2 + halfW, COURT.backboardBottom + COURT.backboardHeight),
      v3(planeX, COURT.width / 2 - halfW, COURT.backboardBottom + COURT.backboardHeight),
    ])) {
      ctx.fillStyle = 'rgba(225, 238, 255, 0.16)';
      ctx.fill();
      ctx.strokeStyle = '#e8f1ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Quadrado interno
    ctx.beginPath();
    if (poly(ctx, proj, [
      v3(planeX, COURT.width / 2 - 0.29, COURT.rimHeight - 0.02),
      v3(planeX, COURT.width / 2 + 0.29, COURT.rimHeight - 0.02),
      v3(planeX, COURT.width / 2 + 0.29, COURT.rimHeight + 0.43),
      v3(planeX, COURT.width / 2 - 0.29, COURT.rimHeight + 0.43),
    ])) {
      ctx.strokeStyle = '#ff8a3d';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Aro
    ctx.beginPath();
    poly(ctx, proj, arcPoints(v2(hoop.x, hoop.y), COURT.rimRadius, 0, Math.PI * 2, 28, COURT.rimHeight), true);
    ctx.strokeStyle = '#ff6b1f';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Rede
    ctx.strokeStyle = 'rgba(245,245,245,0.55)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      poly(ctx, proj, [
        v3(hoop.x + Math.cos(a) * COURT.rimRadius, hoop.y + Math.sin(a) * COURT.rimRadius, COURT.rimHeight),
        v3(hoop.x + Math.cos(a) * COURT.rimRadius * 0.55, hoop.y + Math.sin(a) * COURT.rimRadius * 0.55, COURT.rimHeight - 0.42),
      ], false);
      ctx.stroke();
    }
  }
}

/** O que o desenho precisa saber de cada atleta em quadra. */
export type ActorRenderInfo = BodyInfo;

/**
 * Sombras de todos primeiro, depois os corpos por profundidade.
 *
 * A ordem importa por dois motivos: uma sombra nunca pode cair por cima de um
 * corpo, e um atleta mais perto tem que cobrir um mais longe. O resto (qual
 * osso na frente de qual) e resolvido dentro de drawBody.
 */
export function drawActors(
  ctx: Ctx,
  proj: Projection,
  infos: ActorRenderInfo[],
  options: RenderOptions,
  ball: Vec3 | null,
  time: number,
): void {
  // Reflexo primeiro, recortado na quadra: e o que esta DENTRO do piso.
  if (options.quality === 'high') {
    ctx.save();
    ctx.beginPath();
    if (poly(ctx, proj, [v3(0, 0, 0), v3(COURT.length, 0, 0), v3(COURT.length, COURT.width, 0), v3(0, COURT.width, 0)])) {
      ctx.clip();
      for (const info of infos) {
        drawBodyReflection(ctx, proj, info, info.isBallHandler ? ball : null, ARENA_LIGHT, time);
      }
    }
    ctx.restore();
  }

  for (const info of infos) {
    drawBodyShadow(ctx, proj, info.actor, info.isBallHandler ? ball : null, ARENA_LIGHT, time, options.quality);
  }

  const sorted = infos
    .map((info) => ({ info, p: proj.project(v3(info.actor.pos.x, info.actor.pos.y, 1)) }))
    .filter((x) => x.p !== null)
    .sort((x, y) => (y.p!.depth - x.p!.depth));

  for (const { info } of sorted) {
    drawBody(ctx, proj, info, info.isBallHandler ? ball : null, ARENA_LIGHT, time, {
      names: options.showNames,
      indicators: options.showIndicators,
      immersion: options.immersion,
      quality: options.quality,
    });
    if (options.showDebug) drawActorDebug(ctx, proj, info.actor);
  }
}

/** Vetores de estado por cima do corpo (secao 138). */
function drawActorDebug(ctx: Ctx, proj: Projection, a: Actor): void {
  const foot = proj.project(v3(a.pos.x, a.pos.y, 0.05));
  if (!foot) return;
  ctx.save();
  ctx.lineWidth = 1.4;
  const dir = fromAngle(a.heading, 1.2);
  const tip = proj.project(v3(a.pos.x + dir.x, a.pos.y + dir.y, 0.05));
  if (tip) {
    ctx.strokeStyle = 'rgba(120,220,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }
  // Deslocamento de peso: a causa do ankle breaker, visivel.
  const ws = proj.project(v3(a.pos.x + a.weightShift.x * 2.4, a.pos.y + a.weightShift.y * 2.4, 0.05));
  if (ws) {
    ctx.strokeStyle = 'rgba(255,140,80,0.9)';
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(ws.x, ws.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Retorno do mouse na quadra (secao 135: o que responde tem que aparecer).
 *
 * Um anel no ponto apontado e um losango sobre o companheiro sob o cursor.
 * Sem esse retorno o passe por clique seria adivinhacao: a pessoa clica e
 * torce. Com ele, da para mirar antes de apertar.
 */
export function drawPointer(
  ctx: Ctx,
  proj: Projection,
  ground: { x: number; y: number } | null,
  target: { x: number; y: number } | null,
  time: number,
): void {
  if (ground) {
    const p = proj.project(v3(ground.x, ground.y, 0.02));
    if (p) {
      const r = p.scale * 0.22;
      ctx.save();
      ctx.strokeStyle = 'rgba(190,215,255,0.55)';
      ctx.lineWidth = Math.max(1, p.scale * 0.012);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (target) {
    const p = proj.project(v3(target.x, target.y, 2.35));
    if (!p) return;
    const s = Math.max(5, p.scale * 0.085);
    const bob = Math.sin(time * 5) * s * 0.16;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.fillStyle = 'rgba(126,246,192,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, s);
    ctx.lineTo(-s * 0.62, 0);
    ctx.lineTo(0, -s);
    ctx.lineTo(s * 0.62, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export function drawBall(ctx: Ctx, proj: Projection, ball: Ball, time: number): void {
  const s = proj.project(ball.pos);
  if (!s) return;
  // Sombra da bola no chao
  const shadow = proj.project(v3(ball.pos.x, ball.pos.y, 0.012));
  if (shadow) {
    ctx.save();
    ctx.globalAlpha = clamp01(0.4 - ball.pos.z * 0.06);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(shadow.x, shadow.y, s.scale * 0.13, s.scale * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const r = Math.max(2.2, s.scale * 0.12);
  const g = ctx.createRadialGradient(s.x - r * 0.35, s.y - r * 0.35, r * 0.15, s.x, s.y, r);
  g.addColorStop(0, '#f2a25c');
  g.addColorStop(1, '#c55f1c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  // Linhas da bola giram com o spin.
  ctx.strokeStyle = 'rgba(40,20,10,0.75)';
  ctx.lineWidth = Math.max(0.6, r * 0.12);
  const spin = time * 4 + ball.spin.y * 0.08;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, r, r * Math.abs(Math.cos(spin)), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s.x - r, s.y);
  ctx.lineTo(s.x + r, s.y);
  ctx.stroke();
}

/** PLAY ART (secao 95): setas do que a jogada esta pedindo. */
export function drawPlayArt(
  ctx: Ctx,
  proj: Projection,
  routes: { from: Vec2; to: Vec2; kind: string }[],
): void {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  for (const r of routes) {
    const a = proj.project(v3(r.from.x, r.from.y, 0.05));
    const b = proj.project(v3(r.to.x, r.to.y, 0.05));
    if (!a || !b) continue;
    ctx.strokeStyle = r.kind === 'screen' ? 'rgba(255,205,110,0.8)'
      : r.kind === 'cut' || r.kind === 'roll' ? 'rgba(120,240,180,0.8)'
      : 'rgba(150,190,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Ponta
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(ang - 0.4) * 9, b.y - Math.sin(ang - 0.4) * 9);
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(ang + 0.4) * 9, b.y - Math.sin(ang + 0.4) * 9);
    ctx.stroke();
    ctx.setLineDash([7, 5]);
  }
  ctx.restore();
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
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

/** Clareia (t>0) ou escurece (t<0) uma cor hex. */
export function shade(hex: string, t: number): string {
  const c = hex.replace('#', '');
  const num = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;
  if (t >= 0) {
    r = Math.round(lerp(r, 255, t));
    g = Math.round(lerp(g, 255, t));
    b = Math.round(lerp(b, 255, t));
  } else {
    r = Math.round(lerp(r, 0, -t));
    g = Math.round(lerp(g, 0, -t));
    b = Math.round(lerp(b, 0, -t));
  }
  return `rgb(${r},${g},${b})`;
}
