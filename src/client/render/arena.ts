/**
 * ARENA (secoes 39 e 107: broadcast presentation).
 *
 * A quadra flutuava num vazio preto. Uma quadra sem ginasio em volta nao tem
 * escala: nada diz se o atleta tem dois metros ou vinte centimetros, e a
 * camera de transmissao perde a referencia que a faz parecer transmissao.
 *
 * Tudo aqui e geometria de verdade no mundo, projetada pela mesma camera que
 * projeta os corpos -- nao ha camada 2D colada na tela fingindo profundidade.
 * O publico e instanciado a partir de uma semente fixa, entao cada assento
 * tem sempre a mesma pessoa, com a mesma roupa, no mesmo lugar.
 */
import { Vec3, v3 } from '../../core/math/vec.js';
import { clamp, clamp01, lerp } from '../../core/math/util.js';
import { COURT } from '../../core/config/court.js';
import { Projection } from './camera.js';
import { ARENA_LIGHT, RGB, hexToRgb, mixRgb, rgbStr, tone } from './shading.js';

type Ctx = CanvasRenderingContext2D;

/** Faixa de piso em volta da quadra antes da arquibancada comecar. */
const APRON = 2.6;
/** Profundidade horizontal do bolo de arquibancada. */
const BOWL_DEPTH = 17;
/** Altura do ultimo degrau. */
const BOWL_HEIGHT = 13.5;
/** Quantos degraus. Mais degraus = silhueta mais suave, mais custo. */
const TIERS = 9;

/** Gerador determinista: mesmo assento, mesma pessoa, sempre. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface Ring {
  /** Retangulo interno (borda de baixo do degrau). */
  inner: number;
  /** Retangulo externo (borda de cima). */
  outer: number;
  zBottom: number;
  zTop: number;
}

/** Os degraus do bolo, de baixo para cima. */
function tiers(): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < TIERS; i++) {
    const t0 = i / TIERS;
    const t1 = (i + 1) / TIERS;
    out.push({
      inner: APRON + BOWL_DEPTH * t0,
      outer: APRON + BOWL_DEPTH * t1,
      // Curva: a arquibancada sobe mais rapido la em cima, como bolo real.
      zBottom: BOWL_HEIGHT * Math.pow(t0, 0.82),
      zTop: BOWL_HEIGHT * Math.pow(t1, 0.82),
    });
  }
  return out;
}

const TIER_CACHE = tiers();

/**
 * Os tres lados de arquibancada que a camera ve.
 *
 * A camera de transmissao fica MONTADA na arquibancada do lado de ca (e por
 * isso que ela esta a -13 m em y). Desenhar esse lado significaria desenhar o
 * que fica atras da propria camera: quadrilateros que atravessam o plano da
 * lente, que a projecao descarta em pedacos e deixam buracos. Entao a
 * geometria vai so do fundo esquerdo, pelo fundo, ate o fundo direito.
 *
 * E uma polilinha ABERTA, nao um anel: o vao de tras e onde a camera esta.
 */
function standPoints(d: number, z: number, steps = 1): Vec3[] {
  const x0 = -d;
  const x1 = COURT.length + d;
  const y0 = -d;
  const y1 = COURT.width + d;
  const pts: Vec3[] = [];
  const edge = (ax: number, ay: number, bx: number, by: number): void => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      pts.push(v3(lerp(ax, bx, t), lerp(ay, by, t), z));
    }
  };
  edge(x0, y0, x0, y1);   // fundo esquerdo
  edge(x0, y1, x1, y1);   // lado de la, de frente para a camera
  edge(x1, y1, x1, y0);   // fundo direito
  pts.push(v3(x1, y0, z));
  return pts;
}

/** Comprimento acumulado da polilinha, para distribuir assentos. */
function polylineLength(pts: Vec3[]): number {
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
}

/** Ponto a uma distancia `s` ao longo da polilinha. */
function pointAt(pts: Vec3[], s: number): Vec3 {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (acc + seg >= s) {
      const t = seg < 1e-6 ? 0 : (s - acc) / seg;
      return v3(lerp(pts[i].x, pts[i + 1].x, t), lerp(pts[i].y, pts[i + 1].y, t), pts[i].z);
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}

/** Preenche um poligono do mundo. Devolve false se algo ficou atras da camera. */
function fillWorldPoly(ctx: Ctx, proj: Projection, pts: Vec3[], style: string | CanvasGradient): boolean {
  ctx.beginPath();
  let started = false;
  for (const p of pts) {
    const s = proj.project(p);
    if (!s) return false;
    if (!started) { ctx.moveTo(s.x, s.y); started = true; } else { ctx.lineTo(s.x, s.y); }
  }
  if (!started) return false;
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
  return true;
}

/**
 * Fundo: o ginasio atras da arquibancada. Escuro, com um leve halo de luz
 * vindo de cima, que e o que os refletores fazem na fumaca do ar.
 */
export function drawHall(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.06, 10, w * 0.5, h * 0.35, Math.max(w, h) * 0.78);
  g.addColorStop(0, '#12182a');
  g.addColorStop(0.42, '#080c16');
  g.addColorStop(1, '#03050a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Piso em volta da quadra: a faixa escura entre a linha lateral e o primeiro
 * degrau. Sem ela a quadra termina no nada e a metade de baixo do quadro
 * fica preta, como se a quadra flutuasse.
 *
 * Desenhado como quatro faixas (inclusive a de ca), porque este piso esta
 * sempre a frente da camera -- ao contrario da arquibancada de ca, que a
 * camera ocupa.
 */
export function drawApron(ctx: Ctx, proj: Projection): void {
  const d = APRON;
  const x0 = 0;
  const x1 = COURT.length;
  const y0 = 0;
  const y1 = COURT.width;
  const base = '#161b26';

  // Fundos e lado de la: faixa estreita ate o primeiro degrau.
  const faixas: Vec3[][] = [
    [v3(x1, y0, 0), v3(x1 + d, y0 - d, 0), v3(x1 + d, y1 + d, 0), v3(x1, y1, 0)],
    [v3(x0, y1, 0), v3(x1, y1, 0), v3(x1 + d, y1 + d, 0), v3(x0 - d, y1 + d, 0)],
    [v3(x0 - d, y0 - d, 0), v3(x0, y0, 0), v3(x0, y1, 0), v3(x0 - d, y1 + d, 0)],
  ];
  for (const f of faixas) fillWorldPoly(ctx, proj, f, base);

  // Lado de ca: a camera esta a uns 14 m dali, entao a faixa estreita deixava
  // a metade de baixo do quadro no vazio. O chao da arena continua ate debaixo
  // da camera -- e o que existe ali de verdade -- escurecendo com a distancia
  // da luz da quadra, em faixas para o degrade acompanhar a perspectiva.
  const NEAR = 26;
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const a = APRON + (NEAR - APRON) * Math.pow(i / steps, 1.5);
    const b = APRON + (NEAR - APRON) * Math.pow((i + 1) / steps, 1.5);
    const k = 1 - i / steps;
    fillWorldPoly(ctx, proj, [
      v3(x0 - a, y0 - a, 0), v3(x1 + a, y0 - a, 0),
      v3(x1 + b, y0 - b, 0), v3(x0 - b, y0 - b, 0),
    ], rgbStr(tone([22, 27, 38], 0.25 + k * 0.75)));
  }
  // A faixa colada na linha de fundo fecha com o piso.
  fillWorldPoly(ctx, proj, [
    v3(x0 - d, y0 - d, 0), v3(x1 + d, y0 - d, 0), v3(x1, y0, 0), v3(x0, y0, 0),
  ], base);
}

/**
 * Arquibancada e publico.
 *
 * `energy` 0..1 vem do estado da torcida no simulador: decide quantos estao
 * de pe, o quanto se mexem e o brilho dos flashes.
 */
export function drawStands(
  ctx: Ctx,
  proj: Projection,
  time: number,
  energy: number,
  quality: 'low' | 'medium' | 'high',
): void {
  // Do degrau mais alto para o mais baixo: o de baixo cobre o de cima,
  // que e a ordem correta vista de dentro da quadra.
  for (let i = TIER_CACHE.length - 1; i >= 0; i--) {
    const t = TIER_CACHE[i];
    const k = i / Math.max(1, TIER_CACHE.length - 1);
    // Quanto mais alto, mais longe da luz da quadra: escurece.
    const face = rgbStr(tone([26, 32, 48], lerp(0.95, 0.42, k)));
    const step = rgbStr(tone([18, 23, 36], lerp(0.9, 0.38, k)));

    // Espelho do degrau (vertical) e piso do degrau (horizontal).
    const innerLow = standPoints(t.inner, t.zBottom, 4);
    const innerHigh = standPoints(t.inner, t.zTop, 4);
    const outerHigh = standPoints(t.outer, t.zTop, 4);

    drawBand(ctx, proj, innerLow, innerHigh, face);
    drawBand(ctx, proj, innerHigh, outerHigh, step);
  }

  if (quality !== 'low') drawCrowd(ctx, proj, time, energy, quality);
}

/** Liga duas polilinhas por quadrilateros, um por aresta. */
function drawBand(ctx: Ctx, proj: Projection, a: Vec3[], b: Vec3[], style: string): void {
  for (let i = 0; i + 1 < a.length; i++) {
    fillWorldPoly(ctx, proj, [a[i], a[i + 1], b[i + 1], b[i]], style);
  }
}

/** Paleta do publico: tons de roupa, nao cores de time. */
const CROWD_COLORS: RGB[] = [
  [58, 66, 88], [74, 62, 70], [46, 58, 74], [86, 78, 68],
  [64, 54, 60], [50, 70, 78], [92, 86, 92], [40, 46, 62],
];

/**
 * Publico instanciado. Cada assento e um ponto fixo do mundo; o que muda com
 * a energia e quantos estao de pe e o quanto oscilam. Sem energia, a arena
 * fica sentada e parada -- e assim que um jogo morno parece morno.
 */
function drawCrowd(ctx: Ctx, proj: Projection, time: number, energy: number, quality: 'low' | 'medium' | 'high'): void {
  // Assentos por metro de fileira, nao por degrau: assim o fundo da quadra e
  // a lateral tem a mesma densidade, que e como um ginasio de verdade e.
  const density = quality === 'high' ? 1.05 : 0.6;
  const rowsPerTier = quality === 'high' ? 3 : 2;
  let seat = 0;

  for (let i = 0; i < TIER_CACHE.length; i++) {
    const t = TIER_CACHE[i];
    for (let row = 0; row < rowsPerTier; row++) {
      const f = (row + 0.5) / rowsPerTier;
      const d = lerp(t.inner, t.outer, f);
      const z = lerp(t.zBottom, t.zTop, f);
      const line = standPoints(d, z);
      const total = polylineLength(line);
      const count = Math.max(4, Math.round(total * density));

      for (let sIdx = 0; sIdx < count; sIdx++) {
        seat++;
        const base = pointAt(line, ((sIdx + 0.5) / count) * total);
        // Jitter fixo por assento: fileira nao fica militarmente alinhada.
        const jx = (hash01(seat * 3.11) - 0.5) * 0.7;
        const jy = (hash01(seat * 7.77) - 0.5) * 0.7;

        const standing = hash01(seat * 1.37) < energy * 0.85;
        const bob = standing ? Math.sin(time * 3.1 + seat * 0.7) * 0.11 * energy : 0;
        const zz = z + 0.58 + bob + (standing ? 0.26 : 0);

        const p = proj.project(v3(base.x + jx, base.y + jy, zz));
        if (!p) continue;
        const r = p.scale * 0.055;
        if (r < 0.5) continue;

        const c = CROWD_COLORS[seat % CROWD_COLORS.length];
        // De pe pega mais luz: a arquibancada fica salpicada de claro quando a
        // torcida levanta, e essa e a leitura de energia a distancia.
        const litK = standing ? 1.2 : 0.74;
        ctx.fillStyle = rgbStr(tone(c, litK));
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 0.8, r * 1.12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Flashes de camera: raros, curtos, mais frequentes com a arena quente.
  if (energy > 0.45 && quality === 'high') {
    const line = standPoints(APRON + BOWL_DEPTH * 0.5, BOWL_HEIGHT * 0.5);
    const total = polylineLength(line);
    const n = Math.floor(energy * 6);
    for (let i = 0; i < n; i++) {
      const id = Math.floor(time * 2.4) * 31 + i * 17;
      if (hash01(id) > 0.3) continue;
      const at = pointAt(line, hash01(id * 2.1) * total);
      const p = proj.project(v3(at.x, at.y, at.z + 0.9));
      if (!p) continue;
      const life = 1 - ((time * 2.4) % 1);
      const rr = Math.max(1.5, p.scale * 0.09) * life;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 3);
      g.addColorStop(0, `rgba(255,255,255,${(0.8 * life).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Faixa de LED na base da arquibancada. Cor dos times, com um brilho
 * correndo. E o elemento que mais diz "transmissao" numa imagem parada.
 */
export function drawRibbon(
  ctx: Ctx,
  proj: Projection,
  time: number,
  home: string,
  away: string,
): void {
  const zBottom = 0.55;
  const zTop = 1.5;
  const d = APRON - 0.15;
  const a = standPoints(d, zBottom, 14);
  const b = standPoints(d, zTop, 14);
  const ch = hexToRgb(home);
  const ca = hexToRgb(away);
  const n = a.length;

  for (let i = 0; i + 1 < n; i++) {
    const j = i + 1;
    const t = i / n;
    // Mistura os dois times ao longo do anel, com um pulso correndo por cima.
    const base = mixRgb(ch, ca, (Math.sin(t * Math.PI * 2) + 1) / 2);
    const pulse = clamp01(Math.sin(t * Math.PI * 6 - time * 2.2) * 0.5 + 0.5);
    const col = tone(base, 0.5 + pulse * 0.95);
    fillWorldPoly(ctx, proj, [a[i], a[j], b[j], b[i]], rgbStr(col));
  }
}

/**
 * Placar suspenso no centro. Quatro faces; desenhamos as duas viradas para a
 * camera. O conteudo e o placar de verdade, nao textura decorativa.
 */
export function drawJumbotron(
  ctx: Ctx,
  proj: Projection,
  score: [number, number],
  abbr: [string, string],
  clock: string,
  period: string,
): void {
  const cx = COURT.length / 2;
  const cy = COURT.width / 2;
  const halfX = 3.4;
  const halfY = 2.4;
  const zBottom = 9.2;
  const zTop = 13.4;

  // Cabo de sustentacao ate o teto.
  const top = proj.project(v3(cx, cy, zTop + 6));
  const hang = proj.project(v3(cx, cy, zTop));
  if (top && hang) {
    ctx.strokeStyle = 'rgba(120,132,158,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(hang.x, hang.y);
    ctx.stroke();
  }

  // Corpo: caixa escura.
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (sx: number, sy: number, z: number): Vec3 => v3(cx + sx * halfX, cy + sy * halfY, z);

  // Topo da caixa.
  fillWorldPoly(ctx, proj, corners.map(([sx, sy]) => at(sx, sy, zTop)), '#0b0f1a');

  // Faces laterais, da mais longe para a mais perto.
  const faces: { a: Vec3; b: Vec3; normalSign: number; label: 0 | 1 }[] = [
    { a: at(-1, -1, zTop), b: at(1, -1, zTop), normalSign: -1, label: 0 },
    { a: at(1, 1, zTop), b: at(-1, 1, zTop), normalSign: 1, label: 1 },
  ];

  for (const f of faces) {
    const aTop = f.a;
    const bTop = f.b;
    const aBot = v3(aTop.x, aTop.y, zBottom);
    const bBot = v3(bTop.x, bTop.y, zBottom);
    const pa = proj.project(aTop);
    const pb = proj.project(bTop);
    const pc = proj.project(bBot);
    const pd = proj.project(aBot);
    if (!pa || !pb || !pc || !pd) continue;

    // Face virada para longe da camera nao e desenhada.
    const area = (pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y);
    if (area * f.normalSign < 0) continue;

    fillWorldPoly(ctx, proj, [aTop, bTop, bBot, aBot], '#070a12');

    // Tela: placar de verdade, em perspectiva aproximada pelo quadrilatero.
    const cxs = (pa.x + pb.x + pc.x + pd.x) / 4;
    const cys = (pa.y + pb.y + pc.y + pd.y) / 4;
    const wpx = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const hpx = Math.hypot(pd.x - pa.x, pd.y - pa.y);
    if (wpx < 40 || hpx < 14) continue;

    ctx.save();
    ctx.translate(cxs, cys);
    ctx.rotate(Math.atan2(pb.y - pa.y, pb.x - pa.x));
    ctx.fillStyle = 'rgba(10,16,28,0.92)';
    ctx.fillRect(-wpx * 0.44, -hpx * 0.36, wpx * 0.88, hpx * 0.72);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffb066';
    ctx.font = `800 ${Math.round(hpx * 0.3)}px system-ui, sans-serif`;
    ctx.fillText(`${abbr[0]} ${score[0]}  ·  ${score[1]} ${abbr[1]}`, 0, -hpx * 0.1);
    ctx.fillStyle = '#cfd9ee';
    ctx.font = `600 ${Math.round(hpx * 0.2)}px system-ui, sans-serif`;
    ctx.fillText(`${clock}  ${period}`, 0, hpx * 0.2);
    ctx.restore();
  }
}

/**
 * Reflexo dos corpos no verniz da quadra.
 *
 * Chamado com um callback que redesenha a cena espelhada: o verniz nao e uma
 * textura brilhante, e a imagem invertida e borrada do que esta em pe nele.
 */
export function withFloorReflection(
  ctx: Ctx,
  proj: Projection,
  w: number,
  h: number,
  strength: number,
  drawMirrored: () => void,
): void {
  if (strength <= 0.01) return;
  const horizon = proj.project(v3(COURT.length / 2, COURT.width, 0));
  ctx.save();
  // Recorta na area da quadra para o reflexo nao vazar na arquibancada.
  ctx.beginPath();
  const corners = [v3(0, 0, 0), v3(COURT.length, 0, 0), v3(COURT.length, COURT.width, 0), v3(0, COURT.width, 0)];
  let ok = true;
  corners.forEach((c, i) => {
    const s = proj.project(c);
    if (!s) { ok = false; return; }
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  if (!ok) { ctx.restore(); return; }
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = 'lighter';
  drawMirrored();
  ctx.restore();
  void horizon;
  void w;
  void h;
}
