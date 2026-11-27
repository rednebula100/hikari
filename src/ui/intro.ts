// Red Nebula studio card: a hairline, the script revealed along it, tracking-in caption. Click/key skips.
import { gsap } from './fx'

export function intro(): Promise<void> {
  return new Promise(res => {
    const el = document.createElement('div'); el.id = 'intro'
    el.innerHTML = `<div class="wrap"><div class="glow"></div><img alt="Red Nebula" src="${import.meta.env.BASE_URL}brand/rednebula-mark.webp"><div class="rule"></div><div class="by">PRESENTS</div></div>`
    document.body.append(el)
    const img = el.querySelector('img')!, rule = el.querySelector('.rule')!, by = el.querySelector('.by')!, glow = el.querySelector('.glow')!, wrap = el.querySelector('.wrap')!
    let done = false
    const finish = () => {
      if (done) return; done = true
      window.removeEventListener('keydown', finish); el.removeEventListener('pointerdown', finish)
      tl.kill()
      gsap.to(el, { opacity: 0, duration: .35, ease: 'power2.out', onComplete: () => { el.remove(); res() } })
    }
    window.addEventListener('keydown', finish); el.addEventListener('pointerdown', finish)
    const m = { v: -14 }
    const tl = gsap.timeline({ delay: .35, onComplete: finish })
    tl.set(img, { '--m': '-14%', filter: 'brightness(1.35) saturate(1.05) blur(6px)', scale: 1.03 })
      .to(rule, { scaleX: 1, duration: .55, ease: 'expo.inOut' })
      .to(m, { v: 100, duration: 1.15, ease: 'power2.inOut', onUpdate: () => img.style.setProperty('--m', m.v + '%') }, '-=.1')
      .to(img, { filter: 'brightness(1.35) saturate(1.05) blur(0px)', scale: 1, duration: 1.2, ease: 'power3.out' }, '<')
      .to(glow, { opacity: 1, duration: .9, yoyo: true, repeat: 1, ease: 'sine.inOut' }, '<.3')
      .fromTo(by, { opacity: 0, letterSpacing: '1.4em' }, { opacity: 1, letterSpacing: '.62em', duration: 1.1, ease: 'expo.out' }, '<.5')
      .to(rule, { scaleX: .18, opacity: .5, duration: .8, ease: 'expo.inOut' }, '<')
      .to(wrap, { y: -6, opacity: 0, filter: 'blur(4px)', duration: .55, ease: 'power2.in' }, '+=.85')
  })
}
