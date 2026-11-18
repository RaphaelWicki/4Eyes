// 4 Eyes – schreibt das Prüfergebnis als PDF-Kommentare ins überarbeitete PDF.
import { KIND_LABEL } from './analyze.js';

export const STATUS_LABEL = { open: 'Offen', check: 'Prüfen', done: 'Erledigt' };
// Palette: Rot #fc3a3f, Pink #fd76c1, Grün #adfd54
const COLORS = { open: [0.988, 0.227, 0.247], check: [0.992, 0.463, 0.757], done: [0.678, 0.992, 0.329] };

const q = s => `«${s}»`;

export function changeSummary(r) {
  if (r.kind === 'replace') return `${q(r.oldDisplay)} → ${q(r.newDisplay)}`;
  if (r.kind === 'delete') return `${q(r.oldDisplay)} löschen`;
  if (r.kind === 'insert') return `${q(r.newDisplay)} einfügen`;
  return r.comment ? r.comment : 'Kommentar ohne Text';
}

// Im exportierten PDF steht nur der Originalkommentar der Kund*in, ohne Status, Antworten oder Hinweise.
// Fehlt ein Kommentartext (z. B. reine Durchstreichung), steht die Korrektur selbst da.
export function exportText(r) {
  return r.comment?.trim() || changeSummary(r);
}

export function annotationText(r) {
  const lines = [`#${r.n} · ${STATUS_LABEL[r.status]}${r.manual ? ' (manuell)' : ''} · ${KIND_LABEL[r.kind]}`];
  if (r.kind !== 'manual') lines.push(changeSummary(r));
  if (r.comment) lines.push(`Kund*in${r.author ? ` (${r.author})` : ''}: ${r.comment}`);
  for (const rep of r.replies ?? []) lines.push(`↳ ${rep.author ? rep.author + ': ' : ''}${rep.text}`);
  if (r.reason) lines.push(r.reason);
  if (r.rev?.approx) lines.push('Position im neuen PDF geschätzt (gleiche Stelle wie im Korrektur-PDF).');
  return lines.join('\n');
}

const fmt = n => (Math.round(n * 100) / 100).toString();

function addAnnotation(doc, page, r) {
  const { PDFName, PDFHexString, PDFString } = window.PDFLib;
  const ctx = doc.context;
  const color = COLORS[r.status];
  const pad = 1.5;
  const rects = r.rev.rects.map(x => [x[0] - pad, x[1] - pad, x[2] + pad, x[3] + pad]);
  const rect = rects.reduce((u, x) => [Math.min(u[0], x[0]), Math.min(u[1], x[1]), Math.max(u[2], x[2]), Math.max(u[3], x[3])]);
  const asText = !r.rev.approx;
  const c = color.map(fmt).join(' ');

  let ops, gs;
  if (asText) {
    gs = { Type: 'ExtGState', ca: 0.38, CA: 1, BM: 'Multiply' };
    ops = `/GS0 gs ${c} rg ` + rects.map(x => `${fmt(x[0])} ${fmt(x[1])} ${fmt(x[2] - x[0])} ${fmt(x[3] - x[1])} re`).join(' ') + ' f';
  } else {
    gs = { Type: 'ExtGState', ca: 0.12, CA: 0.95 };
    const w = 1.6;
    ops = `/GS0 gs ${c} rg ${c} RG ${w} w ${fmt(rect[0] + w / 2)} ${fmt(rect[1] + w / 2)} ${fmt(rect[2] - rect[0] - w)} ${fmt(rect[3] - rect[1] - w)} re B`;
  }
  const ap = ctx.register(ctx.stream(ops, {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect,
    Resources: { ExtGState: { GS0: gs } },
  }));

  const text = exportText(r);
  const dict = {
    Type: 'Annot',
    Subtype: asText ? 'Highlight' : 'Square',
    Rect: rect,
    F: 4,
    C: color,
    T: PDFHexString.fromText(r.author || 'Kund*in'),
    Contents: PDFHexString.fromText(text),
    M: PDFString.fromDate(new Date()),
    NM: PDFString.of(`4eyes-${r.n}-${Date.now()}`),
    AP: { N: ap },
  };
  if (asText) {
    dict.QuadPoints = rects.flatMap(x => [x[0], x[3], x[2], x[3], x[0], x[1], x[2], x[1]]);
  } else {
    dict.BS = { W: 1.6, S: 'S' };
  }
  const annotRef = ctx.register(ctx.obj(dict));

  const { width, height } = page.getSize();
  const pw = 220, ph = 140;
  const px = Math.min(Math.max(rect[2] + 6, 0), Math.max(0, width - pw));
  const py = Math.min(Math.max(rect[3] - ph, 0), Math.max(0, height - ph));
  const popupRef = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Popup', Parent: annotRef, Rect: [px, py, px + pw, py + ph], Open: false,
  }));
  ctx.lookup(annotRef).set(PDFName.of('Popup'), popupRef);
  page.node.addAnnot(annotRef);
  page.node.addAnnot(popupRef);
}

// ---------------------------------------------------------------------------
// Prüfbericht (Standardschrift Helvetica → nur WinAnsi-Zeichen)

const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function sanitize(s) {
  return [...String(s).normalize('NFC').replace(/[→⇒➔]/g, '->').replace(/↳/g, '>').replace(/\t/g, ' ')]
    .map(ch => {
      const cp = ch.codePointAt(0);
      if (ch === '\n' || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff && cp !== 0xad) || WINANSI_EXTRA.includes(ch)) return ch;
      return '?';
    }).join('');
}

function wrap(text, font, size, maxW) {
  const out = [];
  for (const para of sanitize(text).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const tryLine = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxW) { line = tryLine; continue; }
      if (line) out.push(line);
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxW) {
        let k = w.length - 1;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--;
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

async function addReport(doc, results, meta) {
  const { StandardFonts, rgb } = window.PDFLib;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, colW = W - 2 * M;
  const ink = rgb(0.13, 0.13, 0.14), muted = rgb(0.45, 0.45, 0.48), rule = rgb(0.88, 0.88, 0.9);
  let page, y;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const ensure = h => { if (y - h < M) newPage(); };
  const text = (t, x, size, f = font, color = ink) => page.drawText(sanitize(t), { x, y, size, font: f, color });

  newPage();
  text('Korrekturprüfung', M, 22, bold);
  y -= 30;
  for (const line of [
    `Korrektur-PDF: ${meta.origName}`,
    `Überarbeitetes PDF: ${meta.revName}`,
    `Runde ${meta.round} · ${meta.date}`,
  ]) { for (const l of wrap(line, font, 10, colW)) { text(l, M, 10, font, muted); y -= 14; } }
  y -= 8;
  const counts = { open: 0, check: 0, done: 0 };
  results.forEach(r => counts[r.status]++);
  let x = M;
  for (const k of ['open', 'check', 'done']) {
    page.drawCircle({ x: x + 5, y: y + 4, size: 4.5, color: rgb(...COLORS[k]) });
    const label = `${counts[k]} ${STATUS_LABEL[k]}`;
    text(label, x + 15, 12, bold);
    x += 15 + bold.widthOfTextAtSize(sanitize(label), 12) + 26;
  }
  y -= 22;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: rule });
  y -= 22;

  const order = { open: 0, check: 1, done: 2 };
  const sorted = [...results].sort((a, b) => order[a.status] - order[b.status] || a.n - b.n);
  for (const r of sorted) {
    const body = [];
    if (r.kind !== 'manual') body.push({ t: changeSummary(r), f: font, c: ink });
    if (r.comment && (r.kind === 'manual' || r.comment !== r.newDisplay)) body.push({ t: `Kund*in: ${r.comment}`, f: font, c: ink });
    if (r.reason) body.push({ t: r.reason, f: font, c: muted });
    const lines = body.flatMap(b => wrap(b.t, b.f, 9.5, colW - 22).map(l => ({ ...b, l })));
    ensure(18 + lines.length * 13 + 12);
    page.drawCircle({ x: M + 5, y: y + 4, size: 4.5, color: rgb(...COLORS[r.status]) });
    const head = `#${r.n}  ${STATUS_LABEL[r.status]}${r.manual ? ' (manuell)' : ''}  ·  ${KIND_LABEL[r.kind]}  ·  Kund*in S. ${r.page + 1} -> neu S. ${r.rev.page + 1}`;
    text(head, M + 22, 10.5, bold);
    y -= 16;
    for (const ln of lines) { text(ln.l, M + 22, 9.5, ln.f, ln.c); y -= 13; }
    y -= 12;
  }
}

/** Erzeugt das kommentierte PDF als Uint8Array. */
export async function buildAnnotatedPdf(revBytes, results, meta, opts) {
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.load(revBytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const chosen = results.filter(r => opts.include[r.status]);
  for (const r of chosen) {
    const page = pages[Math.min(r.rev.page, pages.length - 1)];
    addAnnotation(doc, page, r);
  }
  if (opts.report) await addReport(doc, results, meta);
  return doc.save();
}
