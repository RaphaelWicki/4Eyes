// 4 Eyes – Bewegung
// Nachempfunden der Bewegungssprache von analogueagency.com (Framer + Lenis):
//   - Hauptkurve cubic-bezier(.44, 0, 0, 1): schneller Start, sehr langes, weiches Auslaufen
//   - Einflüge leicht in 3D gekippt (rotateX) und federnd (Spring) für runde Elemente
//   - Seitenwechsel über einen Vorhang in Blau, der von unten hochfährt und nach oben abzieht
//   - weiches, nachlaufendes Scrollen (lerp) wie mit Lenis
// Farben und Formen bleiben bei unseren Gestaltungsregeln.

export const EASE = 'cubic-bezier(.44, 0, 0, 1)';
export const EASE_IN = 'cubic-bezier(.56, 0, .9, .4)';
export const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (s, el = document) => el.querySelector(s);
export const wait = ms => new Promise(r => setTimeout(r, ms));
const finished = a => a.finished.catch(() => {});

/* ---------- Einflug ---------- */
export function enter(els, { y = 40, rotateX = 0, scale = 1, stagger = 70, delay = 0, duration = 900 } = {}) {
  if (reduce) return;
  els.filter(Boolean).forEach((el, i) => {
    el.animate([
      { opacity: 0, transform: `perspective(1400px) translateY(${y}px) rotateX(${rotateX}deg) scale(${scale})` },
      { opacity: 1, transform: 'perspective(1400px) translateY(0) rotateX(0) scale(1)' },
    ], { duration, delay: delay + i * stagger, easing: EASE, fill: 'backwards' });
  });
}

// Runde Elemente fallen federnd ein (wie die Kreise auf analogueagency.com: scale .3, y -80)
export function springIn(el, delay = 0) {
  if (reduce || !el) return;
  el.animate([
    { opacity: 0, transform: 'translateY(-80px) scale(.3)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ], { duration: 1000, delay, easing: SPRING, fill: 'backwards' });
}

export function enterUpload(delay = 0) {
  enter([$('#dropOrig'), $('#dropRev')], { y: 60, rotateX: -10, scale: .97, stagger: 110, delay, duration: 1100 });
  springIn($('.drops-plus'), delay + 260);
  enter([$('.upload-foot')], { y: 40, delay: delay + 320 });
}

export function enterReview(delay = 0) {
  enter([$('#reviewActions')], { y: -20, delay });
  enter([$('#summary'), $('#filters')], { y: 40, stagger: 70, delay });
  enter([$('#paneOrig'), $('#paneRev')], { y: 60, rotateX: -10, scale: .97, stagger: 110, delay: delay + 80, duration: 1100 });
  enter([$('.review-foot')], { y: 40, delay: delay + 300 });
}

/* ---------- Vorhang für Seitenwechsel ---------- */
const curtain = () => $('#curtain');

export function curtainText(text) {
  const t = $('.curtain-text', curtain());
  t.textContent = text || '';
}
export function curtainProgress(p) {
  const el = $('.curtain-pct', curtain());
  el.textContent = p == null ? '' : `${Math.round(p * 100)}\u00a0%`;
}

export async function curtainIn(text) {
  const c = curtain();
  curtainText(text);
  curtainProgress(null);
  c.hidden = false;
  if (reduce) return;
  const label = $('.curtain-label', c);
  label.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }],
    { duration: 800, delay: 180, easing: EASE, fill: 'backwards' });
  await finished(c.animate([{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
    { duration: 650, easing: EASE }));
}

export async function curtainOut() {
  const c = curtain();
  if (!reduce) {
    const label = $('.curtain-label', c);
    label.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-60%)', opacity: 0 }],
      { duration: 500, easing: EASE_IN, fill: 'forwards' });
    await finished(c.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 100% 0)' }],
      { duration: 850, delay: 120, easing: EASE, fill: 'forwards' }));
    c.getAnimations({ subtree: true }).forEach(a => a.cancel());
  }
  c.hidden = true;
}

// Vorhang zu → umschalten → neue Seite fliegt ein, während der Vorhang abzieht
export async function pageTransition(text, swap, after) {
  await curtainIn(text);
  try { await swap(); } finally {
    after?.(150);
    await curtainOut();
  }
}

/* ---------- Upload: das Feld füllt sich wie ein Fortschrittsbalken ---------- */
export function fieldLoader(drop) {
  const body = $('.drop-body', drop);
  body.querySelector('.drop-fill')?.remove();
  const fill = document.createElement('span');
  fill.className = 'drop-fill';
  fill.innerHTML = '<span class="drop-fill-label"><span>PDF wird gelesen</span><b>0 %</b></span>';
  body.append(fill);
  const pct = $('b', fill);
  const set = p => { fill.style.clipPath = `inset(${((1 - p) * 100).toFixed(1)}% 0 0 0)`; };
  set(0);
  fill.getBoundingClientRect();           // Startzustand festhalten, damit der Übergang greift
  set(0.08);
  return {
    progress(p) { set(0.08 + p * 0.82); pct.textContent = `${Math.round(p * 100)}\u00a0%`; },
    async finish(swap) {
      pct.textContent = '100\u00a0%';
      set(1);
      await wait(reduce ? 0 : 420);
      swap();                             // darunter liegt jetzt der neue Inhalt
      const content = [...body.querySelectorAll('.drop-name, .drop-file small, .drop-cta')];
      enter(content, { y: 34, stagger: 60, delay: 120, duration: 1000 });
      if (reduce) { fill.remove(); return; }
      fill.style.transition = `clip-path .9s ${EASE}`;
      fill.style.clipPath = 'inset(0 0 100% 0)';   // zieht nach oben ab
      await wait(950);
      fill.remove();
    },
    async fail() {
      fill.style.transition = `clip-path .6s ${EASE}`;
      set(0);
      await wait(650);
      fill.remove();
    },
  };
}

// Plus dreht sich federnd, sobald beide PDFs da sind
export function spinPlus() {
  if (reduce) return;
  $('.drops-plus svg')?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(180deg)' }],
    { duration: 1100, easing: SPRING });
}

/* ---------- Download-Fenster ----------
   Auf: der Hintergrund dunkelt ab, das Fenster wischt von unten auf (wie der Vorhang),
   leicht gekippt; Kopf und Optionen folgen gestaffelt.
   Zu: das Fenster wischt nach oben weg. */
export function openDialog(d) {
  if (d.open) return;
  d.getAnimations({ subtree: true }).forEach(a => a.cancel());
  d.showModal();
  if (reduce) return;
  d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EASE, pseudoElement: '::backdrop' });
  d.animate([
    { clipPath: 'inset(100% 0 0 0 round 22px)', transform: 'perspective(1400px) translateY(60px) rotateX(-8deg)' },
    { clipPath: 'inset(0 0 0 0 round 22px)', transform: 'perspective(1400px) translateY(0) rotateX(0)' },
  ], { duration: 900, easing: EASE });
  enter([...d.querySelectorAll('h2, .muted, .opt, .dialog-actions')], { y: 26, stagger: 45, delay: 140, duration: 900 });
}

export async function closeDialog(d, value = '') {
  if (!d.open || d.dataset.closing) return;
  d.dataset.closing = '1';
  if (!reduce) {
    d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 100, easing: EASE, fill: 'forwards', pseudoElement: '::backdrop' });
    await finished(d.animate([
      { clipPath: 'inset(0 0 0 0 round 22px)', transform: 'translateY(0)' },
      { clipPath: 'inset(0 0 100% 0 round 22px)', transform: 'translateY(-30px)' },
    ], { duration: 650, easing: EASE, fill: 'forwards' }));
  }
  d.close(value);
  d.getAnimations({ subtree: true }).forEach(a => a.cancel());
  d.querySelector('.drop-fill')?.remove();
  delete d.dataset.closing;
}

// Beim Erstellen füllt sich das Fenster blau – wie das Upload-Feld beim Lesen
export function dialogLoader(d) {
  d.querySelector('.drop-fill')?.remove();
  const fill = document.createElement('span');
  fill.className = 'drop-fill';
  fill.innerHTML = '<span class="drop-fill-label"><span>PDF wird erstellt</span><b>Einen Moment</b></span>';
  d.append(fill);
  const label = fill.firstElementChild;
  fill.getBoundingClientRect();
  fill.style.transition = `clip-path 1.1s ${EASE}`;
  fill.style.clipPath = 'inset(0 0 0 0)';
  const shown = wait(reduce ? 0 : 700);   // mindestens kurz sichtbar, auch wenn es schnell geht
  return {
    async finish() {
      await shown;
      $('span', label).textContent = 'Heruntergeladen';
      $('b', label).textContent = 'Fertig';
      if (!reduce) label.animate([{ opacity: 0, transform: 'translateY(30px)' }, { opacity: 1, transform: 'none' }],
        { duration: 700, easing: EASE });
      await wait(reduce ? 0 : 900);
    },
    async fail() {
      await shown;
      fill.style.transition = `clip-path .6s ${EASE}`;
      fill.style.clipPath = 'inset(100% 0 0 0)';
      await wait(650);
      fill.remove();
    },
  };
}

/* ---------- PDF-Seiten blättern ---------- */
export async function sheetOut(sheet, dir) {
  if (reduce) return null;
  const a = sheet.animate([
    { opacity: 1, transform: 'translateX(0) rotateY(0)' },
    { opacity: 0, transform: `perspective(1400px) translateX(${-dir * 60}px) rotateY(${dir * 8}deg)` },
  ], { duration: 260, easing: EASE_IN, fill: 'forwards' });
  await finished(a);
  return a;
}
export function sheetIn(sheet, dir, outAnim) {
  outAnim?.cancel();
  sheet.getAnimations().forEach(a => a.cancel());   // auch abgebrochene Blätter-Animationen aufräumen
  if (reduce) return;
  sheet.animate([
    { opacity: 0, transform: `perspective(1400px) translateX(${dir * 80}px) rotateY(${-dir * 10}deg)` },
    { opacity: 1, transform: 'perspective(1400px) translateX(0) rotateY(0)' },
  ], { duration: 900, easing: EASE });
}

/* ---------- Weiches Scrollen (wie Lenis) ---------- */
export function smoothScroll(el, lerp = 0.1) {
  if (reduce || !el) return;
  let target = 0, cur = 0, running = false;
  const max = () => el.scrollHeight - el.clientHeight;
  const tick = () => {
    cur += (target - cur) * lerp;
    if (Math.abs(target - cur) < 0.4) { cur = target; running = false; }
    el.scrollTop = cur;
    if (running) requestAnimationFrame(tick);
  };
  el.addEventListener('wheel', e => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || max() <= 0) return;
    e.preventDefault();
    if (!running) target = cur = el.scrollTop;   // andere Scrollquellen übernehmen
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
    target = Math.max(0, Math.min(max(), target + e.deltaY * unit));
    if (!running) { running = true; requestAnimationFrame(tick); }
  }, { passive: false });
}

/* ---------- Einträge erscheinen beim Scrollen ---------- */
export function revealer(root) {
  const seen = new Set();
  const io = reduce ? null : new IntersectionObserver(entries => {
    let i = 0;
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const li = en.target;
      io.unobserve(li);
      seen.add(li.dataset.n);
      setTimeout(() => li.classList.add('in'), 60 * i++);
    }
  }, { root, threshold: 0.08 });
  return {
    isSeen: n => reduce || seen.has(String(n)),
    observe(items) { if (io) items.forEach(li => { if (!li.classList.contains('in')) io.observe(li); }); },
    reset() { seen.clear(); io?.disconnect(); },
  };
}

/* ---------- Kartenstapel beim Scrollen (nach skiper-ui «Card stack scroll», skiper16) ----------
   Die Karten bleiben oben kleben (position: sticky) und stapeln sich leicht versetzt.
   Jede Karte, über die andere hinweggleiten, wird schrittweise kleiner. */
const BLUR_BASE = 1.2;   // px: Karten, die nicht gewählt sind
const BLUR_STACK = 1.6;  // px pro Karte, die darüber liegt
const BLUR_MAX = 5;

export function cardStack(list, { step = 10, maxSteps = 5, shrink = 0.045, minScale = 0.82 } = {}) {
  let cards = [], natural = [], tops = [], raf = 0;

  function update() {
    raf = 0;
    const st = list.scrollTop;
    cards.forEach((c, i) => {
      const stickAt = natural[i] - tops[i];                 // ab dieser Scrollposition klebt die Karte
      const covered = Math.max(0, st - stickAt) / Math.max(1, c.offsetHeight);   // wie viele Karten darüber liegen
      c.style.scale = reduce ? '' : Math.max(minScale, 1 - covered * shrink).toFixed(4);
      // nicht gewählt: leicht unscharf; je tiefer im Stapel, desto unschärfer (gewählte Karte bleibt scharf, siehe CSS)
      c.style.setProperty('--stack-blur',`${Math.min(BLUR_MAX, BLUR_BASE + covered * BLUR_STACK).toFixed(2)}px`);
    });
  }

  function layout() {
    cards = [...list.querySelectorAll(':scope > .item')];
    const cs = getComputedStyle(list);
    const gap = parseFloat(cs.rowGap) || 0;
    let y = parseFloat(cs.paddingTop) || 0;
    tops = cards.map((_, i) => Math.min(i, maxSteps) * step);
    natural = cards.map((c, i) => {
      c.style.top = `${tops[i]}px`;
      c.style.zIndex = i + 1;
      const t = y;
      y += c.offsetHeight + gap;
      return t;
    });
    update();
  }

  // gewählte Karte sichtbar machen, ohne den Stapel unnötig zu bewegen
  function reveal(el, smooth = true) {
    const i = cards.indexOf(el);
    if (i < 0) return;
    const st = list.scrollTop, h = el.offsetHeight;
    const stickAt = natural[i] - tops[i];
    const hidden = st > stickAt + 1 || natural[i] + h > st + list.clientHeight;
    if (hidden) list.scrollTo({ top: Math.max(0, stickAt), behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }

  list.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  new ResizeObserver(() => layout()).observe(list);
  return { layout, reveal };
}
