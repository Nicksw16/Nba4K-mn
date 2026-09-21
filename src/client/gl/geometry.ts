/**
 * MALHAS PROCEDURAIS.
 *
 * Nenhum asset: tudo e gerado em codigo, porque a distribuicao e um arquivo
 * HTML unico sem nada ao lado. As formas sao poucas e reaproveitadas por
 * instanciamento -- uma capsula serve para os 13 ossos dos dez atletas, o que
 * transforma 130 objetos em UMA chamada de desenho.
 */

export interface MeshData {
  /** posicao(3) + normal(3) + uv(2), intercalados. */
  vertices: Float32Array;
  indices: Uint16Array;
}

/** Bytes por vertice: 8 floats. */
export const VERTEX_STRIDE = 32;

/**
 * Tubo unitario: eixo em +Z, da origem ate z=1, raio 1, SEM tampas.
 *
 * O afinamento (raio diferente em cada ponta) nao entra na malha: e feito no
 * vertex shader a partir de um atributo por instancia. Assim a mesma malha
 * serve para a coxa (grossa em cima) e para o antebraco (fino embaixo).
 *
 * Sem tampa de proposito: cada articulacao ganha uma ESFERA, que alem de
 * fechar o tubo e o que joelho, cotovelo e ombro realmente sao. Tampa
 * hemisferica no tubo afinado exigiria deslocar a calota junto com o raio no
 * shader, muito trabalho para um resultado pior.
 */
export function tube(radialSegments = 14): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];

  for (const z of [0, 1]) {
    for (let i = 0; i <= radialSegments; i++) {
      const a = (i / radialSegments) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      verts.push(cx, cy, z, cx, cy, 0, i / radialSegments, z);
    }
  }

  const n = radialSegments + 1;
  for (let i = 0; i < radialSegments; i++) {
    idx.push(i, n + i, i + 1);
    idx.push(i + 1, n + i, n + i + 1);
  }

  return { vertices: new Float32Array(verts), indices: new Uint16Array(idx) };
}

/** Esfera unitaria centrada na origem. Cabeca, bola e articulacoes. */
export function sphere(segments = 18, rings = 12): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      verts.push(nx, ny, nz, nx, ny, nz, u, v);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x;
      const b = a + segments + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint16Array(idx) };
}

/** Caixa unitaria centrada na origem, lado 1. Placar, tabela, estrutura. */
export function box(): MeshData {
  const faces: [number[], number[]][] = [
    [[0, 0, 1], [0, 0, 1]],
    [[0, 0, -1], [0, 0, -1]],
    [[1, 0, 0], [1, 0, 0]],
    [[-1, 0, 0], [-1, 0, 0]],
    [[0, 1, 0], [0, 1, 0]],
    [[0, -1, 0], [0, -1, 0]],
  ];
  const verts: number[] = [];
  const idx: number[] = [];
  for (const [n] of faces) {
    const start = verts.length / 8;
    // Dois eixos perpendiculares a normal.
    const up = Math.abs(n[2]) > 0.5 ? [0, 1, 0] : [0, 0, 1];
    const t = [
      up[1] * n[2] - up[2] * n[1],
      up[2] * n[0] - up[0] * n[2],
      up[0] * n[1] - up[1] * n[0],
    ];
    const b = [
      n[1] * t[2] - n[2] * t[1],
      n[2] * t[0] - n[0] * t[2],
      n[0] * t[1] - n[1] * t[0],
    ];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
      verts.push(
        (n[0] + t[0] * su + b[0] * sv) * 0.5,
        (n[1] + t[1] * su + b[1] * sv) * 0.5,
        (n[2] + t[2] * su + b[2] * sv) * 0.5,
        n[0], n[1], n[2],
        su * 0.5 + 0.5, sv * 0.5 + 0.5,
      );
    }
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { vertices: new Float32Array(verts), indices: new Uint16Array(idx) };
}

/**
 * Malha estatica construida a partir de quadrilateros do mundo.
 * Usada pela quadra, pelo piso e pela arquibancada, que nao mudam de forma.
 */
export class MeshBuilder {
  private verts: number[] = [];
  private idx: number[] = [];

  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]],
  ): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const start = this.verts.length / 8;
    const pts = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      this.verts.push(pts[i][0], pts[i][1], pts[i][2], nx, ny, nz, uvs[i][0], uvs[i][1]);
    }
    this.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  get count(): number { return this.idx.length; }

  build(): { vertices: Float32Array; indices: Uint32Array } {
    return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.idx) };
  }
}
