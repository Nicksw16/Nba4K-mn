/**
 * CORPO DESENHADO (secoes 40, 100, 101, 102, 103).
 *
 * Junta o esqueleto (rig.ts) com o modelo de luz (shading.ts) e pinta um
 * atleta. Nenhuma pose e inventada aqui: tudo que muda na silhueta veio do
 * estado fisico do simulador, entao o que aparece na tela e o que o motor
 * acredita que esta acontecendo -- incluindo os erros, quando houver.
 *
 * Ordem de desenho: sombra de todo mundo primeiro (para uma sombra nunca
 * cair por cima de um corpo), depois os corpos por profundidade, e dentro de
 * cada corpo os ossos tambem por profundidade -- e isso que faz um braco
 * passar na frente do tronco quando esta mesmo na frente.
 */
import { Vec3, v3, fromAngle } from '../../core/math/vec.js';
import { clamp, clamp01, lerp } from '../../core/math/util.js';
import { Actor } from '../../core/sim/actor.js';
import { Projection } from './camera.js';
import { Bone, Skeleton, bonesOf, proportionsOf, solveRig } from './rig.js';
import {
  Light, RGB, drawBone, drawSphere, hexToRgb, lightScreenDir,
  mixRgb, rgbStr, shadowAlpha, shadowPoint, tone,
} from './shading.js';

type Ctx = CanvasRenderingContext2D;

export interface BodyColors {
  primary: string;
  secondary: string;
  accent: string;
}

/**
 * Tom de pele estavel por atleta. Sai do id, nao de sorteio por quadro: o
 * mesmo atleta tem sempre o mesmo tom, entre partidas e entre sessoes.
 */
const SKIN_TONES: RGB[] = [
  [232, 194, 163], [214, 168, 128], [186, 134, 96],
  [152, 104, 70], [118, 78, 52], [86, 56, 38],
];

function skinOf(actor: Actor): RGB {
  let h = 2166136261;
  for (let i = 0; i < actor.id.length; i++) {
    h ^= actor.id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return SKIN_TONES[Math.abs(h) % SKIN_TONES.length];
}

interface Materials {
  jersey: RGB;
  shorts: RGB;
  skin: RGB;
  shoe: RGB;
}

function materialsOf(actor: Actor, colors: BodyColors): Materials {
  const primary = hexToRgb(colors.primary);
  return {
    jersey: primary,
    // O calcao e um degrau abaixo do uniforme: separa tronco de perna na
    // silhueta mesmo quando os dois estao na sombra.
    shorts: tone(primary, 0.74),
    skin: skinOf(actor),
    // Tenis de basquete e claro com detalhe do time, nao um bloco da cor do
    // time. Puro accent vira uma barra preta no pe em metade das paletas.
    shoe: mixRgb(hexToRgb(colors.accent), [246, 248, 252], 0.62),
  };
}

/** Sombra de um atleta: uma capsula achatada por osso, na direcao da luz. */
export function drawBodyShadow(
  ctx: Ctx,
  proj: Projection,
  actor: Actor,
  ball: Vec3 | null,
  light: Light,
  time: number,
  quality: 'low' | 'medium' | 'high',
): void {
  const alpha = shadowAlpha(actor.z);
  if (alpha <= 0.01) return;
  const rig = solveRig(actor, ball, time);
  const p = proportionsOf(actor);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';

  if (quality === 'low') {
    // Um borrao so: barato e ainda ancora o corpo no chao.
    const c = proj.project(shadowPoint(v3(actor.pos.x, actor.pos.y, p.height * 0.5), light));
    if (c) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.scale * 0.42, c.scale * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // Sombra com a forma do corpo: bracos abertos fazem sombra aberta.
  //
  // Tudo num Path2D unico e UM traco no fim. Tracando osso por osso, cada
  // sobreposicao multiplicava a opacidade e o atleta virava uma poca preta --
  // dentro de um unico traco a sobreposicao nao soma.
  const path = new Path2D();
  let width = 0;
  for (const bone of bonesOf(rig, actor)) {
    const pa = proj.project(shadowPoint(bone.a, light));
    const pb = proj.project(shadowPoint(bone.b, light));
    if (!pa || !pb) continue;
    path.moveTo(pa.x, pa.y);
    path.lineTo(pb.x, pb.y);
    width = Math.max(width, (bone.rA + bone.rB) * pa.scale);
  }
  ctx.lineWidth = Math.max(1.5, width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.stroke(path);
  ctx.restore();

  // Sombra de contato: escura e apertada sob o pe que esta plantado. Sem ela
  // o atleta parece flutuar mesmo com a sombra grande desenhada.
  if (actor.z < 0.04) {
    const plant = actor.feet.planted;
    const feet: [number, number][] = [];
    if (plant === 'left' || plant === 'both') feet.push([actor.feet.left.x, actor.feet.left.y]);
    if (plant === 'right' || plant === 'both') feet.push([actor.feet.right.x, actor.feet.right.y]);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#000';
    for (const [fx, fy] of feet) {
      const s = proj.project(v3(fx, fy, 0.004));
      if (!s) continue;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.scale * 0.11, s.scale * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * Reflexo no verniz.
 *
 * O brilho de uma quadra de basquete nao e uma textura lustrosa: e a imagem
 * invertida dos corpos em pe nela. Entao o reflexo e o MESMO esqueleto com z
 * negado, desenhado por baixo com pouca opacidade. Sem cabeca, sem numero,
 * sem contraluz -- de cabeca para baixo e a 15% ninguem le detalhe, e o custo
 * cai pela metade.
 */
export function drawBodyReflection(
  ctx: Ctx,
  proj: Projection,
  info: BodyInfo,
  ball: Vec3 | null,
  light: Light,
  time: number,
): void {
  const actor = info.actor;
  // Verniz nao e espelho: reflete pouco. Forte demais e o reflexo vira um
  // segundo atleta de cabeca para baixo e confunde a leitura de quadra.
  // Quem esta no ar reflete mais longe e mais fraco, como na agua.
  const fade = clamp01(0.15 - actor.z * 0.05);
  if (fade <= 0.02) return;

  const rig = solveRig(actor, ball, time);
  const mat = materialsOf(actor, info.colors);
  const ls = lightScreenDir(proj, light, rig.chest);

  ctx.save();
  ctx.globalAlpha = fade;
  for (const b of bonesOf(rig, actor)) {
    const pa = proj.project(v3(b.a.x, b.a.y, -b.a.z));
    const pb = proj.project(v3(b.b.x, b.b.y, -b.b.z));
    if (!pa || !pb) continue;
    drawBone(
      ctx,
      { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, rA: b.rA * pa.scale, rB: b.rB * pb.scale },
      mat[b.skin],
      light,
      ls,
      { rim: 0, gloss: 0 },
    );
  }
  ctx.restore();
}

export interface BodyInfo {
  actor: Actor;
  colors: BodyColors;
  isUser: boolean;
  isBallHandler: boolean;
  label: string;
}

/** Profundidade media de um osso, para ordenar dentro do corpo. */
function boneDepth(proj: Projection, b: Bone): number {
  const pa = proj.project(b.a);
  const pb = proj.project(b.b);
  if (!pa || !pb) return -1;
  return (pa.depth + pb.depth) * 0.5;
}

export function drawBody(
  ctx: Ctx,
  proj: Projection,
  info: BodyInfo,
  ball: Vec3 | null,
  light: Light,
  time: number,
  opts: { names: boolean; indicators: boolean; immersion: boolean; quality: 'low' | 'medium' | 'high' },
): void {
  const actor = info.actor;
  const rig = solveRig(actor, ball, time);
  const p = proportionsOf(actor);
  const mat = materialsOf(actor, info.colors);

  const headS = proj.project(rig.head);
  const pelvisS = proj.project(rig.pelvis);
  if (!headS || !pelvisS) return;

  // Altura em pixels decide o nivel de detalhe: longe, nao adianta pintar
  // numero nem costura.
  const footS = proj.project(v3(actor.pos.x, actor.pos.y, 0));
  const pxHeight = footS ? Math.abs(footS.y - headS.y) : Math.abs(pelvisS.y - headS.y) * 2;
  if (pxHeight < 3) return;

  const ls = lightScreenDir(proj, light, rig.chest);
  const bones = bonesOf(rig, actor);

  // Ossos por profundidade: o que esta atras vai primeiro.
  const drawn = bones
    .map((b) => ({ b, d: boneDepth(proj, b) }))
    .filter((x) => x.d > 0)
    .sort((x, y) => y.d - x.d);

  for (const { b } of drawn) {
    const pa = proj.project(b.a);
    const pb = proj.project(b.b);
    if (!pa || !pb) continue;
    const base = mat[b.skin];
    drawBone(
      ctx,
      { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, rA: b.rA * pa.scale, rB: b.rB * pb.scale },
      base,
      light,
      ls,
      {
        rim: 1,
        gloss: b.skin === 'shoe' ? 0.7 : b.skin === 'skin' ? 0.28 : 0.12,
      },
    );
  }

  // Cabeca depois dos ossos: sempre na frente do pescoco.
  const headR = p.headRadius * headS.scale;
  drawSphere(ctx, headS.x, headS.y, headR, mat.skin, light, ls, { rim: 1, gloss: 0.22 });

  // Cabelo: calota do lado oposto ao rosto. So quando ha pixel para isso.
  if (headR > 3.2) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(headS.x, headS.y - headR * 0.18, headR * 0.94, Math.PI, Math.PI * 2);
    ctx.fillStyle = rgbStr(tone(mixRgb(mat.skin, [20, 14, 12], 0.82), light.ambient + light.key * 0.5));
    ctx.fill();
    ctx.restore();
  }

  // Numero no peito, acompanhando a inclinacao do tronco em tela.
  if (!opts.immersion && pxHeight > 42 && opts.quality !== 'low') {
    drawJerseyNumber(ctx, proj, rig, actor, info.colors, pxHeight);
  }

  // --- Micro-reacoes (secao 103) -------------------------------------------
  drawCues(ctx, headS, headR, actor, time);

  // --- Indicadores ---------------------------------------------------------
  if (opts.indicators && !opts.immersion && footS) {
    drawIndicators(ctx, footS, actor, info, pxHeight);
  }

  if (opts.names && !opts.immersion && pxHeight > 40) {
    ctx.fillStyle = 'rgba(236,243,255,0.86)';
    ctx.font = `600 ${Math.round(clamp(pxHeight * 0.115, 9, 15))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
    ctx.fillText(info.label, headS.x, headS.y - headR * 1.75);
    ctx.shadowBlur = 0;
  }
}

function drawJerseyNumber(
  ctx: Ctx,
  proj: Projection,
  rig: Skeleton,
  actor: Actor,
  colors: BodyColors,
  pxHeight: number,
): void {
  const chest = proj.project(rig.chest);
  const neck = proj.project(rig.neck);
  const shoulder = proj.project(rig.shoulderR);
  if (!chest || !neck || !shoulder) return;

  // O numero so aparece quando o peito esta virado para a camera. De costas,
  // um numero desenhado seria mentira -- e a regra do projeto e nao mentir.
  const facing = fromAngle(actor.heading);
  const toCam = proj.project(v3(rig.chest.x - facing.x, rig.chest.y - facing.y, rig.chest.z));
  if (!toCam) return;
  const frontness = (toCam.depth - chest.depth) / Math.max(0.2, Math.abs(toCam.depth - chest.depth) + 0.6);
  if (frontness < 0.05) return;

  const up = Math.atan2(neck.y - chest.y, neck.x - chest.x) + Math.PI / 2;
  const size = clamp(pxHeight * 0.17, 7, 26);

  ctx.save();
  ctx.translate((chest.x + neck.x) / 2, (chest.y + neck.y) / 2);
  ctx.rotate(up);
  // Escala horizontal pela frontalidade: de lado, o numero comprime como no
  // tecido de verdade.
  ctx.scale(clamp(frontness, 0.12, 1), 1);
  ctx.globalAlpha = clamp01(frontness * 1.6);
  ctx.fillStyle = colors.accent;
  ctx.font = `800 ${Math.round(size)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(actor.profile.jersey), 0, 0);
  ctx.restore();
}

/**
 * Micro-reacoes (secao 103). O simulador enfileira `cues` com um instante; o
 * desenho e a consequencia visivel deles.
 */
function drawCues(ctx: Ctx, head: { x: number; y: number }, headR: number, actor: Actor, time: number): void {
  for (const cue of actor.cues) {
    const age = time - cue.t;
    if (age < 0 || age > 1.1) continue;
    const k = 1 - age / 1.1;
    switch (cue.kind) {
      case 'ankle_broken':
      case 'stumble': {
        // Estrelas de desequilibrio girando sobre a cabeca.
        ctx.save();
        ctx.globalAlpha = k * 0.9;
        ctx.fillStyle = '#ffd166';
        for (let i = 0; i < 3; i++) {
          const a = time * 5 + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(head.x + Math.cos(a) * headR * 1.5, head.y - headR * 1.4 + Math.sin(a) * headR * 0.45, headR * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'posterized':
      case 'blocked': {
        ctx.save();
        ctx.globalAlpha = k * 0.8;
        ctx.strokeStyle = '#ff6b5e';
        ctx.lineWidth = Math.max(1, headR * 0.22);
        ctx.beginPath();
        ctx.arc(head.x, head.y, headR * (1.3 + (1 - k) * 1.1), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'hot':
      case 'takeover': {
        ctx.save();
        ctx.globalAlpha = k * 0.7;
        const g = ctx.createRadialGradient(head.x, head.y, headR * 0.5, head.x, head.y, headR * 2.6);
        g.addColorStop(0, 'rgba(255,150,60,0.6)');
        g.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(head.x, head.y, headR * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      default:
        break;
    }
  }
}

function drawIndicators(
  ctx: Ctx,
  foot: { x: number; y: number; scale: number },
  actor: Actor,
  info: BodyInfo,
  pxHeight: number,
): void {
  const rx = foot.scale * 0.33;
  const ry = rx * 0.38;

  if (info.isUser) {
    // Anel do jogador controlado: vive no chao, com a mesma perspectiva.
    ctx.save();
    ctx.strokeStyle = 'rgba(126,246,192,0.95)';
    ctx.lineWidth = Math.max(1.4, foot.scale * 0.016);
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    const g = ctx.createRadialGradient(foot.x, foot.y, ry * 0.2, foot.x, foot.y, rx);
    g.addColorStop(0, 'rgba(126,246,192,0.20)');
    g.addColorStop(1, 'rgba(126,246,192,0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  } else if (info.isBallHandler) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,214,120,0.7)';
    ctx.lineWidth = Math.max(1, foot.scale * 0.012);
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, rx * 0.84, ry * 0.84, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (actor.stamina < 0.62 && pxHeight > 26) {
    const w = foot.scale * 0.5;
    const y = foot.y + Math.max(4, foot.scale * 0.035);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(foot.x - w / 2, y, w, 3);
    ctx.fillStyle = actor.stamina < 0.3 ? '#ef5e5e' : '#f2c14e';
    ctx.fillRect(foot.x - w / 2, y, w * clamp01(actor.stamina), 3);
  }
}
