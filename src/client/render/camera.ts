/**
 * CAMERA (secao 37).
 *
 * Camera pinhole real: posicao, alvo e campo de visao, com projecao
 * perspectiva. Nao e um "2D de cima" disfarcado - a profundidade muda o
 * tamanho dos corpos e a leitura de espaco, que e o que faz a camera
 * broadcast parecer transmissao.
 *
 * Todo movimento de camera e amortecido (damp) com constante independente de
 * framerate: nunca ha corte seco, nunca ha tranco (secao 130).
 */
import { Vec3, v3, sub3, norm3, len3 } from '../../core/math/vec.js';
import { COURT, Side, hoopGround } from '../../core/config/court.js';
import { clamp, damp, lerp } from '../../core/math/util.js';
import { Vec2 } from '../../core/math/vec.js';

export type CameraMode = 'broadcast' | 'action' | 'player_lock' | 'street' | 'cinematic' | 'free_throw' | 'replay';

export interface CameraState {
  pos: Vec3;
  target: Vec3;
  fov: number;
  /** Rotacao de rolagem (usada apenas em cinematica). */
  roll: number;
  mode: CameraMode;
  shake: number;
}

export function createCamera(): CameraState {
  return {
    pos: v3(COURT.length / 2, -14, 11),
    target: v3(COURT.length / 2, COURT.width / 2, 1.2),
    fov: 42,
    roll: 0,
    mode: 'broadcast',
    shake: 0,
  };
}

/**
 * Proporcao da tela. Um celular deitado (2,2:1) enxerga pouca profundidade
 * vertical: a quadra fica achatada no meio com sobra em cima. A camera sobe e
 * se aproxima para compensar.
 */
export function framingFor(aspect: number): { distance: number; height: number; shift: number } {
  // Mesmo em 16:9 sobra ceu: o `shift` base joga o enquadramento para cima e
  // devolve esse espaco para a quadra.
  if (aspect <= 1.7) return { distance: 1, height: 1, shift: 0.075 };
  const t = Math.min(1, (aspect - 1.7) / 0.8);
  // `shift` desloca o ponto principal da projecao (o mesmo efeito de uma lente
  // tilt-shift): sobe a imagem para aproveitar o ceu vazio, sem mudar o
  // ponto de vista nem distorcer a perspectiva.
  return { distance: 1 - t * 0.26, height: 1 + t * 0.34, shift: 0.075 + t * 0.075 };
}

export interface CameraFocus {
  /** Ponto de interesse principal (bola ou atleta travado). */
  ball: Vec3;
  /** Centro de massa da acao. */
  action: Vec3;
  /** Cesta atacada. */
  attackingSide: Side;
  /** Velocidade horizontal da acao (para antecipar o enquadramento). */
  flow: number;
  locked?: Vec3;
}

/** Alvo ideal de cada modo. Devolve posicao e alvo desejados. */
export function desiredCamera(mode: CameraMode, focus: CameraFocus): { pos: Vec3; target: Vec3; fov: number } {
  const hoop = hoopGround(focus.attackingSide);
  const mid = COURT.width / 2;
  switch (mode) {
    case 'broadcast': {
      // Lateral alta deslizando junto com a acao. A camera fica quase em cima
      // do alvo no eixo longo: e isso que da o enquadramento de transmissao,
      // sem a quadra "torcendo" na tela.
      // A camera acompanha a acao, mas nao a persegue ponto a ponto: mistura
      // com o centro da quadra para manter o enquadramento estavel quando a
      // jogada vai para o fundo.
      const follow = COURT.length / 2 + (focus.action.x - COURT.length / 2) * 0.62;
      const x = clamp(follow, 9.5, COURT.length - 9.5);
      return {
        pos: v3(x, -13.6, 8.5),
        target: v3(clamp(focus.action.x, 5, COURT.length - 5) * 0.55 + x * 0.45, mid - 0.4, 1.6),
        fov: 50,
      };
    }
    case 'action': {
      // Mais baixa e mais perto, deslocada para o lado da acao.
      const x = clamp(focus.action.x, 6, COURT.length - 6);
      return {
        pos: v3(x, -12.5, 7.4),
        target: v3(x + (focus.action.x - x) * 0.5, mid - 0.2, 1.5),
        fov: 52,
      };
    }
    case 'player_lock': {
      const p = focus.locked ?? focus.ball;
      // Atras do atleta, olhando para a cesta que ele ataca.
      const toward = focus.attackingSide === 0 ? -1 : 1;
      return {
        pos: v3(p.x - toward * 7.2, clamp(p.y, 3, COURT.width - 3) - 2.2, 4.6),
        target: v3(p.x + toward * 3.5, p.y + 0.6, 1.7),
        fov: 55,
      };
    }
    case 'street': {
      const x = clamp(focus.action.x, 6, COURT.length - 6);
      return {
        pos: v3(x + 3.2, -11, 5.6),
        target: v3(x, mid, 1.4),
        fov: 58,
      };
    }
    case 'free_throw': {
      const dir = focus.attackingSide === 0 ? 1 : -1;
      return {
        pos: v3(hoop.x + dir * 12, mid, 3.2),
        target: v3(hoop.x, mid, 2.6),
        fov: 34,
      };
    }
    case 'cinematic': {
      return {
        pos: v3(focus.action.x - 4.5, focus.action.y - 6.5, 2.2),
        target: v3(focus.action.x, focus.action.y, 1.5),
        fov: 38,
      };
    }
    case 'replay':
    default: {
      return {
        pos: v3(focus.action.x + 5, -9, 4.5),
        target: v3(focus.action.x, COURT.width / 2, 1.6),
        fov: 44,
      };
    }
  }
}

/** Interpola a camera na direcao do alvo. Nunca corta. */
export function updateCamera(cam: CameraState, focus: CameraFocus, dt: number, speedScale = 1, aspect = 16 / 9): void {
  const raw = desiredCamera(cam.mode, focus);
  const frame = framingFor(aspect);
  // Reenquadra mantendo o alvo: aproxima e sobe conforme a tela e mais larga.
  const d = {
    target: raw.target,
    fov: raw.fov,
    pos: v3(
      raw.target.x + (raw.pos.x - raw.target.x) * frame.distance,
      raw.target.y + (raw.pos.y - raw.target.y) * frame.distance,
      raw.target.z + (raw.pos.z - raw.target.z) * frame.distance * frame.height,
    ),
  };
  // Constantes diferentes por eixo: a camera acompanha o eixo longo mais
  // rapido do que sobe/desce, como um operador real.
  const lambdaXY = (cam.mode === 'player_lock' ? 7 : 2.6) * speedScale;
  const lambdaZ = 1.6 * speedScale;
  cam.pos.x = damp(cam.pos.x, d.pos.x, lambdaXY, dt);
  cam.pos.y = damp(cam.pos.y, d.pos.y, lambdaXY, dt);
  cam.pos.z = damp(cam.pos.z, d.pos.z, lambdaZ, dt);
  cam.target.x = damp(cam.target.x, d.target.x, lambdaXY * 1.25, dt);
  cam.target.y = damp(cam.target.y, d.target.y, lambdaXY * 1.25, dt);
  cam.target.z = damp(cam.target.z, d.target.z, lambdaZ, dt);
  cam.fov = damp(cam.fov, d.fov, 2.2, dt);
  cam.shake = Math.max(0, cam.shake - dt * 2.2);
}

export function addShake(cam: CameraState, amount: number): void {
  cam.shake = Math.min(1, cam.shake + amount);
}

export interface Projection {
  /** Projeta um ponto do mundo para a tela. Retorna null se atras da camera. */
  project(p: Vec3): { x: number; y: number; scale: number; depth: number } | null;
  /**
   * Caminho inverso: de um pixel da tela para o ponto do CHAO que esta sob
   * ele. E o que transforma o mouse num recurso de jogo -- sem isso o cursor
   * nao tem nenhuma relacao com a quadra. Devolve null se o raio apontar para
   * cima do horizonte, que e quando nao cruza o chao.
   */
  unproject(x: number, y: number, z?: number): Vec3 | null;
  width: number;
  height: number;
}

/** Constroi a matriz de projecao do frame. */
export function buildProjection(cam: CameraState, width: number, height: number, time: number, shift = 0): Projection {
  const shakeX = cam.shake > 0 ? Math.sin(time * 41) * cam.shake * 0.11 : 0;
  const shakeY = cam.shake > 0 ? Math.cos(time * 37) * cam.shake * 0.09 : 0;
  const eye = v3(cam.pos.x + shakeX, cam.pos.y, cam.pos.z + shakeY);

  const forward = norm3(sub3(cam.target, eye));
  // Up do mundo = +Z. Right = forward x up.
  const worldUp = v3(0, 0, 1);
  const right = norm3(v3(
    forward.y * worldUp.z - forward.z * worldUp.y,
    forward.z * worldUp.x - forward.x * worldUp.z,
    forward.x * worldUp.y - forward.y * worldUp.x,
  ));
  const up = v3(
    right.y * forward.z - right.z * forward.y,
    right.z * forward.x - right.x * forward.z,
    right.x * forward.y - right.y * forward.x,
  );

  const f = 1 / Math.tan((cam.fov * Math.PI) / 360);
  const aspect = width / height;
  const half = height / 2;

  return {
    width,
    height,
    project(p: Vec3) {
      const d = sub3(p, eye);
      const depth = d.x * forward.x + d.y * forward.y + d.z * forward.z;
      if (depth <= 0.25) return null;
      const rx = d.x * right.x + d.y * right.y + d.z * right.z;
      const ry = d.x * up.x + d.y * up.y + d.z * up.z;
      const ndcX = (rx / depth) * f / aspect;
      const ndcY = (ry / depth) * f;
      return {
        x: width / 2 + ndcX * half * aspect,
        y: height / 2 - ndcY * half - shift * height,
        scale: (f * half) / depth,
        depth,
      };
    },
    unproject(sx: number, sy: number, planeZ = 0) {
      // Desfaz a projecao para achar a direcao do raio no espaco da camera...
      const ndcX = (sx - width / 2) / (half * aspect);
      const ndcY = -(sy - height / 2 + shift * height) / half;
      const cx = (ndcX * aspect) / f;
      const cy = ndcY / f;
      // ...e converte para o mundo com a mesma base usada na ida.
      const dir = v3(
        forward.x + right.x * cx + up.x * cy,
        forward.y + right.y * cx + up.y * cy,
        forward.z + right.z * cx + up.z * cy,
      );
      // Intersecao com o plano horizontal.
      if (Math.abs(dir.z) < 1e-5) return null;
      const t = (planeZ - eye.z) / dir.z;
      if (t <= 0) return null;
      return v3(eye.x + dir.x * t, eye.y + dir.y * t, planeZ);
    },
  };
}
