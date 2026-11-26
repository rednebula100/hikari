import * as T from 'three';
import { C, type Pulse } from '../game/physics';

export const MAX_PULSES = 16;
const TAU = Math.PI * 2;

// GPU visual path of physics.waveAt — same envelope, carrier and attenuation.
// Game judgement never reads this (CPU path is authoritative).
export class WaveField extends T.Group {
  readonly shader: T.ShaderMaterial;
  constructor() {
    super();
    const common = `
      uniform vec2 source[${MAX_PULSES}]; uniform vec4 pulse[${MAX_PULSES}]; uniform int count; uniform float t;
      float field(vec2 p){ float sum=0.;
        for(int i=0;i<${MAX_PULSES};i++){ if(i>=count) break;
          float d=length(p-source[i]); float q=t-pulse[i].x-d/${C.toFixed(1)};
          if(q>=0. && q<pulse[i].y) sum+=pulse[i].z/(1.+d*.5)*cos(${TAU}*q+pulse[i].w);
        } return sum; }`;
    const sources = Array.from({ length: MAX_PULSES }, () => new T.Vector2());
    const pulses = Array.from({ length: MAX_PULSES }, () => new T.Vector4());
    this.shader = new T.ShaderMaterial({
      transparent: true, side: T.DoubleSide, depthWrite: false,
      uniforms: { source: { value: sources }, pulse: { value: pulses }, count: { value: 0 }, t: { value: 0 } },
      vertexShader: common + `varying vec2 location; void main(){
        location=position.xz; float h=field(location);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position.x,.42+h*1.35,position.z,1.);
      }`,
      fragmentShader: common + `varying vec2 location; void main(){
        float h=field(location); float v=abs(h);
        vec2 cell=abs(fract(location*4.+.5)-.5)/max(fwidth(location*4.),vec2(.001));
        float grid=1.-smoothstep(.4,1.2,min(cell.x,cell.y));
        if(v<.004){ if(grid<.5) discard; gl_FragColor=vec4(.55,.6,.7,.05*grid); return; }
        vec3 pos=vec3(.98,.80,.46), neg=vec3(.47,.42,.95);
        vec3 col=mix(neg,pos,step(0.,h));
        float ridge=1.-smoothstep(.02,.1,abs(fract(v*10.+.5)-.5));
        gl_FragColor=vec4(col*(.55+.45*ridge+.25*grid), clamp(.18+v*1.6,0.,.92));
        #include <colorspace_fragment>
      }`,
    });
    const g = new T.PlaneGeometry(8, 8, 220, 220); g.rotateX(-Math.PI / 2); g.translate(4, 0, 4);
    const surface = new T.Mesh(g, this.shader); surface.renderOrder = 5; surface.frustumCulled = false;
    this.add(surface);
  }
  set(t: number, list: readonly Pulse[]) {
    const u = this.shader.uniforms;
    const n = Math.min(MAX_PULSES, list.length);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      u.source.value[i].set(p.position.x, p.position.z);
      u.pulse.value[i].set(p.emit, p.duration, p.amplitude, p.phase);
    }
    u.count.value = n; u.t.value = t;
  }
}
