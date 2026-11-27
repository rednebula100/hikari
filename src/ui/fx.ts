// Screen-space motion (GSAP): short, firm, no springs — except the seal, which slams.
import { gsap } from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'

gsap.registerPlugin(ScrambleTextPlugin)
export { gsap }

const $ = (id: string) => document.getElementById(id)!
let toastT: gsap.core.Tween | null = null
export function toast(msg: string, ms = 2400) {
  const t = $('toast'); t.textContent = msg; t.hidden = false
  toastT?.kill(); gsap.killTweensOf(t)
  gsap.fromTo(t, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: .16, ease: 'expo.out' })
  toastT = gsap.to(t, { opacity: 0, duration: .2, delay: ms / 1000, onComplete: () => { t.hidden = true } })
}

/** Rows and blocks enter one after another (30 ms steps). */
export function reveal(root: ParentNode, sel = '.row, .reveal') {
  const els = root.querySelectorAll(sel)
  if (!els.length) return
  gsap.fromTo(els, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: .22, ease: 'expo.out', stagger: .03, clearProps: 'transform' })
}
/** A panel opens like a sheet pulled down from its header. */
export function openPanel(el: Element) {
  gsap.fromTo(el, { clipPath: 'inset(0 0 100% 0)', opacity: .4 }, { clipPath: 'inset(0 0 0% 0)', opacity: 1, duration: .26, ease: 'expo.out', clearProps: 'clipPath' })
}

/** The vermilion seal slams onto the screen. */
export function stamp(ch: string, caption: string, sound?: () => void): Promise<void> {
  return new Promise(res => {
    const el = document.createElement('div'); el.className = 'stampbig'
    el.innerHTML = `<span class="seal">${ch}</span>${caption ? `<span class="cap">${caption}</span>` : ''}`
    document.body.append(el)
    const seal = el.querySelector('.seal')!, cap = el.querySelector('.cap')
    let ended = false
    const end = () => { if (ended) return; ended = true; el.remove(); res() }
    setTimeout(end, caption ? 4500 : 3000) // wall-clock fallback for starved frames
    const tl = gsap.timeline({ onComplete: end })
    tl.fromTo(seal, { scale: 2.6, opacity: 0, rotate: -14 }, { scale: 1, opacity: 1, rotate: -4, duration: .18, ease: 'power4.in', onComplete: () => sound?.() })
      .to(el, { x: '+=3', yoyo: true, repeat: 3, duration: .03 }, '>')
    if (cap) tl.fromTo(cap, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .25, ease: 'expo.out' }, '<')
    tl.to(el, { opacity: 0, duration: .35, delay: caption ? 1.6 : .7 })
  })
}

/** A codex discovery slides in from the right edge. */
const queue: (() => Promise<void>)[] = []; let running = false
export function discovery(no: number, name: string, sound?: () => void) {
  queue.push(() => new Promise(res => {
    const el = document.createElement('div'); el.id = 'find'
    el.innerHTML = `<span class="seal">發</span><div class="tx"><span class="lbl">도감 등록 · No. ${String(no).padStart(3, '0')}</span><b>${name}</b></div>`
    document.body.append(el); sound?.()
    gsap.timeline({ onComplete: () => { el.remove(); res() } })
      .fromTo(el, { x: 40, opacity: 0, clipPath: 'inset(0 0 0 100%)' }, { x: 0, opacity: 1, clipPath: 'inset(0 0 0 0%)', duration: .3, ease: 'expo.out' })
      .to(el, { x: 30, opacity: 0, duration: .25, delay: 2.2, ease: 'power2.in' })
  }))
  if (!running) void drain()
}
async function drain() { running = true; while (queue.length) await queue.shift()!(); running = false }

/** Numbers settle out of noise. */
export function scramble(el: Element, text: string, dur = .9) {
  gsap.to(el, { duration: dur, scrambleText: { text, chars: '0123456789', revealDelay: dur * .4, speed: .6 }, ease: 'none' })
}

/**
 * The optical-bench rider: a brass block on the ivory ruler beside every list glides to the item under the
 * pointer (or keyboard focus) and returns to the current choice when the pointer leaves. Segmented choices get
 * a rider on their horizontal ruler; it remembers where it was so a re-render still slides instead of jumping.
 */
const segMemo = new Map<string, { x: number; w: number }>()
export function riders(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.idx, .tiers').forEach(list => {
    if (list.querySelector(':scope > .rider')) return
    const items = [...list.querySelectorAll<HTMLElement>(':scope > .row, :scope > .tier')]
    if (!items.length) return
    const r = document.createElement('div'); r.className = 'rider'; r.innerHTML = '<i></i>'; list.prepend(r)
    const place = (el: HTMLElement, anim: boolean) => {
      const y = el.offsetTop + el.offsetHeight / 2 - r.offsetHeight / 2
      if (anim) gsap.to(r, { y, duration: .34, ease: 'power3.out', overwrite: true }); else gsap.set(r, { y })
    }
    const home = () => list.querySelector<HTMLElement>(':scope > .sel') ?? list.querySelector<HTMLElement>(':scope > .main') ?? items[0]
    place(home(), false)
    items.forEach(it => { it.addEventListener('pointerenter', () => place(it, true)); it.addEventListener('focus', () => place(it, true)) })
    list.addEventListener('pointerleave', () => place(home(), true))
  })
  root.querySelectorAll<HTMLElement>('.seg').forEach(seg => {
    const btns = [...seg.querySelectorAll<HTMLButtonElement>(':scope > button')]
    if (!btns.length || seg.querySelector(':scope > .srider')) return
    const r = document.createElement('i'); r.className = 'srider'; seg.append(r)
    const key = btns.map(b => b.textContent).join('|')
    const to = (b: HTMLElement, anim: boolean) => {
      const v = { x: b.offsetLeft + 6, width: b.offsetWidth - 12 }
      if (anim) gsap.to(r, { ...v, duration: .32, ease: 'power3.out', overwrite: true }); else gsap.set(r, v)
    }
    const on = () => seg.querySelector<HTMLElement>(':scope > button.on') ?? btns[0]
    const was = segMemo.get(key)
    if (was) { gsap.set(r, { x: was.x, width: was.w }); to(on(), true) } else to(on(), false)
    segMemo.set(key, { x: on().offsetLeft + 4, w: on().offsetWidth - 8 })
    btns.forEach(b => b.addEventListener('pointerenter', () => to(b, true)))
    seg.addEventListener('pointerleave', () => to(on(), true))
  })
}
