// FFT ocean — a port of David Li's "waves" (https://github.com/dli/waves, MIT, © 2014 David Li) to three.js.
// The simulation is the original: an oceanographic wind-wave spectrum, per-frame phase advance, a Stockham GPU FFT
// that produces a choppy displacement map, and a normal map. What changed: WebGL passes became three.js render
// targets and ShaderMaterials; the surface shading reflects a sunset sky instead of a flat colour; world units are
// scaled so a 250 m patch tiles around the boat.
import * as T from 'three';

const N = 256;              // FFT resolution (original: 512)
const PATCH = 250;          // metres per simulated patch (original INITIAL_SIZE)
const UNITS_PER_METRE = .4;  // the board is a giant on this sea: 1 m of swell ≈ .4 squares

const FULLSCREEN_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

const SUBTRANSFORM_FS = /* glsl */`
precision highp float;
const float PI = 3.14159265359;
uniform sampler2D u_input; uniform float u_transformSize; uniform float u_subtransformSize;
varying vec2 vUv;
vec2 multiplyComplex(vec2 a, vec2 b){ return vec2(a[0]*b[0] - a[1]*b[1], a[1]*b[0] + a[0]*b[1]); }
void main(){
  #ifdef HORIZONTAL
  float index = vUv.x * u_transformSize - 0.5;
  #else
  float index = vUv.y * u_transformSize - 0.5;
  #endif
  float evenIndex = floor(index / u_subtransformSize) * (u_subtransformSize * 0.5) + mod(index, u_subtransformSize * 0.5);
  #ifdef HORIZONTAL
  vec4 even = texture2D(u_input, vec2(evenIndex + 0.5, gl_FragCoord.y) / u_transformSize);
  vec4 odd = texture2D(u_input, vec2(evenIndex + u_transformSize * 0.5 + 0.5, gl_FragCoord.y) / u_transformSize);
  #else
  vec4 even = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + 0.5) / u_transformSize);
  vec4 odd = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + u_transformSize * 0.5 + 0.5) / u_transformSize);
  #endif
  float twiddleArgument = -2.0 * PI * (index / u_subtransformSize);
  vec2 twiddle = vec2(cos(twiddleArgument), sin(twiddleArgument));
  gl_FragColor = vec4(even.xy + multiplyComplex(twiddle, odd.xy), even.zw + multiplyComplex(twiddle, odd.zw));
}`;

const INITIAL_SPECTRUM_FS = /* glsl */`
precision highp float;
const float PI = 3.14159265359; const float G = 9.81; const float KM = 370.0; const float CM = 0.23;
uniform vec2 u_wind; uniform float u_resolution; uniform float u_size;
float square(float x){ return x * x; }
float omega(float k){ return sqrt(G * k * (1.0 + square(k / KM))); }
float tanh_(float x){ return (1.0 - exp(-2.0 * x)) / (1.0 + exp(-2.0 * x)); }
void main(){
  vec2 coordinates = gl_FragCoord.xy - 0.5;
  float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
  float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
  vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;
  float k = length(waveVector);
  float U10 = length(u_wind);
  float Omega = 0.84;
  float kp = G * square(Omega / U10);
  float c = omega(k) / k; float cp = omega(kp) / kp;
  float Lpm = exp(-1.25 * square(kp / k));
  float gamma = 1.7;
  float sigma = 0.08 * (1.0 + 4.0 * pow(Omega, -3.0));
  float Gamma = exp(-square(sqrt(k / kp) - 1.0) / 2.0 * square(sigma));
  float Jp = pow(gamma, Gamma);
  float Fp = Lpm * Jp * exp(-Omega / sqrt(10.0) * (sqrt(k / kp) - 1.0));
  float alphap = 0.006 * sqrt(Omega);
  float Bl = 0.5 * alphap * cp / c * Fp;
  float z0 = 0.000037 * square(U10) / G * pow(U10 / cp, 0.9);
  float uStar = 0.41 * U10 / log(10.0 / z0);
  float alpham = 0.01 * ((uStar < CM) ? (1.0 + log(uStar / CM)) : (1.0 + 3.0 * log(uStar / CM)));
  float Fm = exp(-0.25 * square(k / KM - 1.0));
  float Bh = 0.5 * alpham * CM / c * Fm * Lpm;
  float a0 = log(2.0) / 4.0; float am = 0.13 * uStar / CM;
  float Delta = tanh_(a0 + 4.0 * pow(c / cp, 2.5) + am * pow(CM / c, 2.5));
  float cosPhi = dot(normalize(u_wind), normalize(waveVector));
  float S = (1.0 / (2.0 * PI)) * pow(k, -4.0) * (Bl + Bh) * (1.0 + Delta * (2.0 * cosPhi * cosPhi - 1.0));
  float dk = 2.0 * PI / u_size;
  float h = sqrt(S / 2.0) * dk;
  if (waveVector.x == 0.0 && waveVector.y == 0.0) h = 0.0;
  gl_FragColor = vec4(h, 0.0, 0.0, 0.0);
}`;

const PHASE_FS = /* glsl */`
precision highp float;
const float PI = 3.14159265359; const float G = 9.81; const float KM = 370.0;
varying vec2 vUv;
uniform sampler2D u_phases; uniform float u_deltaTime; uniform float u_resolution; uniform float u_size;
float omega(float k){ return sqrt(G * k * (1.0 + k * k / KM * KM)); }
void main(){
  vec2 coordinates = gl_FragCoord.xy - 0.5;
  float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
  float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
  vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;
  float phase = texture2D(u_phases, vUv).r;
  phase = mod(phase + omega(length(waveVector)) * u_deltaTime, 2.0 * PI);
  gl_FragColor = vec4(phase, 0.0, 0.0, 0.0);
}`;

const SPECTRUM_FS = /* glsl */`
precision highp float;
const float PI = 3.14159265359; const float G = 9.81; const float KM = 370.0;
varying vec2 vUv;
uniform float u_size; uniform float u_resolution; uniform sampler2D u_phases; uniform sampler2D u_initialSpectrum; uniform float u_choppiness;
vec2 multiplyComplex(vec2 a, vec2 b){ return vec2(a[0]*b[0] - a[1]*b[1], a[1]*b[0] + a[0]*b[1]); }
vec2 multiplyByI(vec2 z){ return vec2(-z[1], z[0]); }
void main(){
  vec2 coordinates = gl_FragCoord.xy - 0.5;
  float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
  float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
  vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;
  float phase = texture2D(u_phases, vUv).r;
  vec2 phaseVector = vec2(cos(phase), sin(phase));
  vec2 h0 = texture2D(u_initialSpectrum, vUv).rg;
  vec2 h0Star = texture2D(u_initialSpectrum, vec2(1.0 - vUv + 1.0 / u_resolution)).rg;
  h0Star.y *= -1.0;
  vec2 h = multiplyComplex(h0, phaseVector) + multiplyComplex(h0Star, vec2(phaseVector.x, -phaseVector.y));
  vec2 hX = -multiplyByI(h * (waveVector.x / length(waveVector))) * u_choppiness;
  vec2 hZ = -multiplyByI(h * (waveVector.y / length(waveVector))) * u_choppiness;
  if (waveVector.x == 0.0 && waveVector.y == 0.0){ h = vec2(0.0); hX = vec2(0.0); hZ = vec2(0.0); }
  gl_FragColor = vec4(hX + multiplyByI(h), hZ);
}`;

const NORMAL_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D u_displacementMap; uniform float u_resolution; uniform float u_size;
void main(){
  float texel = 1.0 / u_resolution, texelSize = u_size / u_resolution;
  vec3 center = texture2D(u_displacementMap, vUv).rgb;
  vec3 right = vec3(texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUv + vec2(texel, 0.0)).rgb - center;
  vec3 left = vec3(-texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUv + vec2(-texel, 0.0)).rgb - center;
  vec3 top = vec3(0.0, 0.0, -texelSize) + texture2D(u_displacementMap, vUv + vec2(0.0, -texel)).rgb - center;
  vec3 bottom = vec3(0.0, 0.0, texelSize) + texture2D(u_displacementMap, vUv + vec2(0.0, texel)).rgb - center;
  gl_FragColor = vec4(normalize(cross(right, top) + cross(top, left) + cross(left, bottom) + cross(bottom, right)), 1.0);
}`;

export class FFTOcean {
  readonly mesh: T.Mesh;
  private quad = new T.Mesh(new T.PlaneGeometry(2, 2));
  private qScene = new T.Scene(); private qCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  rt: Record<string, T.WebGLRenderTarget> = {};
  private mats: Record<string, T.ShaderMaterial> = {};
  private pingPhase = true; private ready = false; private last = 0;

  constructor(opts: { wind?: [number, number]; choppiness?: number; sunDir: T.Vector3; horizon: T.Color; zenith: T.Color; deep: T.Color; sunCol: T.Color }) {
    const mk = (filter: T.MagnificationTextureFilter, wrap: T.Wrapping = T.ClampToEdgeWrapping) => new T.WebGLRenderTarget(N, N, {
      type: T.FloatType, format: T.RGBAFormat, minFilter: filter as T.MinificationTextureFilter, magFilter: filter, wrapS: wrap, wrapT: wrap, depthBuffer: false, generateMipmaps: false,
    });
    for (const k of ['initial', 'pongPhase', 'spectrum', 'pingT', 'pongT']) this.rt[k] = mk(T.NearestFilter);
    this.rt.initial.texture.wrapS = this.rt.initial.texture.wrapT = T.RepeatWrapping;
    this.rt.displacement = mk(T.LinearFilter, T.RepeatWrapping);
    this.rt.normal = mk(T.LinearFilter, T.RepeatWrapping);
    // phases start random (the only randomness in the simulation, as in the original)
    const ph = new Float32Array(N * N * 4); for (let i = 0; i < N * N; i++) ph[i * 4] = Math.random() * Math.PI * 2;
    const pingPhase = new T.DataTexture(ph, N, N, T.RGBAFormat, T.FloatType); pingPhase.needsUpdate = true;
    this.rt.pingPhase = mk(T.NearestFilter);
    this.seed = pingPhase;
    const sm = (fs: string, uniforms: Record<string, T.IUniform>, defines: Record<string, string> = {}) =>
      new T.ShaderMaterial({ vertexShader: FULLSCREEN_VS, fragmentShader: fs, uniforms, defines, depthTest: false, depthWrite: false });
    this.mats.hSub = sm(SUBTRANSFORM_FS, { u_input: { value: null }, u_transformSize: { value: N }, u_subtransformSize: { value: 0 } }, { HORIZONTAL: '' });
    this.mats.vSub = sm(SUBTRANSFORM_FS, { u_input: { value: null }, u_transformSize: { value: N }, u_subtransformSize: { value: 0 } });
    this.mats.initial = sm(INITIAL_SPECTRUM_FS, { u_wind: { value: new T.Vector2(...(opts.wind ?? [6, 6])) }, u_resolution: { value: N }, u_size: { value: PATCH } });
    this.mats.phase = sm(PHASE_FS, { u_phases: { value: null }, u_deltaTime: { value: 0 }, u_resolution: { value: N }, u_size: { value: PATCH } });
    this.mats.spectrum = sm(SPECTRUM_FS, { u_size: { value: PATCH }, u_resolution: { value: N }, u_phases: { value: null }, u_initialSpectrum: { value: this.rt.initial.texture }, u_choppiness: { value: opts.choppiness ?? 1.5 } });
    this.mats.normal = sm(NORMAL_FS, { u_displacementMap: { value: this.rt.displacement.texture }, u_resolution: { value: N }, u_size: { value: PATCH } });
    this.qScene.add(this.quad); this.quad.frustumCulled = false;

    // the surface: a radial grid, dense near the boat and stretched to the horizon
    const R = 128, g = new T.BufferGeometry(), pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
      const u = (i / R) * 2 - 1, v = (j / R) * 2 - 1, d = Math.max(Math.abs(u), Math.abs(v)), k = d > 0 ? (d ** 2.6 * 700) / d : 0;
      pos.push(u * k, 0, v * k);
    }
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const a = j * (R + 1) + i, b = a + 1, c = a + R + 1, d = c + 1; idx.push(a, c, d, d, b, a); }
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const metresToUnits = UNITS_PER_METRE;
    this.mesh = new T.Mesh(g, new T.ShaderMaterial({
      fog: false,
      uniforms: {
        u_displacementMap: { value: this.rt.displacement.texture }, u_normalMap: { value: this.rt.normal.texture },
        u_patch: { value: PATCH * metresToUnits }, u_scale: { value: metresToUnits },
        sunDir: { value: opts.sunDir }, horizon: { value: opts.horizon }, zenith: { value: opts.zenith }, deep: { value: opts.deep }, sunCol: { value: opts.sunCol },
      },
      vertexShader: /* glsl */`
        uniform sampler2D u_displacementMap; uniform float u_patch, u_scale;
        varying vec3 wp; varying vec2 tc; varying float fade; varying float lift;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.);
          tc = w.xz / u_patch;
          fade = 1. - smoothstep(90., 380., length(w.xz - cameraPosition.xz));
          vec3 d = texture2D(u_displacementMap, tc).rgb;
          lift = d.y * fade;
          w.xyz += d * u_scale * fade;
          wp = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D u_normalMap; uniform vec3 sunDir, horizon, zenith, deep, sunCol;
        varying vec3 wp; varying vec2 tc; varying float fade; varying float lift;
        void main(){
          vec3 n = normalize(mix(vec3(0., 1., 0.), texture2D(u_normalMap, tc).rgb, .35 + .65 * fade));
          vec3 v = normalize(cameraPosition - wp), r = reflect(-v, n);
          float fresnel = .07 + .93 * pow(1. - max(dot(n, v), 0.), 5.);
          vec3 sky = mix(horizon, zenith, clamp(r.y * 2.4, 0., 1.));
          float diffuse = clamp(dot(n, sunDir), 0., 1.);
          vec3 water = deep * (.45 + .9 * diffuse) + vec3(.05, .2, .22) * clamp(lift * .6 + .25, 0., 1.2) * (.3 + diffuse);
          vec3 col = fresnel * sky + (1. - fresnel) * water;
          float s = max(dot(r, sunDir), 0.);
          col += sunCol * (pow(s, 600.) * 18. + pow(s, 60.) * .5) * (.4 + .6 * fade);
          col = mix(col, horizon, smoothstep(160., 600., length(wp.xz - cameraPosition.xz)));
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.frustumCulled = false;
  }
  private seed: T.DataTexture;

  private pass(r: T.WebGLRenderer, mat: T.ShaderMaterial, target: T.WebGLRenderTarget) {
    this.quad.material = mat; r.setRenderTarget(target); r.render(this.qScene, this.qCam);
  }
  /** Advance the simulation (call once per frame before the scene is rendered). */
  update(r: T.WebGLRenderer, now: number) {
    const dt = this.last ? Math.min(.05, (now - this.last) / 1000) : 1 / 60; this.last = now;
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear, prevTone = r.toneMapping, prevXR = r.xr.enabled;
    r.autoClear = false; r.toneMapping = T.NoToneMapping; r.xr.enabled = false;
    if (!this.ready) {
      this.pass(r, this.mats.initial, this.rt.initial);
      // seed the ping phase target from the random data texture
      const copy = new T.ShaderMaterial({ vertexShader: FULLSCREEN_VS, fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }', uniforms: { t: { value: this.seed } } });
      this.pass(r, copy, this.rt.pingPhase); copy.dispose();
      this.ready = true;
    }
    const ph = this.mats.phase;
    ph.uniforms.u_phases.value = (this.pingPhase ? this.rt.pingPhase : this.rt.pongPhase).texture;
    ph.uniforms.u_deltaTime.value = dt;
    this.pass(r, ph, this.pingPhase ? this.rt.pongPhase : this.rt.pingPhase);
    this.pingPhase = !this.pingPhase;
    this.mats.spectrum.uniforms.u_phases.value = (this.pingPhase ? this.rt.pingPhase : this.rt.pongPhase).texture;
    this.pass(r, this.mats.spectrum, this.rt.spectrum);
    // Stockham FFT: log2(N) horizontal then log2(N) vertical sub-transforms
    const iterations = Math.log2(N) * 2;
    let sub = this.mats.hSub;
    for (let i = 0; i < iterations; i++) {
      if (i === iterations / 2) sub = this.mats.vSub;
      const input = i === 0 ? this.rt.spectrum : (i % 2 === 1 ? this.rt.pingT : this.rt.pongT);
      const out = i === iterations - 1 ? this.rt.displacement : (i % 2 === 0 ? this.rt.pingT : this.rt.pongT);
      sub.uniforms.u_input.value = input.texture;
      sub.uniforms.u_subtransformSize.value = 2 ** ((i % (iterations / 2)) + 1);
      this.pass(r, sub, out);
    }
    this.pass(r, this.mats.normal, this.rt.normal);
    r.setRenderTarget(prevRT); r.autoClear = prevAuto; r.toneMapping = prevTone; r.xr.enabled = prevXR;
  }
}
