// 4 Eyes – lebendiges Logo
// Baut das Logo aus dem Symbol #logo (index.html) als eigenes SVG auf, damit jedes Auge
// einzeln animiert werden kann:
//   - Aufbau (nur data-logo="intro"): erst die Buchstaben, dann die Augen, schnell nacheinander
//   - Umherschauen: jedes Auge einzeln, in eigenem, unregelmässigem Takt
//   - Blinzeln: einmal nach dem Aufbau, comicartig (weisser Schlitz, Unschärfe, Nachfedern)

const NS = 'http://www.w3.org/2000/svg';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mittelpunkte aus den Originalpfaden (img/logo-4eyes.svg)
const EYES = [
  { cx: 25.236, cy: 72.507, r: 25.236, px: 30.790, py: 76.647 },
  { cx: 65.014, cy: 59.106, r: 25.236, px: 71.719, py: 60.823 },
  { cx: 101.792, cy: 84.352, r: 25.236, px: 95.258, py: 82.029 },
  { cx: 129.553, cy: 57.127, r: 25.236, px: 123.847, py: 61.055 },
];
const PUPIL_R = 10.088;
const REACH = EYES[0].r - PUPIL_R - 2.5;      // wie weit eine Pupille wandern darf

const rand = (a, b) => a + Math.random() * (b - a);

function el(name, attrs = {}) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

let uid = 0;

function build(svg) {
  // pro Logo ein <defs> für die Blinzel-Unschärfe (je Auge ein eigener Filter)
  const defs = el('defs');
  svg.append(defs);
  const src = document.getElementById('logo');
  const eyePaths = [...src.querySelectorAll('.logo-eye')];
  const pupilPaths = [...src.querySelectorAll('.logo-pupil')];
  const typePaths = [...src.querySelectorAll('.logo-type')];

  const eyes = EYES.map((e, i) => {
    const wrap = el('g', { class: 'eye-wrap' });
    const ball = el('g', { class: 'eye-ball' });
    const white = el('path', { class: 'logo-eye', d: eyePaths[i].getAttribute('d') });
    const pupil = el('path', { class: 'logo-pupil', d: pupilPaths[i].getAttribute('d') });
    // geschlossenes Lid: ein Bogen, der beim Blinzeln kurz aufblitzt
    const w = e.r * 0.82;
    const lid = el('path', {
      class: 'eye-lid',
      d: `M${e.cx - w} ${e.cy - 1} Q${e.cx} ${e.cy + e.r * 0.42} ${e.cx + w} ${e.cy - 1}`,
    });
    ball.append(white, pupil);
    // Bewegungsunschärfe beim Blinzeln: vor allem senkrecht, nur während des Blinzelns aktiv
    const fid = `eye-blur-${++uid}`;
    const filter = el('filter', { id: fid, x: '-40%', y: '-120%', width: '180%', height: '340%' });
    const blur = el('feGaussianBlur', { stdDeviation: '0 0' });
    filter.append(blur);
    defs.append(filter);
    wrap.append(ball, lid);
    svg.append(wrap);
    return { ...e, wrap, ball, pupil, lid, blur, fid };
  });

  const letters = typePaths.map(p => {
    const n = el('path', { class: 'logo-type', d: p.getAttribute('d') });
    svg.append(n);
    return n;
  });

  return { svg, eyes, letters };
}

/* ---------- Aufbau ---------- */
function intro({ eyes, letters }) {
  const pop = 'cubic-bezier(.34, 1.56, .64, 1)';   // weich, mit kleinem Überschwingen
  let t = 0;
  letters.forEach(n => {
    n.animate(
      [{ opacity: 0, transform: 'translateY(10px) scale(.6)' }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: t, easing: pop, fill: 'backwards' });
    t += 65;
  });
  t += 40;
  eyes.forEach(e => {
    e.wrap.animate(
      [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'none' }],
      { duration: 460, delay: t, easing: pop, fill: 'backwards' });
    t += 75;
  });
  return t + 460;   // ms bis alles steht
}

/* ---------- Umherschauen ----------
   Jedes Auge hat seinen eigenen Takt und schaut, wohin es will.
   Ab und zu bewegen sich alle gleichzeitig – dann aber jedes in eine andere Richtung. */
function gazeTo(e, angle, mag) {
  const gx = Math.cos(angle) * mag * REACH, gy = Math.sin(angle) * mag * REACH;
  const dx = e.cx + gx - e.px, dy = e.cy + gy - e.py;
  e.pupil.style.transitionDuration = `${Math.round(rand(200, 450))}ms`;
  e.pupil.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
}

function lookAlone(e) {
  // meist weit zum Rand, manchmal fast mittig
  gazeTo(e, rand(0, Math.PI * 2), Math.random() < 0.2 ? rand(0, 0.3) : rand(0.55, 1));
}

function lookTogetherApart(logo) {
  // gleicher Moment, verschiedene Richtungen: Winkel gleichmässig verteilt, dann gemischt
  const base = rand(0, Math.PI * 2);
  const angles = logo.eyes.map((_, i) => base + i * (Math.PI * 2 / logo.eyes.length) + rand(-0.4, 0.4))
    .sort(() => Math.random() - 0.5);
  logo.eyes.forEach((e, i) => gazeTo(e, angles[i], rand(0.6, 1)));
}

function scheduleEyeLook(e) {
  lookAlone(e);
  // unregelmässig: mal kurz hintereinander, mal lange Pause
  const next = Math.random() < 0.15 ? rand(500, 1000) : rand(2500, 6500);
  e.lookTimer = setTimeout(() => scheduleEyeLook(e), next);
}

function scheduleGroupLook(logo) {
  logo.groupTimer = setTimeout(() => {
    lookTogetherApart(logo);
    scheduleGroupLook(logo);
  }, rand(9000, 16000));
}

/* ---------- Comic-Blinzeln ----------
   Das Auge quetscht sich breit zu einem weissen Schlitz und federt beim Öffnen nach.
   Die Pupille verschwindet kurz, so bleibt keine schwarze Kontur.
   Eine weiche Bewegungsunschärfe begleitet das Zu- und Aufgehen.
   SHOW_LID = true zeigt stattdessen einen schwarzen Lid-Bogen (frühere Variante). */
const SHOW_LID = false;

// Unschärfe folgt der Bewegung: stark beim Zu- und Aufgehen, scharf im geschlossenen Moment und am Ende
const BLUR_Y = 2.8, BLUR_X = 0.7;
function blurAmount(t) {
  if (t < 0.32) return Math.sin(Math.PI * t / 0.32);                    // zugehen
  if (t < 0.48) return 0.25;                                              // kurz zu
  if (t < 0.9) return Math.sin(Math.PI * (t - 0.48) / 0.42) * 0.9;        // aufgehen + nachfedern
  return 0;
}

function blurDuring(e, dur, delay) {
  setTimeout(() => {
    e.ball.setAttribute('filter', `url(#${e.fid})`);
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      const k = blurAmount(t);
      e.blur.setAttribute('stdDeviation', `${(k * BLUR_X).toFixed(2)} ${(k * BLUR_Y).toFixed(2)}`);
      if (t < 1) requestAnimationFrame(step);
      else e.ball.removeAttribute('filter');
    };
    requestAnimationFrame(step);
  }, delay);
}

function blinkEye(e, delay = 0) {
  const dur = 280;
  blurDuring(e, dur, delay);
  e.ball.animate([
    { transform: 'scale(1, 1)', easing: 'cubic-bezier(.55, 0, 1, .45)' },
    { transform: 'scale(1.16, .12)', offset: 0.32 },
    { transform: 'scale(1.16, .12)', offset: 0.48, easing: 'cubic-bezier(0, .55, .45, 1)' },
    { transform: 'scale(.93, 1.12)', offset: 0.78 },
    { transform: 'scale(1, 1)' },
  ], { duration: dur, delay });
  e.pupil.animate([
    { opacity: 1 }, { opacity: 1, offset: 0.2 }, { opacity: 0, offset: 0.3 },
    { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.64 }, { opacity: 1 },
  ], { duration: dur, delay });
  if (SHOW_LID) {
    e.lid.animate([
      { opacity: 0 }, { opacity: 0, offset: 0.24 }, { opacity: 1, offset: 0.32 },
      { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.6 }, { opacity: 0 },
    ], { duration: dur, delay });
  }
}

function blinkWave(logo) {
  // zur Begrüssung: ein Auge nach dem anderen, in zufälliger Reihenfolge
  [...logo.eyes].sort(() => Math.random() - 0.5).forEach((e, i) => blinkEye(e, i * 90));
}

/* ---------- Start ---------- */
document.querySelectorAll('svg[data-logo]').forEach(svg => {
  const logo = build(svg);
  if (reduceMotion) return;
  let wait = 600;
  if (svg.dataset.logo === 'intro') {
    wait = intro(logo);
    setTimeout(() => blinkWave(logo), wait - 120);
    wait += 500;
  }
  // danach nur noch umherschauen; jedes Auge startet versetzt, damit nie alle im Gleichschritt laufen
  logo.eyes.forEach(e => {
    e.lookTimer = setTimeout(() => scheduleEyeLook(e), wait + rand(0, 1800));
  });
  scheduleGroupLook(logo);
});
