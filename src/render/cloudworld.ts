// 달빛 구름 위 — volumetric clouds and a physical sky from takram-design-engineering/three-geospatial
// (@takram/three-clouds + @takram/three-atmosphere, MIT). Loaded on demand when the world is entered.
// Day-for-night: the light source sits low over the cloud sea (drawn as a large pale disc — our "moon");
// the frame is kept at exposure 1 so takram's physical radiance reads as a dim night, then graded cool.
import * as T from 'three';
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, Effect } from 'postprocessing';
import { AerialPerspectiveEffect, PrecomputedTexturesGenerator, StarsGeometry, StarsMaterial } from '@takram/three-atmosphere';
import { CloudsEffect } from '@takram/three-clouds';
import { DataTextureLoader, Ellipsoid, Geodetic, parseUint8Array, radians, STBNLoader } from '@takram/three-geospatial';

class NightGrade extends Effect {
  constructor() {
    super('NightGrade', /* glsl */`
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb * exposure;
        float l = dot(c, vec3(.2126, .7152, .0722));
        c = mix(vec3(l), c, .45) * vec3(.58, .72, 1.1);
        outputColor = vec4(c, inputColor.a);
      }`, { uniforms: new Map([['exposure', new T.Uniform(.75)]]) });
  }
}

export interface CloudPipeline { render(): void; setSize(w: number, h: number): void; enter(r: T.WebGLRenderer): void; leave(r: T.WebGLRenderer): void; setQuality(q: string): void; ready: boolean }

/**
 * @param lightDir direction to the moon in our world frame (y up, +z toward Black's side)
 * @param altitude metres above sea level of our world origin (the clouds float far below it)
 */
export async function createCloudPipeline(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.PerspectiveCamera, lightDir: T.Vector3, altitude = 2600, progress: (f: number) => void = () => {}, quality = 'auto'): Promise<CloudPipeline> {
  const base = import.meta.env.BASE_URL + 'takram/';
  // our frame → East-North-Up at 37.5°N 127°E (three +x = east, +y = up, −z = north), 1 unit = 1 m
  const origin = new Geodetic(radians(127), radians(37.5), altitude).toECEF();
  const enu = Ellipsoid.WGS84.getEastNorthUpFrame(origin);
  const axes = new T.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  const worldToECEF = new T.Matrix4().multiplyMatrices(enu, axes);
  const sunECEF = lightDir.clone().normalize().transformDirection(worldToECEF);

  const clouds = new CloudsEffect(camera);
  clouds.worldToECEFMatrix.copy(worldToECEF);
  clouds.coverage = .42;
  // free optimizations (invisible at night): no crepuscular rays, no haze (aerial perspective already fogs), lighter shadows
  clouds.lightShafts = false; clouds.haze = false;
  const shadowCfg = (clouds as unknown as { shadow?: { cascadeCount: number; mapSize: T.Vector2 } }).shadow;
  if (shadowCfg) { shadowCfg.cascadeCount = 2; shadowCfg.mapSize?.set?.(256, 256); }
  const applyQuality = (q: string) => {
    clouds.qualityPreset = q === 'ultra' ? 'high' : q === 'mid' || q === 'low' ? 'low' : 'medium';
    clouds.resolutionScale = q === 'low' ? .5 : q === 'mid' ? .75 : 1;
  };
  applyQuality(quality);
  clouds.localWeatherVelocity.set(.0006, .0002);
  clouds.sunDirection.copy(sunECEF);

  const aerial = new AerialPerspectiveEffect(camera, { sky: true, sun: true, moon: false });
  aerial.worldToECEFMatrix.copy(worldToECEF);
  aerial.sunDirection.copy(sunECEF);
  aerial.sunAngularRadius = .022; // the disc we read as the moon
  clouds.events.addEventListener('change', e => {
    if (e.property === 'atmosphereOverlay') aerial.overlay = clouds.atmosphereOverlay;
    if (e.property === 'atmosphereShadow') aerial.shadow = clouds.atmosphereShadow;
    if (e.property === 'atmosphereShadowLength') aerial.shadowLength = clouds.atmosphereShadowLength;
  });

  const generator = new PrecomputedTexturesGenerator(renderer);
  const gen = generator.update();
  Object.assign(aerial, generator.textures); Object.assign(clouds, generator.textures);

  // textures self-hosted from the packages / repository (MIT)
  const linear = (t: T.Texture) => { t.minFilter = T.LinearMipMapLinearFilter; t.magFilter = T.LinearFilter; t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.NoColorSpace; t.needsUpdate = true; return t; };
  const volume = (t: T.Data3DTexture) => { t.format = T.RedFormat; t.minFilter = t.magFilter = T.LinearFilter; t.wrapS = t.wrapT = t.wrapR = T.RepeatWrapping; t.colorSpace = T.NoColorSpace; t.needsUpdate = true; return t; };
  const tex = new T.TextureLoader();
  let done = 0; const tick = <V,>(x: Promise<V>) => x.then(v => { progress(.1 + .7 * (++done / 6)); return v; });
  const [weather, turbulence, shape, detail, stbn, starsBuf] = await Promise.all([
    tick(tex.loadAsync(base + 'local_weather.png')), tick(tex.loadAsync(base + 'turbulence.png')),
    tick(new DataTextureLoader(T.Data3DTexture, parseUint8Array, { width: 128, height: 128, depth: 128 }).loadAsync(base + 'shape.bin')),
    tick(new DataTextureLoader(T.Data3DTexture, parseUint8Array, { width: 32, height: 32, depth: 32 }).loadAsync(base + 'shape_detail.bin')),
    tick(new STBNLoader().loadAsync(base + 'stbn.bin')),
    tick(fetch(base + 'stars.bin').then(r => r.arrayBuffer())),
  ]);
  clouds.localWeatherTexture = linear(weather); clouds.turbulenceTexture = linear(turbulence);
  clouds.shapeTexture = volume(shape as T.Data3DTexture); clouds.shapeDetailTexture = volume(detail as T.Data3DTexture);
  clouds.stbnTexture = stbn; aerial.stbnTexture = stbn;

  const starsMat = new StarsMaterial({ intensity: 900, pointSize: 1.6 });
  Object.assign(starsMat, generator.textures);
  starsMat.sunDirection.copy(sunECEF);
  (starsMat as unknown as { worldToECEFMatrix?: T.Matrix4 }).worldToECEFMatrix?.copy(worldToECEF);
  const stars = new T.Points(new StarsGeometry(starsBuf), starsMat); stars.frustumCulled = false;
  await gen.catch(() => undefined);
  progress(.9);

  const composer = new EffectComposer(renderer, { frameBufferType: T.HalfFloatType, multisampling: 4 });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, clouds, aerial));
  composer.addPass(new EffectPass(camera, new NightGrade(), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));

  let saved = { tone: renderer.toneMapping as T.ToneMapping, exp: renderer.toneMappingExposure };
  return {
    ready: true,
    render() { composer.render(); },
    setSize(w, h) { composer.setSize(w, h); },
    enter(r) { saved = { tone: r.toneMapping, exp: r.toneMappingExposure }; r.toneMapping = T.NoToneMapping; r.toneMappingExposure = 1; scene.add(stars); },
    leave(r) { r.toneMapping = saved.tone; r.toneMappingExposure = saved.exp; scene.remove(stars); },
    setQuality: applyQuality,
  };
}
