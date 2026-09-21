/**
 * RENDERIZADOR 3D (secoes 40 e 100).
 *
 * Eu tinha afirmado que PBR com z-buffer estava fora de alcance. Estava fora
 * do alcance do Canvas 2D -- que foi ESCOLHA minha, nao exigencia do escopo.
 * WebGL2 esta em todo navegador desde 2017, roda de arquivo local, nao precisa
 * de asset nenhum, e traz rasterizador de triangulo com buffer de profundidade
 * e shaders programaveis. Era so usar.
 *
 * O que muda de verdade em relacao ao 2D:
 *
 * - Oclusao correta por pixel. Nada de ordenar objeto por objeto e torcer:
 *   um braco na frente do tronco fica na frente porque esta mais perto.
 * - Iluminacao por pixel com BRDF de microfacetas, nao gradiente aproximando
 *   a secao de um cilindro.
 * - Sombra projetada de verdade, vinda de um mapa de profundidade renderizado
 *   do ponto de vista da luz -- a sombra de um braco erguido aparece.
 * - Instanciamento: os ~130 ossos dos dez atletas saem em UMA chamada.
 *
 * O Canvas 2D continua no projeto como reserva para quem nao tiver WebGL2.
 */
import { Vec3, v3 } from '../../core/math/vec.js';
import { clamp, clamp01, lerp } from '../../core/math/util.js';
import { COURT, hoopGround } from '../../core/config/court.js';
import { Actor } from '../../core/sim/actor.js';
import { Ball } from '../../core/sim/ball.js';
import { CameraState } from '../render/camera.js';
import { bonesOf, proportionsOf, solveRig } from '../render/rig.js';
import { Mat4, boneMatrix, identity, lookAt, multiply, ortho, perspective, trs } from './mat4.js';
import { MeshBuilder, MeshData, VERTEX_STRIDE, box, sphere, tube } from './geometry.js';
import { paintCourtTexture } from './courttex.js';
import { MAIN_FS, MAIN_VS, SHADOW_FS, SHADOW_VS } from './shaders.js';

const SHADOW_SIZE = 1024;
/** Teto por lote. O publico sozinho passa de mil caixas. */
const MAX_INSTANCES = 8192;
/** Floats por instancia: 16 da matriz + 4 do albedo/aspereza + 2 do afinamento. */
const STRIDE = 22;

export interface Material {
  color: [number, number, number];
  roughness: number;
}

/** Direcao DA luz para a cena. Refletor alto, um pouco atras da mesa. */
const LIGHT_DIR = (() => {
  const d = v3(0.3, 0.46, -0.84);
  const l = Math.hypot(d.x, d.y, d.z);
  return v3(d.x / l, d.y / l, d.z / l);
})();

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? 'erro desconhecido';
      gl.deleteShader(sh);
      throw new Error(`shader nao compilou: ${log}`);
    }
    return sh;
  };
  const p = gl.createProgram()!;
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`programa nao linkou: ${gl.getProgramInfoLog(p) ?? ''}`);
  }
  gl.deleteShader(v);
  gl.deleteShader(f);
  return p;
}

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  indexType: number;
  instances: Float32Array;
  instanceBuffer: WebGLBuffer;
  count: number;
}

export class Renderer3D {
  private gl: WebGL2RenderingContext;
  private main: WebGLProgram;
  private shadow: WebGLProgram;
  private shadowFbo: WebGLFramebuffer;
  private shadowTex: WebGLTexture;

  private tubeMesh!: GpuMesh;
  private sphereMesh!: GpuMesh;
  private boxMesh!: GpuMesh;
  /** Geometria estatica (quadra, piso, arquibancada) num unico buffer. */
  private staticMesh!: GpuMesh;
  private courtTex!: WebGLTexture;
  /** Assentos pre-sorteados: x, y, z, matiz. Mesma pessoa no mesmo lugar. */
  private seats: Float32Array = buildSeats();

  private viewProj = identity();
  private lightViewProj = identity();
  private tmp = identity();

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: true, depth: true, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 indisponivel');
    this.gl = gl;

    this.main = compile(gl, MAIN_VS, MAIN_FS);
    this.shadow = compile(gl, SHADOW_VS, SHADOW_FS);

    // Mapa de profundidade da luz.
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.tubeMesh = this.upload(tube(10));
    this.sphereMesh = this.upload(sphere(12, 8));
    this.boxMesh = this.upload(box());
    this.staticMesh = this.uploadStatic(buildArenaMesh());
    this.courtTex = gl.createTexture()!;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  private upload(mesh: MeshData): GpuMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_STRIDE, 12);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 2, gl.FLOAT, false, VERTEX_STRIDE, 24);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    const instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * STRIDE * 4, gl.DYNAMIC_DRAW);
    const bytes = STRIDE * 4;
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, bytes, i * 16);
      gl.vertexAttribDivisor(2 + i, 1);
    }
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, bytes, 64);
    gl.vertexAttribDivisor(6, 1);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 2, gl.FLOAT, false, bytes, 80);
    gl.vertexAttribDivisor(7, 1);

    gl.bindVertexArray(null);
    return {
      vao, indexCount: mesh.indices.length, indexType: gl.UNSIGNED_SHORT,
      instances: new Float32Array(MAX_INSTANCES * STRIDE), instanceBuffer, count: 0,
    };
  }

  private uploadStatic(data: { vertices: Float32Array; indices: Uint32Array; materials: Float32Array }): GpuMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_STRIDE, 12);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 2, gl.FLOAT, false, VERTEX_STRIDE, 24);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);

    // A arena inteira e UMA instancia com matriz identidade; a cor de cada
    // superficie ja esta assada na malha? Nao: cor por vertice exigiria outro
    // atributo. Em vez disso a arena e desenhada em lotes por material.
    const instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * STRIDE * 4, gl.DYNAMIC_DRAW);
    const bytes = STRIDE * 4;
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, bytes, i * 16);
      gl.vertexAttribDivisor(2 + i, 1);
    }
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, bytes, 64);
    gl.vertexAttribDivisor(6, 1);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 2, gl.FLOAT, false, bytes, 80);
    gl.vertexAttribDivisor(7, 1);

    gl.bindVertexArray(null);
    this.staticGroups = data.materials;
    return {
      vao, indexCount: data.indices.length, indexType: gl.UNSIGNED_INT,
      instances: new Float32Array(MAX_INSTANCES * STRIDE), instanceBuffer, count: 0,
    };
  }

  /** [inicio, contagem, r, g, b, aspereza, usaTextura] por grupo da arena. */
  private staticGroups: Float32Array = new Float32Array(0);

  // ------------------------------------------------------------ instancias

  private push(mesh: GpuMesh, m: Mat4, mat: Material, taperA = 1, taperB = 1): void {
    if (mesh.count >= MAX_INSTANCES) return;
    const o = mesh.count * STRIDE;
    mesh.instances.set(m, o);
    mesh.instances[o + 16] = mat.color[0];
    mesh.instances[o + 17] = mat.color[1];
    mesh.instances[o + 18] = mat.color[2];
    mesh.instances[o + 19] = mat.roughness;
    mesh.instances[o + 20] = taperA;
    mesh.instances[o + 21] = taperB;
    mesh.count++;
  }

  private flush(mesh: GpuMesh, program: WebGLProgram): void {
    if (mesh.count === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.instances.subarray(0, mesh.count * STRIDE));
    gl.useProgram(program);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0, mesh.count);
  }

  // ------------------------------------------------------------------ frame

  /** Monta a lista de instancias do quadro a partir do estado do jogo. */
  /** Energia da torcida deste quadro, guardada para `build` usar. */
  private crowd = 0.3;

  build(
    actors: { actor: Actor; colors: { primary: string; secondary: string; accent: string }; skin: [number, number, number] }[],
    ball: Ball,
    ballOwner: Vec3 | null,
    time: number,
    crowdEnergy = 0.3,
  ): void {
    this.crowd = crowdEnergy;
    this.tubeMesh.count = 0;
    this.sphereMesh.count = 0;
    this.boxMesh.count = 0;

    const m = identity();
    for (const info of actors) {
      const a = info.actor;
      if (!a.onCourt) continue;
      const rig = solveRig(a, info.actor === actors.find((x) => x.actor.hasBall)?.actor ? ballOwner : null, time);
      const p = proportionsOf(a);
      const jersey = hexRgb(info.colors.primary);
      const shorts = jersey.map((c) => c * 0.74) as [number, number, number];
      const shoe = hexRgb(info.colors.accent).map((c, i) => lerp(c, [0.96, 0.97, 0.99][i], 0.62) as number) as [number, number, number];

      const matOf = (skin: string): Material => {
        if (skin === 'jersey') return { color: jersey, roughness: 0.74 };
        if (skin === 'shorts') return { color: shorts, roughness: 0.78 };
        if (skin === 'shoe') return { color: shoe, roughness: 0.32 };
        return { color: info.skin, roughness: 0.56 };
      };

      for (const b of bonesOf(rig, a)) {
        boneMatrix(m, b.a, b.b, 1);
        this.push(this.tubeMesh, m, matOf(b.skin), b.rA, b.rB);
        // Esfera na juncao: fecha o tubo e da forma de articulacao.
        trs(m, b.b, v3(b.rB, b.rB, b.rB));
        this.push(this.sphereMesh, m, matOf(b.skin));
      }

      // Cabeca.
      trs(m, rig.head, v3(p.headRadius, p.headRadius, p.headRadius * 1.14));
      this.push(this.sphereMesh, m, { color: info.skin, roughness: 0.5 });
    }

    // Bola: laranja fosca, um pouco brilhante por causa do couro.
    trs(m, ball.pos, v3(COURT.ballRadius, COURT.ballRadius, COURT.ballRadius));
    this.push(this.sphereMesh, m, { color: [0.82, 0.36, 0.1], roughness: 0.55 });

    // Publico: uma caixa por pessoa. Instanciado, entao os ~1200 saem numa
    // chamada so -- e, ao contrario dos pontinhos do 2D, recebem a mesma luz
    // da arena e aparecem na sombra.
    for (let i = 0; i < this.seats.length; i += 4) {
      const sx = this.seats[i];
      const sy = this.seats[i + 1];
      const sz = this.seats[i + 2];
      const hue = this.seats[i + 3];
      const standing = hue > 1 - this.crowd * 0.85;
      const bob = standing ? Math.sin(time * 3.2 + i * 0.37) * 0.1 * this.crowd : 0;
      // Ombro a ombro, nao caixote: estreito, alto e baixo o bastante para
      // ler como gente sentada a distancia.
      const hh = standing ? 1.0 : 0.66;
      trs(m, v3(sx, sy, sz + hh * 0.5 + bob), v3(0.3, 0.3, hh));
      const c = CROWD_PALETTE[i % CROWD_PALETTE.length];
      this.push(this.boxMesh, m, { color: c, roughness: 0.95 });
    }

    // Tabelas e aros.
    for (const side of [0, 1] as const) {
      const hoop = hoopGround(side);
      const dir = side === 0 ? 1 : -1;
      const bx = hoop.x - dir * COURT.backboardFromBaseline * 0 - dir * 0.15;
      trs(m, v3(bx, hoop.y, COURT.backboardBottom + COURT.backboardHeight / 2),
        v3(0.05, COURT.backboardWidth, COURT.backboardHeight));
      this.push(this.boxMesh, m, { color: [0.86, 0.88, 0.92], roughness: 0.12 });

      // Aro: um anel de segmentos curtos, que e o que ele e.
      const seg = 16;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const pa = v3(hoop.x + Math.cos(a0) * COURT.rimRadius, hoop.y + Math.sin(a0) * COURT.rimRadius, COURT.rimHeight);
        const pb = v3(hoop.x + Math.cos(a1) * COURT.rimRadius, hoop.y + Math.sin(a1) * COURT.rimRadius, COURT.rimHeight);
        boneMatrix(m, pa, pb, 1);
        this.push(this.tubeMesh, m, { color: [0.92, 0.36, 0.08], roughness: 0.28 }, 0.018, 0.018);
      }
    }
  }

  /** Desenha o quadro: passe de sombra, depois passe principal. */
  render(cam: CameraState, width: number, height: number, crowdEnergy: number, shift = 0): void {
    const gl = this.gl;

    // --- Camera da luz: ortografica cobrindo a quadra inteira ---------------
    const center = v3(COURT.length / 2, COURT.width / 2, 1.2);
    const dist = 34;
    const eye = v3(center.x - LIGHT_DIR.x * dist, center.y - LIGHT_DIR.y * dist, center.z - LIGHT_DIR.z * dist);
    const lv = identity();
    lookAt(lv, eye, center, v3(0, 0, 1));
    const lp = identity();
    ortho(lp, -22, 22, -18, 18, 1, 70);
    multiply(this.lightViewProj, lp, lv);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadow);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadow, 'uLightViewProj'), false, this.lightViewProj);
    // Frente descartada no passe de sombra: tira o acne sem precisar de bias
    // grande, que e o que faz a sombra "descolar" do pe.
    gl.cullFace(gl.FRONT);
    this.flush(this.tubeMesh, this.shadow);
    this.flush(this.sphereMesh, this.shadow);
    this.flush(this.boxMesh, this.shadow);
    gl.cullFace(gl.BACK);

    // --- Passe principal ----------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.016, 0.024, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = identity();
    perspective(proj, cam.fov, width / Math.max(1, height), 0.15, 260, shift);
    const view = identity();
    lookAt(view, cam.pos, cam.target, v3(0, 0, 1));
    multiply(this.viewProj, proj, view);

    gl.useProgram(this.main);
    const u = (n: string) => gl.getUniformLocation(this.main, n);
    gl.uniformMatrix4fv(u('uViewProj'), false, this.viewProj);
    gl.uniformMatrix4fv(u('uLightViewProj'), false, this.lightViewProj);
    gl.uniform3f(u('uCamera'), cam.pos.x, cam.pos.y, cam.pos.z);
    gl.uniform3f(u('uLightDir'), LIGHT_DIR.x, LIGHT_DIR.y, LIGHT_DIR.z);
    // Refletor de ginasio e FORTE: a quadra e o ponto mais claro do lugar.
    gl.uniform3f(u('uLightColor'), 6.4, 6.3, 6.05);
    // O ambiente responde a torcida: arena quente acende mais.
    const glow = 1 + crowdEnergy * 0.35;
    gl.uniform3f(u('uSkyColor'), 0.30 * glow, 0.34 * glow, 0.44 * glow);
    // O retorno do verniz e quente e e ele que ilumina o queixo dos atletas.
    gl.uniform3f(u('uGroundColor'), 0.46 * glow, 0.34 * glow, 0.22 * glow);
    gl.uniform1f(u('uShadowTexel'), 1 / SHADOW_SIZE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(u('uShadow'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.courtTex);
    gl.uniform1i(u('uAlbedoMap'), 1);
    gl.uniform1f(u('uUseMap'), 0);

    this.drawStatic();
    this.flush(this.tubeMesh, this.main);
    this.flush(this.sphereMesh, this.main);
    this.flush(this.boxMesh, this.main);

    this.tmp.set(identity());
  }

  /** Arena e quadra: uma chamada de desenho por material. */
  private drawStatic(): void {
    const gl = this.gl;
    const mesh = this.staticMesh;
    const useMap = gl.getUniformLocation(this.main, 'uUseMap');
    gl.bindVertexArray(mesh.vao);
    const id = identity();
    for (let g = 0; g + 6 < this.staticGroups.length; g += 7) {
      const start = this.staticGroups[g];
      const count = this.staticGroups[g + 1];
      mesh.instances.set(id, 0);
      mesh.instances[16] = this.staticGroups[g + 2];
      mesh.instances[17] = this.staticGroups[g + 3];
      mesh.instances[18] = this.staticGroups[g + 4];
      mesh.instances[19] = this.staticGroups[g + 5];
      mesh.instances[20] = 1;
      mesh.instances[21] = 1;
      gl.uniform1f(useMap, this.staticGroups[g + 6]);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.instances.subarray(0, STRIDE));
      gl.drawElementsInstanced(gl.TRIANGLES, count, gl.UNSIGNED_INT, start * 4, 1);
    }
    // Volta ao padrao: corpos e bola usam cor por instancia, nao textura.
    gl.uniform1f(useMap, 0);
  }

  /**
   * Pinta a textura da quadra com as cores do mandante. Chamada quando a
   * partida comeca, nao a cada quadro: e uma imagem de ~900x500 px.
   */
  setCourt(homeColor: string, accent: string): void {
    const gl = this.gl;
    const canvas = paintCourtTexture(homeColor, accent);
    gl.bindTexture(gl.TEXTURE_2D, this.courtTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height);
  }
}

/** Roupas do publico, ja em linear. */
const CROWD_PALETTE: [number, number, number][] = [
  [0.020, 0.024, 0.040], [0.036, 0.020, 0.024], [0.016, 0.026, 0.038],
  [0.044, 0.038, 0.028], [0.028, 0.020, 0.024], [0.016, 0.032, 0.036],
  [0.060, 0.056, 0.060], [0.012, 0.016, 0.030],
];

/**
 * Assentos sorteados UMA vez com semente fixa: cada lugar tem sempre a mesma
 * pessoa, entre partidas e entre sessoes. Tres lados, porque a camera de
 * transmissao mora no quarto.
 */
function buildSeats(): Float32Array {
  const APRON = 2.6;
  const BOWL_DEPTH = 17;
  const BOWL_HEIGHT = 13.5;
  const TIERS = 9;
  const out: number[] = [];
  const hash = (n: number): number => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  let seat = 0;
  for (let i = 0; i < TIERS; i++) {
    const t0 = i / TIERS;
    const t1 = (i + 1) / TIERS;
    for (let row = 0; row < 2; row++) {
      const f = (row + 0.5) / 2;
      const d = APRON + BOWL_DEPTH * (t0 + (t1 - t0) * f);
      const z = BOWL_HEIGHT * Math.pow(t0 + (t1 - t0) * f, 0.82);
      // Fundo esquerdo, lado de la, fundo direito.
      const legs: [number, number, number, number][] = [
        [-d, -d, -d, COURT.width + d],
        [-d, COURT.width + d, COURT.length + d, COURT.width + d],
        [COURT.length + d, COURT.width + d, COURT.length + d, -d],
      ];
      for (const [x0, y0, x1, y1] of legs) {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(2, Math.round(len * 0.5));
        for (let k = 0; k < n; k++) {
          seat++;
          const u = (k + 0.5) / n;
          out.push(
            x0 + (x1 - x0) * u + (hash(seat * 3.1) - 0.5) * 0.5,
            y0 + (y1 - y0) * u + (hash(seat * 7.7) - 0.5) * 0.5,
            z,
            hash(seat * 1.37),
          );
        }
      }
    }
  }
  return new Float32Array(out);
}

const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  // Para linear: o shader trabalha em linear e devolve em sRGB no fim.
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
  return [srgb[0], srgb[1], srgb[2]];
};

/** Arena estatica: piso, quadra, apron e arquibancada, agrupados por material. */
function buildArenaMesh(): { vertices: Float32Array; indices: Uint32Array; materials: Float32Array } {
  const APRON = 2.6;
  const BOWL_DEPTH = 17;
  const BOWL_HEIGHT = 13.5;
  const TIERS = 9;

  const groups: number[] = [];
  const mb = new MeshBuilder();
  let cursor = 0;
  const closeGroup = (r: number, g: number, b: number, rough: number, mapped = 0): void => {
    const count = mb.count - cursor;
    if (count > 0) groups.push(cursor, count, Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2), rough, mapped);
    cursor = mb.count;
  };

  // Quadra: madeira envernizada, pouco aspera (e o brilho do verniz). As
  // marcacoes vem por textura, nao por geometria: centenas de quads finos
  // brigariam com o piso por profundidade (z-fighting).
  mb.quad([0, 0, 0], [COURT.length, 0, 0], [COURT.length, COURT.width, 0], [0, COURT.width, 0],
    [[0, 1], [1, 1], [1, 0], [0, 0]]);
  closeGroup(1, 1, 1, 0.2, 1);

  // Apron em volta.
  const a = APRON;
  mb.quad([-a, -a, -0.01], [COURT.length + a, -a, -0.01], [COURT.length + a, 0, -0.01], [-a, 0, -0.01]);
  mb.quad([-a, COURT.width, -0.01], [COURT.length + a, COURT.width, -0.01], [COURT.length + a, COURT.width + a, -0.01], [-a, COURT.width + a, -0.01]);
  mb.quad([-a, 0, -0.01], [0, 0, -0.01], [0, COURT.width, -0.01], [-a, COURT.width, -0.01]);
  mb.quad([COURT.length, 0, -0.01], [COURT.length + a, 0, -0.01], [COURT.length + a, COURT.width, -0.01], [COURT.length, COURT.width, -0.01]);
  // Piso escuro do ginasio, indo ate debaixo da camera.
  const N = 30;
  mb.quad([-N, -N, -0.02], [COURT.length + N, -N, -0.02], [COURT.length + N, COURT.width + N, -0.02], [-N, COURT.width + N, -0.02]);
  closeGroup(0.05, 0.055, 0.07, 0.8);

  // Arquibancada: tres lados, porque a camera mora no quarto.
  for (let i = 0; i < TIERS; i++) {
    const t0 = i / TIERS;
    const t1 = (i + 1) / TIERS;
    const inner = APRON + BOWL_DEPTH * t0;
    const outer = APRON + BOWL_DEPTH * t1;
    const z0 = BOWL_HEIGHT * Math.pow(t0, 0.82);
    const z1 = BOWL_HEIGHT * Math.pow(t1, 0.82);
    const pts = (d: number, z: number): [number, number, number][] => ([
      [-d, -d, z], [-d, COURT.width + d, z], [COURT.length + d, COURT.width + d, z], [COURT.length + d, -d, z],
    ]);
    const lowIn = pts(inner, z0);
    const highIn = pts(inner, z1);
    const highOut = pts(outer, z1);
    for (let k = 0; k + 1 < 4; k++) {
      mb.quad(lowIn[k], lowIn[k + 1], highIn[k + 1], highIn[k]);
      mb.quad(highIn[k], highIn[k + 1], highOut[k + 1], highOut[k]);
    }
  }
  closeGroup(0.055, 0.065, 0.09, 0.93);

  const built = mb.build();
  return { vertices: built.vertices, indices: built.indices, materials: new Float32Array(groups) };
}
