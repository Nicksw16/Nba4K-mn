/**
 * SHADERS (secoes 40 e 100).
 *
 * BRDF Cook-Torrance: GGX para a distribuicao das microfacetas, Smith para a
 * oclusao geometrica, Schlick para Fresnel. E o mesmo modelo que qualquer
 * motor PBR usa; o que nao temos sao texturas escaneadas, entao os parametros
 * (albedo, aspereza, metalicidade) vem por instancia em vez de vir de mapas.
 *
 * A luz da arena e uma direcional com shadow map, mais um ambiente hemisferico
 * barato: ceu frio em cima, bounce quente do verniz embaixo. Num ginasio esse
 * bounce do piso e forte de verdade -- e o que ilumina o queixo dos atletas.
 */

/** Passe principal: geometria instanciada. */
export const MAIN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 8) in vec2 aUV;
// Por instancia: matriz do modelo em quatro colunas.
layout(location = 2) in vec4 iM0;
layout(location = 3) in vec4 iM1;
layout(location = 4) in vec4 iM2;
layout(location = 5) in vec4 iM3;
layout(location = 6) in vec4 iAlbedo;       // rgb + aspereza
layout(location = 7) in vec2 iTaper;        // raio na base, raio no topo

uniform mat4 uViewProj;
uniform mat4 uLightViewProj;

out vec3 vWorld;
out vec3 vNormal;
out vec4 vLightSpace;
out vec4 vAlbedo;
out vec2 vUV;

void main() {
  mat4 model = mat4(iM0, iM1, iM2, iM3);

  // Afinamento: o raio interpola ao longo do eixo local Z. E isso que faz uma
  // unica malha de tubo servir para coxa, panturrilha, braco e tronco.
  float t = clamp(aPos.z, 0.0, 1.0);
  float r = mix(iTaper.x, iTaper.y, t);
  vec3 local = vec3(aPos.xy * r, aPos.z);

  vec4 world = model * vec4(local, 1.0);
  vWorld = world.xyz;

  // Normal do cone, nao do cilindro: com raios diferentes a superficie
  // inclina, e usar a normal do cilindro deixaria a iluminacao chapada.
  vec3 n = aNormal;
  if (abs(iTaper.x - iTaper.y) > 1e-5) {
    float dr = iTaper.y - iTaper.x;
    n = normalize(vec3(aNormal.xy, -dr));
  }
  mat3 nm = mat3(model);
  vNormal = normalize(nm * n);

  vLightSpace = uLightViewProj * world;
  vAlbedo = iAlbedo;
  vUV = aUV;
  gl_Position = uViewProj * world;
}`;

export const MAIN_FS = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec4 vLightSpace;
in vec4 vAlbedo;
in vec2 vUV;

uniform vec3 uCamera;
uniform sampler2D uAlbedoMap;
uniform float uUseMap;
uniform vec3 uLightDir;     // direcao DA luz para a cena
uniform vec3 uLightColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform sampler2D uShadow;
uniform float uShadowTexel;

out vec4 outColor;

const float PI = 3.14159265359;

float distributionGGX(vec3 N, vec3 H, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

float geometrySchlick(float NdotV, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float rough) {
  return geometrySchlick(max(dot(N, V), 0.0), rough)
       * geometrySchlick(max(dot(N, L), 0.0), rough);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

/**
 * Sombra com PCF 3x3. O bias acompanha o angulo: superficie quase paralela a
 * luz precisa de mais folga, senao aparece shadow acne (aquelas listras).
 */
float shadowFactor(vec3 N, vec3 L) {
  vec3 proj = vLightSpace.xyz / vLightSpace.w;
  proj = proj * 0.5 + 0.5;
  if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) return 1.0;

  float bias = max(0.0016 * (1.0 - dot(N, L)), 0.00035);
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float d = texture(uShadow, proj.xy + vec2(float(x), float(y)) * uShadowTexel).r;
      lit += (proj.z - bias) > d ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamera - vWorld);
  // Normal de duas faces: o tubo e aberto, entao o interior aparece de raspao.
  if (dot(N, V) < 0.0) N = -N;

  vec3 L = normalize(-uLightDir);
  vec3 H = normalize(V + L);

  vec3 albedo = vAlbedo.rgb;
  if (uUseMap > 0.5) {
    // Textura vem em sRGB; o calculo e linear.
    vec3 tex = texture(uAlbedoMap, vUV).rgb;
    albedo = pow(tex, vec3(2.2));
  }
  float rough = clamp(vAlbedo.a, 0.06, 1.0);
  // Sem metais em quadra: pele, tecido e madeira sao todos dieletricos.
  vec3 F0 = vec3(0.04);

  float NdotL = max(dot(N, L), 0.0);
  float D = distributionGGX(N, H, rough);
  float G = geometrySmith(N, V, L, rough);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

  vec3 spec = (D * G * F) / max(4.0 * max(dot(N, V), 0.0) * NdotL, 1e-5);
  vec3 kD = (vec3(1.0) - F);

  float shadow = shadowFactor(N, L);
  vec3 direct = (kD * albedo / PI + spec) * uLightColor * NdotL * shadow;

  // Ambiente hemisferico: ceu em cima, bounce do verniz embaixo. Num ginasio
  // esse retorno do piso e forte e e ele que ilumina o queixo dos atletas.
  float up = N.z * 0.5 + 0.5;
  vec3 ambient = mix(uGroundColor, uSkyColor, up) * albedo;

  vec3 color = direct + ambient;

  // Tone mapping ACES aproximado e gamma. Sem isso o realce estoura em branco
  // chapado e a imagem parece plastico.
  color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
  color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));

  outColor = vec4(color, 1.0);
}`;

/** Passe de sombra: so profundidade, mesma deformacao do vertex principal. */
export const SHADOW_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 2) in vec4 iM0;
layout(location = 3) in vec4 iM1;
layout(location = 4) in vec4 iM2;
layout(location = 5) in vec4 iM3;
layout(location = 7) in vec2 iTaper;

uniform mat4 uLightViewProj;

void main() {
  mat4 model = mat4(iM0, iM1, iM2, iM3);
  float t = clamp(aPos.z, 0.0, 1.0);
  float r = mix(iTaper.x, iTaper.y, t);
  gl_Position = uLightViewProj * model * vec4(vec3(aPos.xy * r, aPos.z), 1.0);
}`;

export const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}`;
