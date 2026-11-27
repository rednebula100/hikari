// 월드 — where the board stands. The lab is built by the stage; these are the places beyond it.
// Each world is a group (sky dome / surfaces / platform) plus a lighting recipe. Board, pieces, chalk and physics
// are shared. Shaders are hand-written and cheap: one sky dome and one surface each, no reflection passes.
import * as T from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type WorldId = 'lab' | 'sea' | 'clouds' | 'aurora' | 'orbit' | 'wr104';
export const WORLDS: { id: WorldId; name: string; sub: string }[] = [
  { id: 'lab', name: '밤의 실험실', sub: '텅스텐 램프 한 개' },
  { id: 'sea', name: '해 질 녘의 바다', sub: '수평선 위 작은 배' },
  { id: 'clouds', name: '달빛 구름 위', sub: '구름바다 위의 대리석 단' },
  { id: 'aurora', name: '오로라 빙원', sub: '북쪽 하늘이 흐른다' },
  { id: 'orbit', name: '궤도', sub: '발아래 푸른 행성' },
  { id: 'wr104', name: 'WR 104', sub: '울프-레이에 별의 바람개비' },
];
/** Problem tier → world: the higher the stars, the farther away the board is set. */
export const TIER_WORLD: WorldId[] = ['lab', 'lab', 'sea', 'sea', 'clouds', 'clouds', 'aurora', 'aurora', 'orbit', 'wr104'];

export interface Lighting {
  key: number; keyI: number; keyPos: [number, number, number]; keyAngle: number; penumbra: number
  rim: number; rimI: number; rimPos: [number, number, number]
  sky: number; gnd: number; hemiI: number
  fog: number; fogD: number; exposure: number; bg: number; env: number
}
export interface Built { group: T.Group; ground: T.Object3D; light: Lighting; update(t: number): void }

const GLSL = /* glsl */`
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h1(i), h1(i+vec2(1,0)), f.x), mix(h1(i+vec2(0,1)), h1(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a*n2(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return v; }
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbmS(vec3 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a*n3(p); p = p*2.05 + vec3(1.7, 9.2, 3.1); a *= .5; } return v; }
float fbm3(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 3; i++){ v += a*n2(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return v; }
vec3 stars(vec3 d, float dens, float t){
  vec2 uv = vec2(atan(d.z, d.x) / 6.2832 + .5, asin(clamp(d.y, -1., 1.)) / 3.1416 + .5) * vec2(900., 450.);
  vec2 c = floor(uv), f = fract(uv) - .5;
  float r = h1(c), on = step(1. - dens, r);
  float tw = .65 + .35*sin(t*1.7 + r*80.);
  float b = on * smoothstep(.16 + .14*h1(c+7.), 0., length(f)) * tw * (0.4 + 1.6*h1(c+2.));
  return b * mix(vec3(.78,.86,1.), vec3(1.,.88,.74), h1(c+3.));
}`;
const OUT = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
const VS_WORLD = 'varying vec3 wp; void main(){ vec4 w = modelMatrix*vec4(position,1.); wp = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }';
const VS_DIR = 'varying vec3 vd; void main(){ vd = normalize(position); vec4 w = modelMatrix*vec4(position,1.); gl_Position = projectionMatrix*viewMatrix*w; gl_Position.z = gl_Position.w*.99999; }';

function dome(frag: string, uniforms: Record<string, T.IUniform>) {
  const m = new T.Mesh(new T.SphereGeometry(500, 64, 32), new T.ShaderMaterial({
    uniforms: { t: { value: 0 }, ...uniforms }, vertexShader: VS_DIR, fragmentShader: GLSL + frag, side: T.BackSide, depthWrite: false, fog: false,
  }));
  m.renderOrder = -10; m.frustumCulled = false;
  return m;
}
function surface(frag: string, uniforms: Record<string, T.IUniform>, size = 1400, transparent = false) {
  const m = new T.Mesh(new T.PlaneGeometry(size, size), new T.ShaderMaterial({
    uniforms: { t: { value: 0 }, ...uniforms }, vertexShader: VS_WORLD, fragmentShader: GLSL + frag, transparent, depthWrite: !transparent, fog: false,
  }));
  m.rotation.x = -Math.PI / 2; m.frustumCulled = false;
  return m;
}
const c3 = (hex: number) => new T.Color(hex);
const dir = (x: number, y: number, z: number) => new T.Vector3(x, y, z).normalize();
const shadowed = (o: T.Object3D) => { o.traverse(x => { if ((x as T.Mesh).isMesh) { x.castShadow = true; x.receiveShadow = true; } }); return o; };

function plankTexture(base: string, line: string) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const g = cv.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 42) {
    g.fillStyle = `rgba(0,0,0,${.18 + Math.random() * .12})`; g.fillRect(x, 0, 2, 512);
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(255,220,170,${Math.random() * .05})`; g.beginPath(); const xx = x + 4 + Math.random() * 34; g.moveTo(xx, 0); g.bezierCurveTo(xx + 6, 160, xx - 6, 340, xx + 3, 512); g.stroke(); }
    const j = Math.random() * 512; g.fillStyle = line; g.fillRect(x, j, 42, 2);
  }
  const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ── ★3–4 해 질 녘의 바다 ───────────────────────────────────────────────
function sea(top: number): Built {
  const g = new T.Group(), far = new T.Group(); g.add(far);
  const sunDir = dir(0, Math.sin(2.6 * Math.PI / 180), 1);
  const sky = new Sky(); sky.scale.setScalar(480);
  const u = sky.material.uniforms;
  u.turbidity.value = 6.5; u.rayleigh.value = 2.4; u.mieCoefficient.value = .006; u.mieDirectionalG.value = .86; u.sunPosition.value.copy(sunDir);
  sky.renderOrder = -10; sky.frustumCulled = false;
  const ocean = surface(/* glsl */`
    uniform float t; uniform vec3 sunDir, horizon, zenith, deep, sunCol; varying vec3 wp;
    float H(vec2 p){ return fbm(p + vec2(t*.045, t*.028)) + .55*fbm(p*2.6 - vec2(t*.07, -t*.02)); }
    void main(){
      vec2 p = wp.xz*.07; float e = .05, h = H(p);
      vec3 n = normalize(vec3((h - H(p + vec2(e, 0.)))*2.4, 1., (h - H(p + vec2(0., e)))*2.4));
      vec3 v = normalize(cameraPosition - wp), r = reflect(-v, n);
      float fr = .02 + .98*pow(1. - max(dot(n, v), 0.), 5.);
      vec3 skyc = mix(horizon, zenith, clamp(r.y*2.2, 0., 1.));
      vec3 col = mix(deep*(.7 + .6*h), skyc, fr);
      float s = max(dot(r, sunDir), 0.);
      col += sunCol*(pow(s, 420.)*14. + pow(s, 40.)*.55);
      float d = length(wp.xz - cameraPosition.xz);
      col = mix(col, horizon, smoothstep(80., 520., d));
      gl_FragColor = vec4(col, 1.);${OUT}}`,
    { sunDir: { value: sunDir }, horizon: { value: c3(0xf08a52) }, zenith: { value: c3(0x37548a) }, deep: { value: c3(0x0b1d2b) }, sunCol: { value: c3(0xffd59a) } });
  ocean.position.y = top - 1.15;
  far.add(sky, ocean);
  // the little boat: a hull and a deck cut from the same outline, a lantern at the bow
  const outline = (s: number) => { const sh = new T.Shape(); sh.moveTo(-5.6 * s, -8 * s); sh.lineTo(5.6 * s, -8 * s); sh.quadraticCurveTo(6.4 * s, 4 * s, 0, 12 * s); sh.quadraticCurveTo(-6.4 * s, 4 * s, -5.6 * s, -8 * s); return sh; };
  const hull = new T.Mesh(new T.ExtrudeGeometry(outline(1), { depth: 2.6, bevelEnabled: true, bevelSize: .25, bevelThickness: .25, bevelSegments: 2, curveSegments: 24 }), new T.MeshStandardMaterial({ color: 0x2a1610, roughness: .6 }));
  hull.rotation.x = Math.PI / 2; hull.position.y = top - .3;
  const deck = new T.Mesh(new T.ExtrudeGeometry(outline(.94), { depth: .3, bevelEnabled: false, curveSegments: 24 }), new T.MeshStandardMaterial({ map: plankTexture('#6b4a30', 'rgba(0,0,0,.25)'), roughness: .75 }));
  (deck.material as T.MeshStandardMaterial).map!.repeat.set(.09, .09);
  deck.rotation.x = Math.PI / 2; deck.position.y = top;
  const rail = new T.Shape(); rail.add(outline(1)); rail.holes.push(outline(.93) as unknown as T.Path);
  const gun = new T.Mesh(new T.ExtrudeGeometry(rail, { depth: .45, bevelEnabled: false, curveSegments: 24 }), new T.MeshStandardMaterial({ color: 0x3b2216, roughness: .5 }));
  gun.rotation.x = Math.PI / 2; gun.position.y = top + .45;
  const post = new T.Mesh(new T.CylinderGeometry(.06, .08, 2.6, 8), new T.MeshStandardMaterial({ color: 0x2a1a10 })); post.position.set(0, top + 1.3, 10);
  const lamp = new T.Mesh(new T.SphereGeometry(.18, 16, 12), new T.MeshBasicMaterial({ color: 0xffd28a, toneMapped: false })); lamp.position.set(0, top + 2.65, 10);
  const pl = new T.PointLight(0xffb060, 9, 10, 1.6); pl.position.copy(lamp.position);
  const boat = new T.Group(); boat.add(shadowed(hull), shadowed(deck), shadowed(gun), post, lamp, pl); g.add(boat);
  return {
    group: g, ground: boat,
    light: { key: 0xffd6a8, keyI: 250, keyPos: [2, 11, -3], keyAngle: .9, penumbra: 1, rim: 0xff9a55, rimI: 1.6, rimPos: [0, 3, 40], sky: 0x8090c0, gnd: 0x3a2414, hemiI: .6, fog: 0xc98a6a, fogD: .0, exposure: .62, bg: 0x1a1420, env: .35 },
    update(t) {
      (ocean.material as T.ShaderMaterial).uniforms.t.value = t;
      // the sea and the sky roll; the boat — and the board — stay level for play
      far.rotation.z = Math.sin(t * .45) * .012; far.rotation.x = Math.sin(t * .31) * .008;
      (pl as T.PointLight).intensity = 8 + Math.sin(t * 9) * .4 + Math.sin(t * 23) * .3;
    },
  };
}

// ── ★5–6 달빛 구름 위 ─────────────────────────────────────────────────
function clouds(top: number): Built {
  const g = new T.Group();
  const moon = dir(-.3, .16, 1);
  const sky = dome(/* glsl */`
    uniform float t; uniform vec3 moon; varying vec3 vd;
    void main(){
      vec3 d = normalize(vd); float e = d.y;
      vec3 col = mix(vec3(.035,.05,.1), vec3(.008,.012,.035), smoothstep(-.1, .6, e));
      col += stars(d, .05, t) * smoothstep(-.05, .15, e);
      float m = dot(d, moon);
      vec3 q = d - moon*m; float rr = length(q) / .055;
      float disc = smoothstep(1., .97, rr);
      float maria = fbm(q.xy*60. + 3.) * .35;
      col = mix(col, vec3(1., .97, .9)*(1.05 - maria), disc);
      col += vec3(.55,.62,.85) * (pow(max(m, 0.), 900.)*.8 + pow(max(m, 0.), 60.)*.18 + pow(max(m, 0.), 8.)*.05);
      gl_FragColor = vec4(col, 1.);${OUT}}`, { moon: { value: moon } });
  const layer = (y: number, scale: number, speed: number, alpha: number) => {
    const m = surface(/* glsl */`
      uniform float t, scale, speed, alpha; uniform vec3 moon; varying vec3 wp;
      void main(){
        vec2 p = wp.xz*scale + vec2(t*speed, t*speed*.4);
        float f = fbm(p), dens = smoothstep(.36, .74, f);
        float lit = clamp((f - fbm(p + moon.xz*.35))*4. + .55, 0., 1.);
        vec3 col = mix(vec3(.03,.04,.085), vec3(.66,.72,.9), pow(lit, 1.4)*dens);
        col += vec3(.06,.07,.1)*dens;
        float d = length(wp.xz - cameraPosition.xz);
        vec3 haze = vec3(.035,.05,.1);
        col = mix(col, haze, smoothstep(60., 480., d));
        gl_FragColor = vec4(col, alpha*mix(dens, 1., smoothstep(200., 480., d)));${OUT}}`,
      { scale: { value: scale }, speed: { value: speed }, alpha: { value: alpha }, moon: { value: moon } }, 1400, alpha < 1);
    m.position.y = y; return m;
  };
  const base = layer(top - 9, .012, .004, 1), upper = layer(top - 3.5, .028, .010, .82);
  upper.renderOrder = 2;
  const slab = new T.Mesh(new T.BoxGeometry(12, .8, 12), new T.MeshStandardMaterial({ color: 0xd8d2c8, roughness: .28, metalness: .02 })); slab.position.y = top - .4;
  const trim = new T.Mesh(new T.BoxGeometry(12.3, .14, 12.3), new T.MeshStandardMaterial({ color: 0xb59252, metalness: .95, roughness: .3 })); trim.position.y = top - .06;
  const rock = new T.Mesh(new T.ConeGeometry(7.6, 6.5, 4, 1), new T.MeshStandardMaterial({ color: 0x3c3a40, roughness: .9, flatShading: true }));
  rock.rotation.set(Math.PI, Math.PI / 4, 0); rock.position.y = top - .8 - 3.25;
  const ground = new T.Group(); ground.add(shadowed(slab), shadowed(trim), rock);
  g.add(sky, base, upper, ground);
  return {
    group: g, ground,
    light: { key: 0xc6d4ff, keyI: 190, keyPos: [-3, 12, 3], keyAngle: .95, penumbra: 1, rim: 0xa9bbff, rimI: 1.4, rimPos: [-12, 6, 40], sky: 0x2a3c6a, gnd: 0x0a0c18, hemiI: .5, fog: 0x0b1328, fogD: .0, exposure: 1, bg: 0x060a16, env: .2 },
    update(t) { for (const m of [sky, base, upper]) (m.material as T.ShaderMaterial).uniforms.t.value = t; },
  };
}

// ── ★7–8 오로라 빙원 ──────────────────────────────────────────────────
function aurora(top: number): Built {
  const g = new T.Group();
  const AUR = /* glsl */`
    vec3 aurora(vec3 d, float t){
      if (d.y < -.02) return vec3(0.);
      float ang = atan(d.x, d.z), acc = 0.; vec3 col = vec3(0.);
      for (int i = 0; i < 3; i++){
        float fi = float(i);
        float lo = .06 + .05*sin(ang*1.6 + t*.07 + fi*1.9) + .04*fbm3(vec2(ang*2. + fi*3., t*.03));
        float e = d.y - lo;
        float band = smoothstep(-.012, .02, e) * exp(-max(e, 0.)*(9. - fi*2.));
        float rays = .55 + .45*sin(ang*140. + fbm3(vec2(ang*6., t*.12 + fi))*24.);
        float w = band * rays * (.6 + .4*fbm3(vec2(ang*4. - t*.05, fi)));
        col += w * mix(vec3(.15,1.,.55), vec3(.85,.3,1.), smoothstep(0., .35, e)) * (1. - fi*.25);
      }
      return col * smoothstep(-.02, .04, d.y);
    }`;
  const sky = dome(AUR + /* glsl */`
    uniform float t; varying vec3 vd;
    void main(){
      vec3 d = normalize(vd);
      vec3 col = mix(vec3(.02,.07,.09), vec3(.004,.012,.024), smoothstep(-.05, .5, d.y));
      col += stars(d, .045, t) * smoothstep(0., .2, d.y);
      col += aurora(d, t) * 1.4;
      gl_FragColor = vec4(col, 1.);${OUT}}`, {});
  const snow = surface(AUR + /* glsl */`
    uniform float t; varying vec3 wp;
    void main(){
      vec3 v = normalize(cameraPosition - wp);
      vec2 p = wp.xz*.15; float h = fbm(p*.3);
      vec3 col = mix(vec3(.07,.1,.13), vec3(.14,.19,.24), h);
      vec3 sky = aurora(normalize(vec3(-v.x, .1, -v.z)), t);
      float d = length(wp.xz - cameraPosition.xz);
      col += sky*.22*smoothstep(10., 90., d);
      vec2 c = floor(wp.xz*7.); float sp = step(.992, h1(c)) * pow(max(0., sin(t*2.5 + h1(c+1.)*40.)), 10.) * smoothstep(40., 12., d);
      col += vec3(.7,.9,1.)*sp;
      col = mix(col, vec3(.015,.045,.055), smoothstep(60., 420., d));
      gl_FragColor = vec4(col, 1.);${OUT}}`, {});
  snow.position.y = top - 1.2;
  // far mountains: a jagged ring
  const ring = new T.CylinderGeometry(330, 330, 1, 256, 1, true), pa = ring.getAttribute('position');
  for (let i = 0; i < pa.count; i++) if (pa.getY(i) > 0) { const a = Math.atan2(pa.getZ(i), pa.getX(i)); const h = 14 + 22 * Math.abs(Math.sin(a * 3.1)) * (.5 + .5 * Math.sin(a * 17.3)) + 10 * Math.sin(a * 41) ** 2; pa.setY(i, h); } else pa.setY(i, 0);
  ring.computeVertexNormals();
  const mtn = new T.Mesh(ring, new T.MeshBasicMaterial({ color: 0x050d12, side: T.BackSide, fog: false })); mtn.position.y = top - 1.2;
  const ice = new T.Mesh(new T.BoxGeometry(12, 1.2, 12), new T.MeshPhysicalMaterial({ color: 0xbfe6f2, roughness: .06, clearcoat: 1, metalness: 0, transparent: true, opacity: .93 }));
  ice.position.y = top - .6;
  const ground = new T.Group(); ground.add(shadowed(ice));
  g.add(sky, snow, mtn, ground);
  return {
    group: g, ground,
    light: { key: 0xe4f4ff, keyI: 200, keyPos: [2, 12, -2], keyAngle: .95, penumbra: 1, rim: 0x5effb6, rimI: .6, rimPos: [0, 8, 40], sky: 0x1c4a50, gnd: 0x0a141a, hemiI: .55, fog: 0x06141a, fogD: 0, exposure: 1, bg: 0x02070a, env: .25 },
    update(t) { (sky.material as T.ShaderMaterial).uniforms.t.value = t; (snow.material as T.ShaderMaterial).uniforms.t.value = t; },
  };
}

// ── ★9 궤도 ──────────────────────────────────────────────────────────
function orbit(top: number): Built {
  const g = new T.Group();
  const sun = dir(.6, .35, -.7);
  const sky = dome(/* glsl */`
    uniform float t; varying vec3 vd;
    void main(){
      vec3 d = normalize(vd), N = normalize(vec3(.3, .8, .5));
      float band = exp(-pow(dot(d, N)*5., 2.));
      vec3 col = band * (vec3(.10,.09,.13) + vec3(.35,.3,.45)*fbm(vec2(atan(d.z, d.x)*6., d.y*6.))) * .6;
      col += stars(d, .11, t) * (1. + band*1.5);
      gl_FragColor = vec4(col, 1.);${OUT}}`, {});
  const planet = new T.Mesh(new T.SphereGeometry(160, 128, 96), new T.ShaderMaterial({
    uniforms: { t: { value: 0 }, sun: { value: sun } }, fog: false,
    vertexShader: 'varying vec3 n; varying vec3 wp; void main(){ n = normalize(normal); vec4 w = modelMatrix*vec4(position,1.); wp = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: GLSL + /* glsl */`
      uniform float t; uniform vec3 sun; varying vec3 n; varying vec3 wp;
      void main(){
        float land = smoothstep(.5, .56, fbmS(n*2.4 + 4.));
        vec3 surf = mix(vec3(.02,.09,.22), mix(vec3(.13,.24,.1), vec3(.36,.3,.2), fbmS(n*9.)), land);
        float cl = smoothstep(.5, .8, fbmS(n*4.5 + vec3(t*.004, 0., 0.)) * .7 + fbmS(n*13.)*.35);
        float l = max(dot(n, sun), 0.);
        vec3 col = mix(surf, vec3(.95), cl) * (l*1.15 + .015);
        float night = smoothstep(.1, -.1, dot(n, sun));
        col += night * land * (1. - cl) * step(.9, h3(floor(n*300.))) * vec3(1., .75, .4) * .9;
        vec3 v = normalize(cameraPosition - wp);
        float rim = pow(1. - max(dot(n, v), 0.), 3.);
        col += vec3(.25,.55,1.) * rim * (.25 + l) * 1.2;
        gl_FragColor = vec4(col, 1.);${OUT}}`,
  }));
  planet.position.set(0, top - 230, 170);
  const atmo = new T.Mesh(new T.SphereGeometry(168, 96, 64), new T.ShaderMaterial({
    uniforms: { sun: { value: sun } }, transparent: true, depthWrite: false, side: T.BackSide, blending: T.AdditiveBlending, fog: false,
    vertexShader: 'varying vec3 n; varying vec3 wp; void main(){ n = normalize(normal); vec4 w = modelMatrix*vec4(position,1.); wp = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform vec3 sun; varying vec3 n; varying vec3 wp; void main(){ vec3 v = normalize(cameraPosition - wp); float r = pow(max(0., 1. - abs(dot(-n, v))*1.6), 3.); float l = .25 + max(dot(-n, sun), 0.); gl_FragColor = vec4(vec3(.3,.6,1.)*r*l, 1.);${OUT}}`,
  }));
  atmo.position.copy(planet.position);
  const plate = new T.Mesh(new T.CylinderGeometry(7.6, 7.2, .7, 6), new T.MeshStandardMaterial({ color: 0x1a1d22, metalness: .85, roughness: .32 }));
  plate.position.y = top - .35; plate.rotation.y = Math.PI / 6;
  const glow = new T.Mesh(new T.CylinderGeometry(7.65, 7.65, .06, 6, 1, true), new T.MeshBasicMaterial({ color: 0x6fb2ff, toneMapped: false, side: T.DoubleSide }));
  glow.position.y = top - .05; glow.rotation.y = Math.PI / 6;
  const ground = new T.Group(); ground.add(shadowed(plate), glow);
  g.add(sky, planet, atmo, ground);
  return {
    group: g, ground,
    light: { key: 0xfff3e2, keyI: 260, keyPos: [6, 12, -4], keyAngle: .9, penumbra: .55, rim: 0x5a9cff, rimI: 1.2, rimPos: [0, -10, 20], sky: 0x0a0f1a, gnd: 0x0a2240, hemiI: .3, fog: 0, fogD: 0, exposure: 1, bg: 0x000000, env: .18 },
    update(t) { (sky.material as T.ShaderMaterial).uniforms.t.value = t; (planet.material as T.ShaderMaterial).uniforms.t.value = t; planet.rotation.y = t * .004; },
  };
}

// ── ★10 WR 104 ───────────────────────────────────────────────────────
function wr104(top: number): Built {
  const g = new T.Group();
  const C = dir(0, -.28, 1), U = new T.Vector3().crossVectors(C, new T.Vector3(0, 1, 0)).normalize(), V = new T.Vector3().crossVectors(U, C).normalize();
  const sky = dome(/* glsl */`
    uniform float t; uniform vec3 C, U, V; varying vec3 vd;
    void main(){
      vec3 d = normalize(vd);
      vec3 col = stars(d, .09, t) * .9;
      float k = dot(d, C);
      if (k > 0.) {
        vec2 q = vec2(dot(d, U), dot(d, V)) / k;
        float r = length(q), th = atan(q.y, q.x);
        q *= 1.5; r = length(q);
        float arm = .5 + .5*cos(th + log(r + .015)*4.2 - t*.03);
        float spiral = pow(arm, 3.) * exp(-r*2.2) * (.35 + .65*smoothstep(.02, .25, r));
        float dust = fbm(q*5. + vec2(t*.01, 0.));
        vec3 neb = mix(vec3(.55,.18,1.), vec3(1.,.3,.62), smoothstep(.0, .7, r)) * spiral * (.55 + dust);
        neb += vec3(1.,.66,.38) * exp(-r*9.) * 1.6;
        neb += vec3(.22,.08,.35) * exp(-r*1.2) * dust * .8;
        float core = exp(-r*60.)*8.;
        col += neb*1.6 + vec3(1.,.95,1.)*core;
        col += vec3(.7,.5,1.) * pow(max(0., 1. - abs(q.y - q.x*.02)*30.), 4.) * exp(-abs(q.x)*3.) * .5;
      }
      gl_FragColor = vec4(col, 1.);${OUT}}`, { C: { value: C }, U: { value: U }, V: { value: V } });
  const slab = new T.Mesh(new T.BoxGeometry(12, .7, 12), new T.MeshPhysicalMaterial({ color: 0x0c0a12, metalness: .2, roughness: .1, clearcoat: 1 })); slab.position.y = top - .35;
  const edge = new T.MeshBasicMaterial({ color: 0xc08bff, toneMapped: false });
  const ground = new T.Group(); ground.add(shadowed(slab));
  for (const [x, z, w, d] of [[0, 6.02, 12, .05], [0, -6.02, 12, .05], [6.02, 0, .05, 12], [-6.02, 0, .05, 12]]) { const e = new T.Mesh(new T.BoxGeometry(w, .05, d), edge); e.position.set(x, top - .02, z); ground.add(e); }
  g.add(sky, ground);
  return {
    group: g, ground,
    light: { key: 0xf2dcff, keyI: 240, keyPos: [0, 12, 2], keyAngle: .9, penumbra: .8, rim: 0xb07bff, rimI: 1.6, rimPos: [0, -2, 40], sky: 0x2a1046, gnd: 0x06030c, hemiI: .5, fog: 0, fogD: 0, exposure: 1, bg: 0x000000, env: .2 },
    update(t) { (sky.material as T.ShaderMaterial).uniforms.t.value = t; },
  };
}

export function buildWorld(id: Exclude<WorldId, 'lab'>, top: number): Built {
  return { sea, clouds, aurora, orbit, wr104 }[id](top);
}
