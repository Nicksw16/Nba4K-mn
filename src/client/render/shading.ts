/**
 * VOLUME E LUZ (secoes 40 e 100).
 *
 * Canvas 2D nao tem rasterizador de triangulo com z-buffer, entao nao da para
 * fingir um PBR completo. Mas o que faz um corpo parecer solido nao e o
 * modelo de iluminacao ser fisicamente exato: e ter (1) volume cilindrico em
 * vez de traco chapado, (2) uma direcao de luz consistente entre corpo,
 * sombra e chao, e (3) contraluz separando a silhueta do fundo. As tres
 * coisas cabem aqui.
 *
 * Cada osso vira uma capsula: poligono da silhueta em tela, preenchido com um
 * gradiente PERPENDICULAR ao eixo. O gradiente e a secao transversal do
 * cilindro -- claro na beirada virada para a luz, terminador no meio, escuro
 * do outro lado, e um fio de contraluz na borda oposta. Uma passada de
 * preenchimento por osso, entao dez atletas custam ~130 preenchimentos.
 */
import { Vec3, v3, sub3, norm3 } from '../../core/math/vec.js';
import { clamp, clamp01, lerp } from '../../core/math/util.js';
import { Projection } from './camera.js';

type Ctx = CanvasRenderingContext2D;

/** Luz da arena: refletores altos, frios, um pouco a frente da mesa. */
export interface Light {
  /** Direcao DA luz para a cena, normalizada. */
  dir: Vec3;
  /** Quanto a luz principal acrescenta no topo do termo difuso. */
  key: number;
  /** Piso de luz: o que a quadra clara devolve por baixo. */
  ambient: number;
  /** Contraluz: separa a silhueta do fundo escuro. */
  rim: number;
  /** Cor do contraluz (LED da arena). */
  rimColor: [number, number, number];
}

export const ARENA_LIGHT: Light = {
  // Vem de cima, de tras da camera e um pouco da direita: e o esquema de
  // refletor de ginasio, que da sombra curta e definida sob o atleta.
  dir: norm3(v3(0.28, 0.42, -0.86)),
  key: 0.82,
  ambient: 0.34,
  rim: 0.55,
  rimColor: [150, 190, 255],
};

// ---------------------------------------------------------------- cor

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbStr = (c: RGB, alpha = 1): string =>
  alpha >= 1
    ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`
    : `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha.toFixed(3)})`;

/** Multiplica mantendo o matiz; `t` > 1 clareia em direcao ao branco. */
export function tone(c: RGB, t: number): RGB {
  if (t <= 1) return [c[0] * t, c[1] * t, c[2] * t];
  const k = Math.min(1, t - 1);
  return [lerp(c[0], 255, k), lerp(c[1], 255, k), lerp(c[2], 255, k)];
}

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];

// ---------------------------------------------------------------- iluminacao

/**
 * Direcao da luz projetada na tela. Serve para saber de que lado do osso a
 * luz bate, ja que a secao transversal do cilindro e resolvida em 2D.
 */
export function lightScreenDir(proj: Projection, light: Light, at: Vec3): { x: number; y: number; toward: number } {
  const p0 = proj.project(at);
  const p1 = proj.project(v3(at.x - light.dir.x, at.y - light.dir.y, at.z - light.dir.z));
  if (!p0 || !p1) return { x: 0, y: -1, toward: 0.5 };
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return { x: 0, y: -1, toward: 1 };
  // `toward` = quanto a luz vem na direcao da camera (1) ou de lado (0).
  // Com a luz quase de frente o cilindro fica quase todo claro.
  const toward = clamp01(1 - len / (Math.abs(p0.scale) * 1.2 + 1e-4));
  return { x: dx / len, y: dy / len, toward };
}

/** Termo difuso de uma normal qualquer contra a luz. */
export function diffuse(normal: Vec3, light: Light): number {
  const d = -(normal.x * light.dir.x + normal.y * light.dir.y + normal.z * light.dir.z);
  return light.ambient + Math.max(0, d) * light.key;
}

// ---------------------------------------------------------------- capsula

interface Seg { ax: number; ay: number; bx: number; by: number; rA: number; rB: number; }

/** Silhueta de uma capsula em tela: dois circulos ligados pelas tangentes. */
function capsulePath(ctx: Ctx, s: Seg): void {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const d = Math.hypot(dx, dy);
  ctx.beginPath();
  if (d < 1e-3) {
    ctx.arc(s.ax, s.ay, Math.max(s.rA, s.rB), 0, Math.PI * 2);
    return;
  }
  const ux = dx / d;
  const uy = dy / d;
  // Angulo das tangentes externas para raios diferentes (tronco de cone).
  const dr = s.rA - s.rB;
  const cosA = clamp(dr / d, -1, 1);
  const ang = Math.acos(cosA);
  const base = Math.atan2(uy, ux);
  ctx.arc(s.ax, s.ay, s.rA, base + ang, base - ang + Math.PI * 2);
  ctx.arc(s.bx, s.by, s.rB, base - ang, base + ang);
  ctx.closePath();
}

/**
 * Desenha um osso como cilindro iluminado.
 *
 * O gradiente atravessa o osso na perpendicular. As paradas sao a secao do
 * cilindro: a beirada virada para a luz recebe difuso quase total, o meio
 * recebe o terminador e a beirada oposta cai para o ambiente, com o fio de
 * contraluz por ultimo.
 */
export function drawBone(
  ctx: Ctx,
  seg: Seg,
  base: RGB,
  light: Light,
  ls: { x: number; y: number; toward: number },
  opts: { rim?: number; gloss?: number } = {},
): void {
  const r = Math.max(seg.rA, seg.rB);
  if (r < 0.35) return;

  // Perpendicular ao osso, em tela.
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const d = Math.hypot(dx, dy) || 1;
  let px = -dy / d;
  let py = dx / d;
  // A perpendicular tem que apontar PARA a luz.
  if (px * ls.x + py * ls.y > 0) { px = -px; py = -py; }

  const cx = (seg.ax + seg.bx) / 2;
  const cy = (seg.ay + seg.by) / 2;
  const g = ctx.createLinearGradient(cx + px * r, cy + py * r, cx - px * r, cy - py * r);

  // Luz de frente achata o terminador; luz de lado o empurra para a borda.
  const term = lerp(0.36, 0.72, ls.toward);
  const lit = light.ambient + light.key * lerp(0.86, 1, ls.toward);
  const mid = light.ambient + light.key * 0.42;
  const dark = light.ambient * 0.82;

  g.addColorStop(0, rgbStr(tone(base, lit)));
  g.addColorStop(term, rgbStr(tone(base, mid)));
  g.addColorStop(0.88, rgbStr(tone(base, dark)));

  const rimK = (opts.rim ?? 1) * light.rim;
  if (rimK > 0.01) {
    g.addColorStop(0.955, rgbStr(mixRgb(tone(base, dark), light.rimColor, rimK * 0.5)));
    g.addColorStop(1, rgbStr(mixRgb(tone(base, dark * 1.1), light.rimColor, rimK)));
  } else {
    g.addColorStop(1, rgbStr(tone(base, dark)));
  }

  capsulePath(ctx, seg);
  ctx.fillStyle = g;
  ctx.fill();

  // Realce especular estreito em material brilhante (tenis, ombro do uniforme).
  const gloss = opts.gloss ?? 0;
  if (gloss > 0.01 && r > 2.2) {
    ctx.save();
    capsulePath(ctx, seg);
    ctx.clip();
    const hx = cx + px * r * 0.52;
    const hy = cy + py * r * 0.52;
    const hg = ctx.createLinearGradient(hx + px * r * 0.4, hy + py * r * 0.4, hx - px * r * 0.5, hy - py * r * 0.5);
    hg.addColorStop(0, `rgba(255,255,255,${(gloss * 0.5).toFixed(3)})`);
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
    ctx.restore();
  }
}

/** Esfera iluminada: cabeca e bola usam a mesma conta. */
export function drawSphere(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  base: RGB,
  light: Light,
  ls: { x: number; y: number; toward: number },
  opts: { rim?: number; gloss?: number } = {},
): void {
  if (r < 0.4) return;
  const hx = x + ls.x * -r * 0.42;
  const hy = y + ls.y * -r * 0.42;
  const g = ctx.createRadialGradient(hx, hy, r * 0.06, x, y, r * 1.06);
  g.addColorStop(0, rgbStr(tone(base, light.ambient + light.key * 1.04)));
  g.addColorStop(0.46, rgbStr(tone(base, light.ambient + light.key * 0.6)));
  g.addColorStop(1, rgbStr(tone(base, light.ambient * 0.8)));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  const rimK = (opts.rim ?? 1) * light.rim;
  if (rimK > 0.01) {
    // Contraluz: arco fino do lado oposto a luz.
    const ang = Math.atan2(ls.y, ls.x);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.965, ang - 1.15, ang + 1.15);
    ctx.strokeStyle = rgbStr(light.rimColor, rimK * 0.75);
    ctx.lineWidth = Math.max(0.6, r * 0.13);
    ctx.stroke();
    ctx.restore();
  }

  const gloss = opts.gloss ?? 0;
  if (gloss > 0.01 && r > 2) {
    ctx.beginPath();
    ctx.ellipse(hx, hy, r * 0.26, r * 0.19, ang2(ls), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(gloss * 0.55).toFixed(3)})`;
    ctx.fill();
  }
}

const ang2 = (ls: { x: number; y: number }): number => Math.atan2(ls.y, ls.x);

// ---------------------------------------------------------------- sombra

/**
 * Projeta um ponto do mundo no chao NA DIRECAO DA LUZ.
 *
 * E o que amarra corpo e chao: a sombra cai para onde a luz manda, nao
 * simplesmente embaixo. Quem esta no ar tem sombra deslocada e mais fraca, e
 * e assim que a altura do salto fica legivel.
 */
export function shadowPoint(p: Vec3, light: Light): Vec3 {
  if (light.dir.z >= -1e-3) return v3(p.x, p.y, 0);
  const t = p.z / -light.dir.z;
  return v3(p.x + light.dir.x * t, p.y + light.dir.y * t, 0.004);
}

/**
 * Opacidade da sombra: quanto mais alto o corpo, mais difusa e fraca.
 * Ginasio tem varios refletores, entao a sombra nunca e solida -- o que a
 * torna crivel e a direcao certa, nao a intensidade.
 */
export const shadowAlpha = (height: number): number => clamp01(0.26 - height * 0.09);
