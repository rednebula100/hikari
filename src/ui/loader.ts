// Loading: six piece silhouettes are pushed onto a brass rail one by one and rock to a stop.
// When the lab is ready, a ripple runs left to right through the row — momentum handed on, like the cradle.
import { gsap } from './fx'
import { LATHE, KNIGHT } from '../render/profiles'

function path(k: string) {
  if (k === 'n') return KNIGHT
  const pts = LATHE[k], right = pts.map(([x, y]) => `${x} ${90 - y}`), left = [...pts].reverse().map(([x, y]) => `${-x} ${90 - y}`)
  return 'M' + right.join('L') + 'L' + left.join('L') + 'Z'
}

export class Loader {
  readonly el = document.createElement('div')
  private shown = 0
  private bar: HTMLElement; private pct: HTMLElement; private pcs: HTMLElement[]
  constructor() {
    this.el.className = 'loader'
    const order = ['p', 'n', 'b', 'r', 'q', 'k']
    this.el.innerHTML = '<svg width="0" height="0" style="position:absolute"><defs>'
      + '<linearGradient id="ivo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3d8"/><stop offset=".45" stop-color="#d9c49c"/><stop offset="1" stop-color="#6e5a3e"/></linearGradient>'
      + '<radialGradient id="shd"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs></svg>'
      + '<div class="shelf">' + order.map(k => `<div class="pc"><svg viewBox="-24 0 48 94"><ellipse cx="0" cy="90.5" rx="21" ry="3.2" fill="url(#shd)"/><path d="${path(k)}" fill="url(#ivo)" stroke="rgba(255,236,200,.35)" stroke-width=".6"/></svg></div>`).join('') + '</div>'
      + '<div class="bar"><i></i></div><div class="cap2">실험실 준비 중<b>0%</b></div>'
    this.bar = this.el.querySelector('.bar i')!; this.pct = this.el.querySelector('.cap2 b')!
    this.pcs = [...this.el.querySelectorAll<HTMLElement>('.pc')]
  }
  /** Progress 0..1: the rail fills and one more piece is pushed in per sixth. */
  set(f: number) {
    this.bar.style.width = (f * 100).toFixed(1) + '%'; this.pct.textContent = Math.round(f * 100) + '%'
    while (this.shown < Math.min(6, Math.floor(f * 6.0001))) this.push(this.shown++)
  }
  private push(i: number) {
    const pc = this.pcs[i]
    gsap.timeline()
      .fromTo(pc, { x: -70, opacity: 0, rotation: 0 }, { x: 0, opacity: 1, duration: .45, ease: 'power3.out' })
      .fromTo(pc, { rotation: 9 }, { rotation: 0, duration: 1.1, ease: 'elastic.out(1,.32)', transformOrigin: '50% 100%' }, '-=.12')
  }
  /** Every piece in place, then the ripple. */
  async finish() {
    this.set(1)
    await new Promise(r => setTimeout(r, 420))
    await new Promise<void>(res => {
      const tl = gsap.timeline({ onComplete: () => res() })
      this.pcs.forEach((pc, i) => tl.to(pc, { y: -9, rotation: 6, duration: .12, ease: 'power2.out', transformOrigin: '50% 100%' }, i * .07)
        .to(pc, { y: 0, rotation: 0, duration: .5, ease: 'elastic.out(1,.4)' }, i * .07 + .12))
      setTimeout(res, 1600)
    })
  }
}
