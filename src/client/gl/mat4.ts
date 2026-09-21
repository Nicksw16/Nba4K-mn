/**
 * MATRIZES 4x4.
 *
 * Column-major, que e o que o WebGL espera em `uniformMatrix4fv` sem
 * transpor. Nada de biblioteca externa: o jogo inteiro e um arquivo unico
 * sem dependencia, e isso aqui cabe em duzentas linhas.
 */
import { Vec3, v3, sub3, norm3, len3 } from '../../core/math/vec.js';

export type Mat4 = Float32Array;

export const identity = (): Mat4 => new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/**
 * Perspectiva com FOV vertical em graus.
 *
 * `shift` desloca o PONTO PRINCIPAL, o mesmo efeito de lente tilt-shift que a
 * camera 2D ja usava para aproveitar o ceu vazio em tela larga. Tem que ser o
 * mesmo valor nas duas, senao as etiquetas de nome (desenhadas em 2D) flutuam
 * longe das cabecas (desenhadas em 3D).
 */
export function perspective(out: Mat4, fovDeg: number, aspect: number, near: number, far: number, shift = 0): Mat4 {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[9] = -2 * shift;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** Projecao ortografica, usada pela camera da luz no shadow map. */
export function ortho(out: Mat4, l: number, r: number, b: number, t: number, near: number, far: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (far - near);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

/**
 * Olhar de `eye` para `center`. `up` do mundo e +Z aqui, porque o jogo inteiro
 * usa z para cima -- trocar de convencao no meio do caminho e garantia de bug.
 */
export function lookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3 = v3(0, 0, 1)): Mat4 {
  let f = sub3(center, eye);
  const fl = len3(f);
  if (fl < 1e-6) return identity();
  f = { x: f.x / fl, y: f.y / fl, z: f.z / fl };

  let s = v3(f.y * up.z - f.z * up.y, f.z * up.x - f.x * up.z, f.x * up.y - f.y * up.x);
  const sl = len3(s);
  // Olhar exatamente ao longo do `up` deixa o produto vetorial degenerado.
  s = sl < 1e-6 ? v3(1, 0, 0) : { x: s.x / sl, y: s.y / sl, z: s.z / sl };
  const u = v3(s.y * f.z - s.z * f.y, s.z * f.x - s.x * f.z, s.x * f.y - s.y * f.x);

  out[0] = s.x; out[4] = s.y; out[8] = s.z; out[12] = -(s.x * eye.x + s.y * eye.y + s.z * eye.z);
  out[1] = u.x; out[5] = u.y; out[9] = u.z; out[13] = -(u.x * eye.x + u.y * eye.y + u.z * eye.z);
  out[2] = -f.x; out[6] = -f.y; out[10] = -f.z; out[14] = f.x * eye.x + f.y * eye.y + f.z * eye.z;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

/**
 * Matriz que leva uma capsula unitaria (eixo em +Z, de z=0 a z=1, raio 1)
 * para o osso `a`->`b`. E assim que UMA malha serve para todos os ossos de
 * todos os atletas: o que muda e a matriz por instancia.
 */
export function boneMatrix(out: Mat4, a: Vec3, b: Vec3, radius: number): Mat4 {
  const d = sub3(b, a);
  const len = len3(d);
  if (len < 1e-6) {
    out.fill(0);
    out[0] = radius; out[5] = radius; out[10] = 1e-4; out[15] = 1;
    out[12] = a.x; out[13] = a.y; out[14] = a.z;
    return out;
  }
  const zAxis = { x: d.x / len, y: d.y / len, z: d.z / len };
  // Um eixo qualquer que nao seja paralelo ao osso.
  const ref = Math.abs(zAxis.z) > 0.95 ? v3(1, 0, 0) : v3(0, 0, 1);
  const xAxis = norm3(v3(
    ref.y * zAxis.z - ref.z * zAxis.y,
    ref.z * zAxis.x - ref.x * zAxis.z,
    ref.x * zAxis.y - ref.y * zAxis.x,
  ));
  const yAxis = v3(
    zAxis.y * xAxis.z - zAxis.z * xAxis.y,
    zAxis.z * xAxis.x - zAxis.x * xAxis.z,
    zAxis.x * xAxis.y - zAxis.y * xAxis.x,
  );

  out[0] = xAxis.x * radius; out[1] = xAxis.y * radius; out[2] = xAxis.z * radius; out[3] = 0;
  out[4] = yAxis.x * radius; out[5] = yAxis.y * radius; out[6] = yAxis.z * radius; out[7] = 0;
  out[8] = zAxis.x * len; out[9] = zAxis.y * len; out[10] = zAxis.z * len; out[11] = 0;
  out[12] = a.x; out[13] = a.y; out[14] = a.z; out[15] = 1;
  return out;
}

/** Translacao + escala uniforme, para esferas e caixas. */
export function trs(out: Mat4, pos: Vec3, scale: Vec3): Mat4 {
  out.fill(0);
  out[0] = scale.x;
  out[5] = scale.y;
  out[10] = scale.z;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}
