/**
 * TEXTURA DA QUADRA.
 *
 * As marcacoes da quadra sao desenhadas UMA vez, de cima, num canvas 2D, e
 * viram textura. Fazer as linhas como geometria custaria centenas de quads
 * finos com z-fighting contra o piso; como textura, sai de graca e com
 * antialiasing do mipmap.
 *
 * O veio da madeira entra aqui tambem: tabuas com direcao e tom variando, que
 * e o que da escala ao piso. Sem veio, uma quadra grande parece uma laje.
 */
import { COURT } from '../../core/config/court.js';

/** Pixels por metro. 28,65 m x 32 = 917 px de comprimento. */
const PPM = 36;

export function paintCourtTexture(homeColor: string, accent: string): HTMLCanvasElement {
  const W = Math.round(COURT.length * PPM);
  const H = Math.round(COURT.width * PPM);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const mx = (x: number): number => x * PPM;
  const my = (y: number): number => y * PPM;

  // --- Madeira -------------------------------------------------------------
  ctx.fillStyle = '#cb9153';
  ctx.fillRect(0, 0, W, H);

  // Tabuas ao longo do comprimento, com tom alternando de leve.
  const plank = 0.14 * PPM * 2.2;
  for (let y = 0; y < H; y += plank) {
    const t = Math.sin(y * 0.37) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(${Math.round(150 + t * 26)},${Math.round(98 + t * 20)},${Math.round(46 + t * 14)},0.35)`;
    ctx.fillRect(0, y, W, plank * 0.92);
  }
  // Veio: riscos longos e finos.
  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = '#5b3410';
  ctx.lineWidth = 1;
  for (let i = 0; i < 520; i++) {
    const y = (Math.sin(i * 91.7) * 0.5 + 0.5) * H;
    const x = (Math.sin(i * 17.3) * 0.5 + 0.5) * W;
    const len = 40 + (Math.sin(i * 5.1) * 0.5 + 0.5) * 220;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y + Math.sin(i) * 2.5, x + len, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // --- Garrafao ------------------------------------------------------------
  const paintW = COURT.paintWidth;
  const paintD = COURT.paintDepth;
  ctx.fillStyle = hexAlpha(homeColor, 0.3);
  ctx.fillRect(0, my(COURT.width / 2 - paintW / 2), mx(paintD), my(paintW));
  ctx.fillRect(mx(COURT.length - paintD), my(COURT.width / 2 - paintW / 2), mx(paintD), my(paintW));

  // --- Linhas --------------------------------------------------------------
  ctx.strokeStyle = '#f4f7fb';
  ctx.lineWidth = 0.05 * PPM * 1.6;
  ctx.lineJoin = 'round';

  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.beginPath();
    ctx.moveTo(mx(x1), my(y1));
    ctx.lineTo(mx(x2), my(y2));
    ctx.stroke();
  };
  const rect = (x: number, y: number, w: number, h: number): void => {
    ctx.strokeRect(mx(x), my(y), mx(w), my(h));
  };
  const circle = (x: number, y: number, r: number, from = 0, to = Math.PI * 2): void => {
    ctx.beginPath();
    ctx.arc(mx(x), my(y), mx(r), from, to);
    ctx.stroke();
  };

  // Perimetro e meio.
  rect(0, 0, COURT.length, COURT.width);
  line(COURT.length / 2, 0, COURT.length / 2, COURT.width);
  circle(COURT.length / 2, COURT.width / 2, COURT.centerCircleRadius);

  for (const side of [0, 1] as const) {
    const base = side === 0 ? 0 : COURT.length;
    const dir = side === 0 ? 1 : -1;
    const hoopX = base + dir * COURT.hoopFromBaseline;
    const mid = COURT.width / 2;

    // Garrafao e linha de lance livre.
    rect(side === 0 ? 0 : COURT.length - paintD, mid - paintW / 2, paintD, paintW);
    circle(base + dir * COURT.freeThrowLineFromBaseline, mid, COURT.freeThrowCircleRadius);

    // Area restrita sob a cesta.
    circle(hoopX, mid, COURT.restrictedRadius,
      side === 0 ? -Math.PI / 2 : Math.PI / 2,
      side === 0 ? Math.PI / 2 : (Math.PI * 3) / 2);

    // Tres pontos: cantos retos ate a altura em que o arco os encontra.
    const cornerY = COURT.threeCornerY;
    const r = COURT.threeArcRadius;
    const dx = Math.sqrt(Math.max(0, r * r - Math.pow(mid - cornerY - mid, 2)));
    void dx;
    // Onde o arco cruza a linha do canto.
    const yOff = mid - cornerY;
    const xAtCorner = Math.sqrt(Math.max(0, r * r - yOff * yOff));
    const cornerX = hoopX + dir * xAtCorner;
    line(base, cornerY, cornerX, cornerY);
    line(base, COURT.width - cornerY, cornerX, COURT.width - cornerY);
    const a0 = Math.atan2(cornerY - mid, cornerX - hoopX);
    const a1 = Math.atan2(COURT.width - cornerY - mid, cornerX - hoopX);
    ctx.beginPath();
    ctx.arc(mx(hoopX), my(mid), mx(r), a0, a1, side === 1);
    ctx.stroke();
  }

  // Logo central: circulo com a cor de destaque, discreto.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(mx(COURT.length / 2), my(COURT.width / 2), mx(COURT.centerCircleRadius * 0.82), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return c;
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
