// Loading: six piece silhouettes are pushed onto a brass rail one by one and rock to a stop.
// When the lab is ready, a ripple runs left to right through the row — momentum handed on, like the cradle.
import { gsap } from './fx'

type P = [number, number]
/** Half-profiles of lathe-turned Staunton pieces (x = radius, y = height), mirrored into a silhouette. */
const LATHE: Record<string, P[]> = {
  p: [[17, 0], [17, 3], [15, 5], [15, 8], [11, 11], [8, 14], [6, 26], [11, 28], [11, 30], [6, 32], [5, 36], [8, 39], [9.5, 44], [8.5, 50], [5.5, 54], [0, 55.5]],
  r: [[18, 0], [18, 3], [16, 5], [16, 8], [12, 11], [10, 15], [10, 40], [13, 43], [14, 45], [14, 58], [10, 58], [10, 54], [5, 54], [5, 58], [0, 58]],
  b: [[17, 0], [17, 3], [15, 5], [15, 8], [11, 11], [8, 15], [6, 32], [11, 34], [11, 36], [6, 38], [8, 44], [10, 50], [9, 57], [6, 62], [2.5, 65], [3.5, 67], [3.5, 70], [0, 71.5]],
  q: [[18, 0], [18, 3], [16, 5], [16, 8], [12, 11], [9, 15], [6, 38], [12, 41], [12, 43], [7, 45], [8, 50], [13, 61], [10, 62], [11, 66], [7, 63], [6, 67], [3, 64], [3, 69], [4, 72], [3, 75], [0, 76]],
  k: [[18, 0], [18, 3], [16, 5], [16, 8], [12, 11], [10, 15], [7, 40], [13, 43], [13, 45], [8, 47], [9, 52], [12, 63], [10, 65], [10, 67], [3, 68], [2.2, 72], [6, 72], [6, 75.5], [2.2, 75.5], [2.2, 81], [0, 81]],
}
const KNIGHT = 'M-17 90L17 90L17 87L15 85L15 82L11 79L9 75L12 66L15 56L14 46L11 38L6 30L1 23L1 19L-3 22L-8 23L-14 30L-18 35L-15 40L-9 37L-5 39L-9 48L-13 58L-11 75L-11 79L-15 82L-15 85L-17 87Z'
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
