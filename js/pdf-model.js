// 4 Eyes – liest Text (mit Zeichenpositionen) und Kommentare aus einem PDF.
import { canon } from './analyze.js';

let measureCtx = null;
const widthCache = new Map();

/** Relative Zeichenbreiten über die Ersatzschrift von pdf.js schätzen. */
function charWeights(glyphs, family) {
  if (!measureCtx) {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    measureCtx = cv.getContext('2d');
  }
  const fam = family || 'sans-serif';
  measureCtx.font = `100px ${fam}`;
  return glyphs.map(g => {
    const key = fam + '|' + g;
    let w = widthCache.get(key);
    if (w == null) {
      w = measureCtx.measureText(g).width || 55;
      widthCache.set(key, w);
    }
    return w;
  });
}

function normRect(r) {
  if (!r) return [0, 0, 0, 0];
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

function parseQuads(q) {
  if (!q || !q.length) return [];
  const out = [];
  if (Array.isArray(q[0])) {
    // ältere pdf.js-Versionen: [[{x,y}×4], …]
    for (const quad of q) {
      const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  } else {
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]], ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  return out;
}

export async function openPdf(pdfjsLib, bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
}

/** Baut das Text- und Kommentarmodell eines geöffneten pdf.js-Dokuments. */
export async function buildModel(pdf, onProgress) {
  const pages = [], pageRanges = [], chars = [], annotations = [];

  for (let p = 0; p < pdf.numPages; p++) {
    const page = await pdf.getPage(p + 1);
    const view = page.view;
    pages.push({ width: view[2] - view[0], height: view[3] - view[1], view: [...view], rotate: page.rotate });

    const tc = await page.getTextContent();
    const start = chars.length;
    let pendingSpace = true;
    let hyphenCandidate = -1;
    let prev = null;

    const push = (rec) => {
      if (hyphenCandidate >= 0) {
        if (hyphenCandidate === chars.length - 1 && /\p{Ll}/u.test(rec.c)) {
          chars.pop();      // Trennstrich am Zeilenende: Wort läuft weiter
          rec.sp = false;
        }
        hyphenCandidate = -1;
      }
      chars.push(rec);
    };

    for (const item of tc.items) {
      if (typeof item.str !== 'string') continue;
      if (!item.str.length) {
        if (item.hasEOL && prev) prev.eol = true;
        continue;
      }
      const t = item.transform;
      const fs = Math.hypot(t[2], t[3]) || item.height || 10;
      const len = Math.hypot(t[0], t[1]);
      const ux = len ? t[0] / len : 1, uy = len ? t[1] / len : 0;

      if (prev) {
        const perp = (t[4] - prev.x) * -uy + (t[5] - prev.y) * ux;
        const along = (t[4] - prev.endX) * ux + (t[5] - prev.endY) * uy;
        const newLine = prev.eol || Math.abs(perp) > fs * 0.5 || along < -fs * 1.5;
        if (newLine) {
          pendingSpace = true;
          const n = chars.length;
          if (n - 2 >= start && chars[n - 1].c === '-' && !chars[n - 1].sp && /\p{L}/u.test(chars[n - 2].c)) {
            hyphenCandidate = n - 1;
          }
        } else if (along > fs * 0.15) pendingSpace = true;
      }

      const glyphs = [...item.str];
      const fam = tc.styles?.[item.fontName]?.fontFamily;
      const weights = charWeights(glyphs, fam);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      const width = item.width > 0 ? item.width : fs * 0.5 * glyphs.length;
      const scale = width / total;
      const px = -uy, py = ux, lo = -0.22 * fs, hi = 0.78 * fs;

      let cum = 0;
      for (let gi = 0; gi < glyphs.length; gi++) {
        const g = glyphs[gi];
        const gw = weights[gi] * scale;
        if (/\s/u.test(g)) { pendingSpace = true; cum += gw; continue; }
        const cg = canon(g);
        if (!cg) { cum += gw; continue; }
        const bx = t[4] + ux * cum, by = t[5] + uy * cum;
        const ex = bx + ux * gw, ey = by + uy * gw;
        const xs = [bx + px * lo, bx + px * hi, ex + px * lo, ex + px * hi];
        const ys = [by + py * lo, by + py * hi, ey + py * lo, ey + py * hi];
        const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        for (let k = 0; k < cg.length; k++) { // pro UTF-16-Einheit, damit text[i] ↔ chars[i]
          // c = vereinheitlicht (Vergleich), o = Originalzeichen (Anzeige)
          push({ c: cg[k], o: k === 0 ? g.normalize('NFC') : '', p, ...box, sp: pendingSpace });
          pendingSpace = false;
        }
        cum += gw;
      }
      prev = { x: t[4], y: t[5], endX: t[4] + ux * width, endY: t[5] + uy * width, eol: !!item.hasEOL };
    }
    pageRanges.push({ start, end: chars.length });

    const annots = await page.getAnnotations();
    for (const a of annots) {
      if (!a.subtype) continue;
      annotations.push({
        id: a.id ?? `p${p}-${annotations.length}`,
        page: p,
        subtype: a.subtype,
        rect: normRect(a.rect),
        quads: parseQuads(a.quadPoints),
        contents: a.contentsObj?.str ?? a.contents ?? '',
        author: a.titleObj?.str ?? a.title ?? '',
        date: a.modificationDate ?? a.creationDate ?? '',
        inReplyTo: a.inReplyTo ?? null,
        replyType: a.replyType ?? null,
        color: a.color ? Array.from(a.color) : null,
      });
    }
    page.cleanup();
    onProgress?.((p + 1) / pdf.numPages);
  }

  return { pages, pageRanges, chars, text: chars.map(c => c.c).join(''), annotations };
}
