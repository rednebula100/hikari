// A compact professional colour picker: hue ring around a saturation/value diamond, RGB + alpha sliders
// with ± steppers, a hex field and before/after swatches. No dependencies; drawn on one canvas.
type HSV = { h: number; s: number; v: number }

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')
function rgbToHsv(r: number, g: number, b: number, keepHue = 0): HSV {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = keepHue
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d + 6) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h, s: mx ? d / mx : 0, v: mx }
}
function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const f = (n: number) => { const k = (n + h * 6) % 6; return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) }
  return [f(5), f(3), f(1)]
}

export interface Picker { set(hex: string, alpha: number): void; el: HTMLElement }

/**
 * @param onInput called on every change (drag, slider, stepper, hex) with `#rrggbb` and alpha 0..1
 */
export function colorPicker(host: HTMLElement, hex: string, alpha: number, onInput: (hex: string, alpha: number) => void): Picker {
  const SIZE = 196, DPR = 2, C = SIZE / 2, RO = C - 2, RI = C - 20, R = RI - 8 // ring outer/inner radius, diamond half-diagonal
  host.innerHTML = '<div class="cp">'
    + '<div class="cp-top"><canvas class="cp-wheel" width="' + SIZE * DPR + '" height="' + SIZE * DPR + '" style="width:' + SIZE + 'px;height:' + SIZE + 'px"></canvas>'
    + '<div class="cp-side"><div class="cp-sw" title="왼쪽: 처음 색 (눌러서 되돌리기) · 오른쪽: 지금 색"><button class="old" aria-label="처음 색으로"></button><span class="new"></span></div>'
    + '<label class="cp-hex"><span>#</span><input maxlength="6" spellcheck="false" aria-label="16진 색상"></label></div></div>'
    + ['R', 'G', 'B', 'A'].map(c => '<div class="cp-row" data-c="' + c + '"><span class="cp-l">' + (c === 'A' ? '불투명' : c) + '</span>'
      + '<button class="cp-step" data-d="-1" aria-label="' + c + ' 줄이기">−</button><input type="range" min="0" max="' + (c === 'A' ? 100 : 255) + '" step="1">'
      + '<button class="cp-step" data-d="1" aria-label="' + c + ' 늘리기">+</button><input class="cp-n" type="number" min="0" max="' + (c === 'A' ? 100 : 255) + '"></div>').join('')
    + '</div>'
  const root = host.firstElementChild as HTMLElement, cv = root.querySelector('canvas')!, g = cv.getContext('2d')!
  const old = root.querySelector<HTMLButtonElement>('.old')!, now = root.querySelector<HTMLElement>('.new')!, hexIn = root.querySelector<HTMLInputElement>('.cp-hex input')!
  const rows = Object.fromEntries(['R', 'G', 'B', 'A'].map(c => [c, root.querySelector<HTMLElement>('[data-c="' + c + '"]')!])) as Record<'R' | 'G' | 'B' | 'A', HTMLElement>
  let rgb = hexToRgb(hex), a = alpha, hsv = rgbToHsv(...rgb), first = { hex, alpha }
  const diamond = document.createElement('canvas'); diamond.width = diamond.height = Math.ceil(2 * R * DPR)
  let diamondHue = -1

  function paintDiamond() {
    if (Math.abs(diamondHue - hsv.h) < 1e-4) return
    diamondHue = hsv.h
    const n = diamond.width, dg = diamond.getContext('2d')!, img = dg.createImageData(n, n), half = n / 2
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x + .5 - half) / half, dy = (y + .5 - half) / half
      if (Math.abs(dx) + Math.abs(dy) > 1.002) continue
      // corners: top = white, right = pure hue, bottom and left = black
      const s = Math.min(1, Math.max(0, (dx + dy) / 2 + .5)), v = Math.min(1, Math.max(0, (dx - dy) / 2 + .5))
      const [r, gg, b] = hsvToRgb({ h: hsv.h, s, v }), i = (y * n + x) * 4
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255
    }
    dg.putImageData(img, 0, 0)
  }
  function draw() {
    paintDiamond()
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, SIZE, SIZE)
    const ring = g.createConicGradient(-Math.PI / 2, C, C)
    for (let i = 0; i <= 12; i++) { const [r, gg, b] = hsvToRgb({ h: (i / 12) % 1, s: 1, v: 1 }); ring.addColorStop(i / 12, rgbToHex(r, gg, b)) }
    g.beginPath(); g.arc(C, C, RO, 0, Math.PI * 2); g.arc(C, C, RI, 0, Math.PI * 2, true); g.fillStyle = ring; g.fill('evenodd')
    g.drawImage(diamond, C - R, C - R, 2 * R, 2 * R)
    // markers
    const ang = -Math.PI / 2 + hsv.h * Math.PI * 2, mr = (RO + RI) / 2
    ring_marker(C + Math.cos(ang) * mr, C + Math.sin(ang) * mr, (RO - RI) / 2 + 1)
    const px = C + R * ((hsv.s - .5) + (hsv.v - .5)), py = C + R * ((hsv.s - .5) - (hsv.v - .5))
    ring_marker(px, py, 6)
  }
  function ring_marker(x: number, y: number, r: number) {
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke()
    g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke()
  }
  const cssRgb = (r: number, gg: number, b: number) => 'rgb(' + Math.round(r) + ',' + Math.round(gg) + ',' + Math.round(b) + ')'
  const checker = 'repeating-conic-gradient(#8a8a8a 0 25%, #d0d0d0 0 50%) 0 0 / 10px 10px'
  function syncControls() {
    const [r, gg, b] = rgb, vals = { R: r, G: gg, B: b, A: Math.round(a * 100) }
    for (const k of ['R', 'G', 'B', 'A'] as const) {
      const row = rows[k], range = row.querySelector<HTMLInputElement>('input[type=range]')!, num = row.querySelector<HTMLInputElement>('.cp-n')!
      range.value = String(Math.round(vals[k])); if (document.activeElement !== num) num.value = String(Math.round(vals[k]))
      const lo = k === 'R' ? cssRgb(0, gg, b) : k === 'G' ? cssRgb(r, 0, b) : k === 'B' ? cssRgb(r, gg, 0) : 'rgba(' + [r, gg, b].map(Math.round).join(',') + ',0)'
      const hi = k === 'R' ? cssRgb(255, gg, b) : k === 'G' ? cssRgb(r, 255, b) : k === 'B' ? cssRgb(r, gg, 255) : cssRgb(r, gg, b)
      range.style.background = 'linear-gradient(90deg,' + lo + ',' + hi + ')' + (k === 'A' ? ',' + checker : '')
    }
    const h = rgbToHex(...rgb)
    if (document.activeElement !== hexIn) hexIn.value = h.slice(1)
    now.style.background = 'linear-gradient(rgba(' + rgb.map(Math.round).join(',') + ',' + a + '),rgba(' + rgb.map(Math.round).join(',') + ',' + a + ')),' + checker
    old.style.background = 'linear-gradient(' + hexA(first.hex, first.alpha) + ',' + hexA(first.hex, first.alpha) + '),' + checker
  }
  const hexA = (h: string, al: number) => { const [r, gg, b] = hexToRgb(h); return 'rgba(' + r + ',' + gg + ',' + b + ',' + al + ')' }
  function emit() { draw(); syncControls(); onInput(rgbToHex(...rgb), a) }
  function fromHsv() { rgb = hsvToRgb(hsv); emit() }
  function fromRgb() { hsv = rgbToHsv(...rgb, hsv.h); emit() }

  // ── wheel dragging: the ring sets hue, the diamond sets saturation and value ──
  let mode: 'h' | 'sv' | null = null
  const local = (e: PointerEvent) => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * SIZE / b.width - C, (e.clientY - b.top) * SIZE / b.height - C] }
  function drag(e: PointerEvent) {
    const [dx, dy] = local(e)
    if (mode === 'h') { hsv.h = (((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2)) % 1 + 1) % 1; fromHsv() }
    else if (mode === 'sv') {
      hsv.s = Math.min(1, Math.max(0, (dx + dy) / (2 * R) + .5)); hsv.v = Math.min(1, Math.max(0, (dx - dy) / (2 * R) + .5)); fromHsv()
    }
  }
  cv.addEventListener('pointerdown', e => {
    const [dx, dy] = local(e), r = Math.hypot(dx, dy)
    mode = r >= RI - 3 && r <= RO + 3 ? 'h' : Math.abs(dx) + Math.abs(dy) <= R + 6 ? 'sv' : null
    if (!mode) return
    cv.setPointerCapture(e.pointerId); drag(e); e.preventDefault()
  })
  cv.addEventListener('pointermove', e => { if (mode) drag(e) })
  const stop = () => { mode = null }
  cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop)

  // ── sliders, steppers, numbers, hex ──
  const setChannel = (k: 'R' | 'G' | 'B' | 'A', v: number) => {
    if (k === 'A') { a = Math.min(100, Math.max(0, v)) / 100; emit(); return }
    rgb = [...rgb] as typeof rgb; rgb['RGB'.indexOf(k)] = Math.min(255, Math.max(0, v)); fromRgb()
  }
  for (const k of ['R', 'G', 'B', 'A'] as const) {
    const row = rows[k]
    row.querySelector<HTMLInputElement>('input[type=range]')!.addEventListener('input', e => setChannel(k, +(e.target as HTMLInputElement).value))
    row.querySelector<HTMLInputElement>('.cp-n')!.addEventListener('change', e => setChannel(k, +(e.target as HTMLInputElement).value || 0))
    row.querySelectorAll<HTMLButtonElement>('.cp-step').forEach(b => {
      // press and hold repeats, like a hardware stepper
      let timer = 0
      const step = () => { const cur = k === 'A' ? Math.round(a * 100) : Math.round(rgb['RGB'.indexOf(k)]); setChannel(k, cur + +b.dataset.d!) }
      b.addEventListener('pointerdown', () => { step(); timer = window.setTimeout(function rep() { step(); timer = window.setTimeout(rep, 45) }, 380) })
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer))
    })
  }
  hexIn.addEventListener('input', () => { const v = hexIn.value.replace(/[^0-9a-f]/gi, ''); if (v.length === 6 || v.length === 3) { rgb = hexToRgb(v.length === 3 ? v.split('').map(c => c + c).join('') : v); fromRgb() } })
  old.addEventListener('click', () => { rgb = hexToRgb(first.hex); a = first.alpha; fromRgb() })

  draw(); syncControls()
  return {
    el: root,
    set(h, al) { first = { hex: h, alpha: al }; rgb = hexToRgb(h); a = al; hsv = rgbToHsv(...rgb, hsv.h); draw(); syncControls() },
  }
}
