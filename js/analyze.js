// 4 Eyes – Kernlogik (ohne DOM).
// Liest Kommentare der Kund*innen aus dem Korrektur-PDF, leitet daraus die erwartete
// Änderung ab und prüft im überarbeiteten PDF, ob sie umgesetzt wurde.
//
// Beide Dokumente liegen als "Modell" vor (siehe pdf-model.js):
//   { pages:[{width,height,view}], pageRanges:[{start,end}],
//     chars:[{c,p,x0,y0,x1,y1,sp}], text, annotations:[…] }
// `text` ist der "kompakte" Text: ohne Leerraum, ohne Trennstriche am Zeilenende,
// typografisch vereinheitlicht. text[i] gehört zu chars[i].

export const MARKUP = new Set(['StrikeOut', 'Highlight', 'Underline', 'Squiggly']);
const IGNORE = new Set(['Popup', 'Link', 'Widget', 'Redact', 'Watermark', 'PrinterMark',
  'TrapNet', 'Screen', 'Movie', 'Sound', 'RichMedia', '3D']);

const INVISIBLE = /[\s­​-‍⁠﻿]/g;
const DASHES = /[‐-―−⁃]/g;
const DQUOTES = /[“-‟«»″]/g;
const SQUOTES = /[‘-‛‹›′`´]/g;

/** Vereinheitlicht Text für den Vergleich. */
export function canon(str) {
  return String(str ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(DASHES, '-')
    .replace(DQUOTES, '"')
    .replace(SQUOTES, "'");
}

// ---------------------------------------------------------------------------
// Kommentartext deuten

const QUOTE_CHARS = '"\'„“”«»‹›‚‘’`´';
function unquote(s) {
  let t = String(s).trim();
  while (t.length > 1 && QUOTE_CHARS.includes(t[0])) t = t.slice(1).trim();
  while (t.length > 1 && QUOTE_CHARS.includes(t[t.length - 1])) t = t.slice(0, -1).trim();
  return t;
}

const WORD_TO_CHAR = {
  komma: ',', punkt: '.', doppelpunkt: ':', semikolon: ';', strichpunkt: ';',
  bindestrich: '-', gedankenstrich: '–', fragezeichen: '?', ausrufezeichen: '!',
  apostroph: '’', klammer: '(', leerzeichen: ' ', leerschlag: ' ',
};
function wordToChar(s) {
  const k = s.toLowerCase().replace(/[.!]$/, '').trim();
  return k in WORD_TO_CHAR ? WORD_TO_CHAR[k] : s;
}

const INSTRUCTION = /\?|prüfen|pruefen|checken|kontrollier|grösser|größer|groesser|kleiner|fett|kursiv|unterstrich|schrift|abstand|farbe|bild|foto|grafik|zeile|absatz|umbruch|umbrechen|einzug|ausricht|zentrier|bündig|buendig|tabelle|spalte|logo|layout|versal|kapitälchen|hochgestellt|tiefgestellt|zusammen|getrennt|trennen|verschieben|tauschen|einheitlich|siehe|vgl\.|unklar|falsch|fehlt/i;

/**
 * Deutet einen Kommentartext.
 * Ergebnis: null | {kind:'delete'} | {kind:'replace', old?, new} | {kind:'insert', new}
 *         | {kind:'plain', text} | {kind:'instruction', text}
 */
export function parseComment(raw) {
  const t = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) return null;
  const one = t.replace(/\s+/g, ' ');
  let m;

  if (/^(bitte\s+)?((das|den|die|dieses?|ganzen?)\s+)?(wort|wörter|satz|absatz|zeile|text|zeichen|komma|punkt|buchstaben?)?\s*(l(ö|oe)schen|streichen|entfernen|weglassen|rausnehmen|raus|weg|delete|remove)[.!]*$/i.test(one)) {
    return { kind: 'delete' };
  }
  if ((m = one.match(/^(.+?)\s*(?:→|->|=>|⇒|➔|>)\s*(.+)$/))) {
    return { kind: 'replace', old: unquote(m[1]), new: wordToChar(unquote(m[2])) };
  }
  if ((m = one.match(/^(.+?)\s+(?:statt|anstatt|anstelle von|anstelle|instead of)\s+(.+?)[.!]?$/i))) {
    return { kind: 'replace', old: unquote(m[2]), new: wordToChar(unquote(m[1])) };
  }
  if ((m = one.match(/^(?:bitte\s+)?(.+?)\s+(?:durch|mit)\s+(.+?)\s+(?:ersetzen|austauschen)[.!]?$/i))) {
    return { kind: 'replace', old: unquote(m[1]), new: wordToChar(unquote(m[2])) };
  }
  if (one.includes('?') || INSTRUCTION.test(one)) return { kind: 'instruction', text: t };
  if ((m = one.match(/^(?:bitte\s+)?(?:ersetzen|austauschen|ändern|aendern|korrigieren|ersetze|neu|korrekt|richtig|replace(?:\s+with)?|change(?:\s+to)?)(?:\s+(?:durch|in|zu|mit|auf))?(?:\s*[:：]\s*|\s+)(.+)$/i))) {
    return { kind: 'replace', new: wordToChar(unquote(m[1])) };
  }
  if ((m = one.match(/^(?:bitte\s+)?(?:einfügen|einfuegen|ergänzen|ergaenzen|hinzufügen|hinzufuegen|insert|add)(?:\s*[:：]\s*|\s+)(.+)$/i))) {
    return { kind: 'insert', new: wordToChar(unquote(m[1])) };
  }
  if ((m = one.match(/^(?:bitte\s+)?(.+?)\s+(?:einfügen|einfuegen|ergänzen|ergaenzen|hinzufügen|hinzufuegen)[.!]?$/i))) {
    return { kind: 'insert', new: wordToChar(unquote(m[1])) };
  }
  if (/^["„“«‹‚‘'].+["“”»›‘’']$/.test(one)) {
    return { kind: 'replace', new: unquote(one) };
  }
  if (one.length > 80) return { kind: 'instruction', text: t };
  return { kind: 'plain', text: t };
}

// ---------------------------------------------------------------------------
// Geometrie: Zeichen unter Markierungen finden

function centerOf(ch) {
  return { x: (ch.x0 + ch.x1) / 2, y: (ch.y0 + ch.y1) / 2, h: ch.y1 - ch.y0 };
}

function charsInQuads(doc, page, quads) {
  const r = doc.pageRanges[page];
  if (!r) return [];
  const out = [];
  for (let i = r.start; i < r.end; i++) {
    const { x, y, h } = centerOf(doc.chars[i]);
    for (const q of quads) {
      const tol = Math.min(h * 0.25, (q[3] - q[1]) * 0.25);
      if (x >= q[0] && x <= q[2] && y >= q[1] - tol && y <= q[3] + tol) { out.push(i); break; }
    }
  }
  return out;
}

function charsInRect(doc, page, rect) {
  return charsInQuads(doc, page, [rect]);
}

function boxDistance(px, py, ch) {
  const dx = px < ch.x0 ? ch.x0 - px : px > ch.x1 ? px - ch.x1 : 0;
  const dy = py < ch.y0 ? ch.y0 - py : py > ch.y1 ? py - ch.y1 : 0;
  return Math.hypot(dx, dy);
}

/** Einfügeposition eines Caret-Kommentars (Index im kompakten Text). */
function caretIndex(doc, page, rect) {
  const r = doc.pageRanges[page];
  if (!r || r.end <= r.start) return null;
  const x = (rect[0] + rect[2]) / 2;
  const y = (rect[1] + rect[3]) / 2;
  let best = null, bestD = Infinity;
  for (let i = r.start; i < r.end; i++) {
    const ch = doc.chars[i];
    const dy = y < ch.y0 ? ch.y0 - y : y > ch.y1 ? y - ch.y1 : 0;
    const dl = Math.abs(x - ch.x0), dr = Math.abs(x - ch.x1);
    const d = dy * 3 + Math.min(dl, dr);
    if (d < bestD) { bestD = d; best = dl <= dr ? i : i + 1; }
  }
  return best;
}

function sameLine(a, b) {
  if (a.p !== b.p) return false;
  const ca = centerOf(a), cb = centerOf(b);
  return Math.abs(ca.y - cb.y) < Math.max(ca.h, cb.h) * 0.5;
}

/** Die Textzeile, die einem Punkt am nächsten liegt, als Bereich [s,e). */
function nearestLine(doc, page, px, py) {
  const r = doc.pageRanges[page];
  if (!r || r.end <= r.start) return null;
  // Notizen stehen meist im Rand neben der Zeile: vertikaler Abstand zählt viel mehr
  let best = -1, bestD = Infinity, bestDist = Infinity;
  for (let i = r.start; i < r.end; i++) {
    const ch = doc.chars[i];
    const dx = px < ch.x0 ? ch.x0 - px : px > ch.x1 ? px - ch.x1 : 0;
    const dy = py < ch.y0 ? ch.y0 - py : py > ch.y1 ? py - ch.y1 : 0;
    const d = dy + dx * 0.15;
    if (d < bestD) { bestD = d; best = i; bestDist = Math.hypot(dx, dy); }
  }
  const bestDist_ = bestDist;
  let s = best, e = best + 1;
  while (s > r.start && sameLine(doc.chars[s - 1], doc.chars[best])) s--;
  while (e < r.end && sameLine(doc.chars[e], doc.chars[best])) e++;
  return { s, e, dist: bestDist_, score: bestD };
}

/** Einfügeposition auf die nächste Wortgrenze schieben (Positionen sind geschätzt). */
function snapToWordBoundary(doc, pos, page) {
  const r = doc.pageRanges[page];
  const isBoundary = k => k === r.start || k === r.end || doc.chars[k]?.sp;
  if (isBoundary(pos)) return pos;
  for (let d = 1; d <= 3; d++) {
    if (pos + d <= r.end && isBoundary(pos + d)) return pos + d;
    if (pos - d >= r.start && isBoundary(pos - d)) return pos - d;
  }
  return pos;
}

/** Fundstelle von `needle`, die am nächsten bei einer Position liegt. */
function nearestOccurrence(doc, needle, page, px, py) {
  if (!needle) return null;
  let best = null, bestScore = Infinity;
  let k = doc.text.indexOf(needle);
  while (k >= 0) {
    const ch = doc.chars[k];
    const score = Math.abs(ch.p - page) * 100000 + boxDistance(px, py, ch);
    if (score < bestScore) { bestScore = score; best = k; }
    k = doc.text.indexOf(needle, k + 1);
  }
  return best == null ? null : { s: best, e: best + needle.length };
}

// ---------------------------------------------------------------------------
// Anzeige-Text mit Leerzeichen rekonstruieren

export function displayRange(doc, s, e) {
  s = Math.max(0, s); e = Math.min(doc.chars.length, e);
  let out = '';
  for (let i = s; i < e; i++) {
    const ch = doc.chars[i];
    if (i > s && ch.sp) out += ' ';
    out += ch.o ?? ch.c;
  }
  return out;
}

function contextBefore(doc, s, n = 48) {
  let t = displayRange(doc, s - n, s);
  if (s - n > 0) t = t.replace(/^\S*\s/, '');
  if (s < doc.chars.length && doc.chars[s]?.sp) t += ' ';
  return t;
}
function contextAfter(doc, e, n = 48) {
  let t = displayRange(doc, e, e + n);
  if (e + n < doc.chars.length) t = t.replace(/\s\S*$/, '');
  if (e < doc.chars.length && doc.chars[e]?.sp) t = ' ' + t;
  return t;
}

// ---------------------------------------------------------------------------
// Kommentare gruppieren (Ersetzen = Durchstreichen + Einfügezeichen, Antworten)

function groupAnnotations(annots) {
  const list = annots.filter(a => !IGNORE.has(a.subtype));
  const byId = new Map(list.map(a => [a.id, a]));
  const parent = new Map(list.map(a => [a.id, a.id]));
  const find = id => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const replyIds = new Set();
  for (const a of list) {
    if (!a.inReplyTo || !byId.has(a.inReplyTo)) continue;
    if (a.replyType === 'Group') parent.set(find(a.id), find(a.inReplyTo));
    else replyIds.add(a.id);
  }
  const groups = new Map();
  for (const a of list) {
    if (replyIds.has(a.id)) continue;
    const root = find(a.id);
    if (!groups.has(root)) groups.set(root, { id: root, members: [], replies: [] });
    groups.get(root).members.push(a);
  }
  for (const id of replyIds) {
    let target = byId.get(id).inReplyTo, guard = 0;
    while (replyIds.has(target) && guard++ < 50) target = byId.get(target).inReplyTo;
    const g = groups.get(find(target));
    if (g) g.replies.push(byId.get(id));
  }
  return [...groups.values()];
}

function unionRect(rects) {
  return rects.reduce((u, r) => [Math.min(u[0], r[0]), Math.min(u[1], r[1]),
    Math.max(u[2], r[2]), Math.max(u[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
}

// ---------------------------------------------------------------------------
// Eine Kommentargruppe in eine erwartete Änderung übersetzen

const SUBTYPE_LABEL = {
  StrikeOut: 'Durchgestrichen', Highlight: 'Hervorgehoben', Underline: 'Unterstrichen',
  Squiggly: 'Unterschlängelt', Caret: 'Einfügezeichen', Text: 'Notiz', FreeText: 'Textfeld',
  Ink: 'Freihand', Square: 'Rechteck', Circle: 'Kreis', Line: 'Linie', Polygon: 'Polygon',
  PolyLine: 'Linienzug', Stamp: 'Stempel', FileAttachment: 'Anhang', Sound: 'Ton',
};

function interpret(group, doc) {
  const members = group.members;
  const first = members.find(a => a.subtype !== 'Caret') ?? members[0];
  const page = first.page;
  const markups = members.filter(a => MARKUP.has(a.subtype));
  const strikes = markups.filter(a => a.subtype === 'StrikeOut');
  const carets = members.filter(a => a.subtype === 'Caret');

  const c = {
    id: group.id,
    memberIds: members.map(a => a.id),
    page,
    rect: unionRect(members.filter(a => a.page === page).map(a => a.rect)),
    types: [...new Set(members.map(a => SUBTYPE_LABEL[a.subtype] ?? a.subtype))],
    author: members.map(a => a.author).find(Boolean) ?? '',
    date: members.map(a => a.date).find(Boolean) ?? '',
    replies: group.replies.filter(r => r.contents?.trim())
      .map(r => ({ author: r.author ?? '', text: r.contents.trim() })),
    kind: 'manual', s: null, e: null, alts: [], newDisplay: '', hypothesis: false,
    expectNew: null, comment: '', note: '',
  };

  // markierter Bereich
  if (markups.length) {
    const idx = [];
    for (const m of markups) idx.push(...charsInQuads(doc, m.page, m.quads?.length ? m.quads : [m.rect]));
    if (idx.length) { c.s = Math.min(...idx); c.e = Math.max(...idx) + 1; }
  }
  const marked = c.s != null ? doc.text.slice(c.s, c.e) : '';

  // Kommentartexte (ohne von Acrobat kopierten Markierungstext)
  const seen = new Set();
  const texts = [];
  for (const a of members) {
    let t = (a.contents ?? '').trim();
    if (!t) continue;
    const own = parseComment(t);
    const explicit = own && own.kind === 'replace' && own.old; // z. B. «Zürich → Winterthur»
    if (!explicit && marked && canon(t).startsWith(marked) && canon(t) !== marked) {
      // "markierter Text + eigener Kommentar": markierten Teil abschneiden
      for (let k = 1; k <= t.length; k++) {
        if (canon(t.slice(0, k)) === marked) { t = t.slice(k).replace(/^[\s:–—-]+/, '').trim(); break; }
      }
    }
    if (marked && canon(t) === marked) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    texts.push({ t, caret: a.subtype === 'Caret' });
  }
  const caretText = texts.find(x => x.caret)?.t;
  c.comment = texts.map(x => x.t).join('\n');
  let parsed = parseComment(caretText ?? c.comment);

  const setNew = (raw, { hypothesis = false, alsoDelete = false } = {}) => {
    c.newDisplay = raw;
    c.alts = [canon(raw)];
    if (alsoDelete) c.alts.push('');
    c.hypothesis = hypothesis;
  };
  const subReplace = (oldRaw, newRaw) => {
    const co = canon(oldRaw);
    const k = co ? marked.indexOf(co) : -1;
    if (k >= 0) { c.s += k; c.e = c.s + co.length; }
    else if (co) {
      const lo = Math.max(0, c.s - 60);
      const j = doc.text.indexOf(co, lo);
      if (j >= 0 && j <= c.e + 60) { c.s = j; c.e = j + co.length; }
    }
    c.kind = 'replace';
    setNew(newRaw);
  };

  if (markups.length && c.s == null) {
    c.note = 'Zur Markierung wurde kein Text gefunden.';
    c.kind = 'manual';
    return c;
  }

  if (strikes.length && carets.length) {
    // Acrobat «Text ersetzen»
    if (parsed?.kind === 'replace' && parsed.old) subReplace(parsed.old, parsed.new);
    else if (parsed?.kind === 'delete') { c.kind = 'delete'; setNew(''); }
    else {
      const t = parsed?.new ?? caretText ?? c.comment;
      if (t) { c.kind = 'replace'; setNew(t); } else { c.kind = 'delete'; setNew(''); }
    }
  } else if (carets.length && !markups.length) {
    if (parsed?.kind === 'instruction' && !parsed.text.includes('?') && !INSTRUCTION.test(parsed.text)) {
      parsed = { kind: 'plain', text: parsed.text }; // langer Einfügetext
    }
    const pos = caretIndex(doc, carets[0].page, carets[0].rect);
    if (pos != null) { c.s = pos; c.e = pos; }
    c.rect = unionRect(carets.map(a => a.rect));
    c.page = carets[0].page;
    if (parsed && (parsed.kind === 'insert' || parsed.kind === 'replace' || parsed.kind === 'plain')) {
      const t = parsed.new ?? parsed.text;
      if (parsed.kind === 'replace' && parsed.old) {
        const occ = nearestOccurrence(doc, canon(parsed.old), c.page, c.rect[0], c.rect[1]);
        if (occ) { c.s = occ.s; c.e = occ.e; }
        c.kind = 'replace';
      } else {
        c.kind = 'insert';
        // ganze Wörter/Sätze werden an Wortgrenzen eingefügt, einzelne Buchstaben evtl. mitten im Wort
        if (c.s != null && (/\s/.test(t.trim()) || canon(t).length >= 4)) {
          c.s = c.e = snapToWordBoundary(doc, c.s, c.page);
        }
      }
      setNew(t);
      if (!canon(t)) { c.kind = 'manual'; c.note = 'Leerzeichen oder Umbruch einfügen – bitte manuell prüfen.'; }
    } else {
      c.kind = 'manual';
      c.note = parsed ? 'Einfügezeichen mit Anweisung – bitte manuell prüfen.' : 'Einfügezeichen ohne Text.';
    }
    if (c.s == null) c.kind = 'manual';
  } else if (strikes.length) {
    if (!parsed || parsed.kind === 'delete') { c.kind = 'delete'; setNew(''); }
    else if (parsed.kind === 'replace' && parsed.old) subReplace(parsed.old, parsed.new);
    else if (parsed.kind === 'replace' || parsed.kind === 'insert') { c.kind = 'replace'; setNew(parsed.new); }
    else if (parsed.kind === 'plain') { c.kind = 'replace'; setNew(parsed.text, { hypothesis: true, alsoDelete: true }); }
    else { c.kind = 'manual'; c.note = 'Durchgestrichen mit Anweisung – bitte manuell prüfen.'; }
  } else if (markups.length) {
    if (!parsed) { c.kind = 'manual'; c.note = 'Markierung ohne Kommentar.'; }
    else if (parsed.kind === 'delete') { c.kind = 'delete'; setNew(''); }
    else if (parsed.kind === 'replace' && parsed.old) subReplace(parsed.old, parsed.new);
    else if (parsed.kind === 'replace') { c.kind = 'replace'; setNew(parsed.new); }
    else if (parsed.kind === 'plain') { c.kind = 'replace'; setNew(parsed.text, { hypothesis: true }); }
    else { c.kind = 'manual'; c.note = 'Anweisung zur Markierung – bitte manuell prüfen.'; }
  } else {
    // Notiz, Textfeld, Formen, Freihand …
    const r = c.rect;
    const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
    if (parsed?.kind === 'replace' && parsed.old) {
      const occ = nearestOccurrence(doc, canon(parsed.old), page, cx, cy);
      if (occ) { c.s = occ.s; c.e = occ.e; c.kind = 'replace'; setNew(parsed.new); }
      else { c.note = `Ausgangstext «${parsed.old}» wurde nicht gefunden.`; c.expectNew = canon(parsed.new); c.newDisplay = parsed.new; }
    } else {
      if (parsed?.kind === 'replace' || parsed?.kind === 'insert') { c.expectNew = canon(parsed.new); c.newDisplay = parsed.new; }
      c.note = c.comment ? 'Kommentar ohne eindeutige Textänderung – bitte manuell prüfen.' : 'Kommentar ohne Text.';
    }
    if (c.kind === 'manual') {
      const inside = ['Square', 'Circle', 'Ink', 'Polygon', 'Highlight'].includes(first.subtype)
        ? charsInRect(doc, page, r) : [];
      if (inside.length) { c.s = Math.min(...inside); c.e = Math.max(...inside) + 1; }
      else {
        const line = nearestLine(doc, page, cx, cy);
        if (line && line.score < 60) { c.s = line.s; c.e = line.e; c.regionIsNearby = true; }
      }
    }
  }
  if (c.alts.length && c.expectNew == null && c.alts[0].length >= 3 && !c.hypothesis) c.expectNew = c.alts[0];
  return c;
}

// ---------------------------------------------------------------------------
// Abgleich mit dem überarbeiteten Dokument

function buildExpected(O, corrs) {
  const located = corrs
    .filter(c => c.s != null && c.kind !== 'manual' && !c.hypothesis)
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const map = new Int32Array(O.length + 1);
  const parts = [];
  let i = 0, len = 0, lastEnd = -1;
  for (const c of located) {
    if (c.s < lastEnd || c.s < i) continue;
    for (let k = i; k < c.s; k++) map[k] = len + (k - i);
    parts.push(O.slice(i, c.s));
    len += c.s - i;
    for (let k = c.s; k < c.e; k++) map[k] = len;
    c._eStart = len;
    parts.push(c.alts[0]);
    len += c.alts[0].length;
    c._eEnd = len;
    i = c.e;
    lastEnd = c.e;
  }
  for (let k = i; k < O.length; k++) map[k] = len + (k - i);
  parts.push(O.slice(i));
  len += O.length - i;
  map[O.length] = len;
  return { E: parts.join(''), map };
}

function contextVariants(c, O, exp) {
  const n = 64;
  const v = [{ b: O.slice(Math.max(0, c.s - n), c.s), a: O.slice(c.e, c.e + n) }];
  const es = c._eStart ?? exp.map[c.s];
  const ee = c._eEnd ?? exp.map[c.e];
  const w = { b: exp.E.slice(Math.max(0, es - n), es), a: exp.E.slice(ee, ee + n) };
  if (w.b !== v[0].b || w.a !== v[0].a) v.push(w);
  return v;
}

function probe(R, variants, oldT, alts) {
  const newAlts = alts.filter(a => a !== oldT);
  for (const L of [32, 20, 12, 7]) {
    for (const v of variants) {
      const b = v.b.slice(-L), a = v.a.slice(0, L);
      if (!b && !a) continue;
      const oIdx = R.indexOf(b + oldT + a);
      let nIdx = -1, nLen = 0;
      for (const alt of newAlts) {
        const k = R.indexOf(b + alt + a);
        if (k >= 0) { nIdx = k + b.length; nLen = alt.length; break; }
      }
      if (nIdx >= 0 && oIdx < 0) return { status: 'done', hit: [nIdx, nIdx + nLen], how: 'context' };
      if (oIdx >= 0 && nIdx < 0) return { status: 'open', hit: [oIdx + b.length, oIdx + b.length + oldT.length], how: 'context' };
      if (oIdx >= 0 && nIdx >= 0) return { status: 'ambiguous', hit: [oIdx + b.length, oIdx + b.length + oldT.length] };
    }
  }
  // nur einseitiger Kontext (die andere Seite wurde z. B. durch eine weitere Korrektur verändert)
  for (const L of [24, 12]) {
    for (const v of variants) {
      const b = v.b.slice(-L), a = v.a.slice(0, L);
      const side = (t) => {
        if (!t) return -1;
        if (b && (b + t).length >= 10) { const k = R.indexOf(b + t); if (k >= 0) return k + b.length; }
        if (a && (t + a).length >= 10) { const k = R.indexOf(t + a); if (k >= 0) return k; }
        return -1;
      };
      const o = side(oldT);
      let n = -1, nLen = 0;
      for (const alt of newAlts) { const k = side(alt); if (k >= 0) { n = k; nLen = alt.length; break; } }
      if (o >= 0 && n < 0) return { status: 'open', hit: [o, o + oldT.length], how: 'partial' };
      if (n >= 0 && o < 0) return { status: 'done', hit: [n, n + nLen], how: 'partial' };
    }
  }
  return null;
}

function locateByContext(R, variants) {
  for (const L of [24, 14, 8]) {
    for (const v of variants) {
      const b = v.b.slice(-L);
      if (b.length >= 6) { const k = R.indexOf(b); if (k >= 0) return [k + b.length, k + b.length]; }
      const a = v.a.slice(0, L);
      if (a.length >= 6) { const k = R.indexOf(a); if (k >= 0) return [k, k]; }
    }
  }
  return null;
}

const short = (s, n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function verify(c, orig, rev, exp) {
  const O = orig.text, R = rev.text;
  const res = { status: 'check', reason: '', hit: null };

  if (c.s == null) {
    res.reason = c.note || 'Position nicht bestimmbar – bitte manuell prüfen.';
    if (c.expectNew && !R.includes(c.expectNew)) {
      res.status = 'open';
      res.reason = `Gewünschter Text «${short(c.newDisplay)}» kommt im neuen PDF nicht vor.`;
    }
    return res;
  }
  const variants = contextVariants(c, O, exp);
  const oldT = O.slice(c.s, c.e);

  if (c.kind === 'manual') {
    const r = probe(R, variants, oldT, []);
    if (r && r.status !== 'done') {
      res.hit = r.hit;
      res.reason = (c.note ? c.note + ' ' : '') + (c.regionIsNearby
        ? 'Text in der Nähe ist unverändert.'
        : 'Markierter Text ist unverändert.');
    } else {
      res.hit = locateByContext(R, variants);
      res.reason = (c.note ? c.note + ' ' : '') + (c.regionIsNearby
        ? 'Text in der Nähe wurde verändert.'
        : 'Markierter Text wurde verändert.');
    }
    if (c.expectNew && !R.includes(c.expectNew)) {
      res.status = 'open';
      res.reason = `Gewünschter Text «${short(c.newDisplay)}» kommt im neuen PDF nicht vor.`;
    }
    return res;
  }

  if (c.alts.every(a => a === oldT)) {
    res.hit = locateByContext(R, variants);
    res.reason = 'Änderung betrifft nur Leerraum oder Typografie – bitte manuell prüfen.';
    return res;
  }

  const r = probe(R, variants, oldT, c.alts);
  if (r?.status === 'done') {
    res.status = 'done';
    res.hit = r.hit;
    res.reason = c.hypothesis
      ? (r.hit[1] === r.hit[0] ? 'Markierter Text wurde entfernt.' : 'Kommentartext steht jetzt an der markierten Stelle.')
      : r.how === 'context' ? 'Korrektur an der Stelle gefunden.' : 'Korrektur gefunden (Umgebung leicht verändert).';
    return res;
  }
  if (r?.status === 'open') {
    res.status = 'open';
    res.hit = r.hit;
    res.reason = c.kind === 'insert'
      ? 'An der Stelle fehlt der einzufügende Text noch.'
      : c.hypothesis ? 'Markierter Text ist unverändert.' : 'Ursprünglicher Text steht noch unverändert da.';
    return res;
  }
  if (r?.status === 'ambiguous') {
    res.hit = r.hit;
    res.reason = 'Die Textstelle kommt mehrfach vor – bitte manuell prüfen.';
    return res;
  }
  const real = c.alts.filter(a => a.length >= 3);
  if (!c.hypothesis && real.length && !real.some(a => R.includes(a))) {
    res.status = 'open';
    res.hit = locateByContext(R, variants);
    res.reason = `Neuer Text «${short(c.newDisplay)}» kommt im neuen PDF nicht vor.`;
    return res;
  }
  res.hit = locateByContext(R, variants);
  res.reason = 'Stelle nicht eindeutig gefunden – die Umgebung wurde stark verändert.';
  return res;
}

// ---------------------------------------------------------------------------
// Fundstelle im neuen PDF als Seite + Rechtecke

export function rectsForRange(doc, s, e) {
  if (!doc.chars.length) return null;
  if (e <= s) {
    // Einfüge-/Löschstelle: schmale Marke direkt hinter dem vorangehenden Zeichen
    const prev = doc.chars[s - 1], next = doc.chars[s];
    if (prev) return { page: prev.p, rects: [[prev.x1 - 1, prev.y0, prev.x1 + 3, prev.y1]] };
    if (next) return { page: next.p, rects: [[next.x0 - 3, next.y0, next.x0 + 1, next.y1]] };
    return null;
  }
  s = Math.max(0, s); e = Math.min(doc.chars.length, e);
  if (e <= s) return null;
  const page = doc.chars[s].p;
  const lines = [];
  for (let i = s; i < e; i++) {
    const ch = doc.chars[i];
    if (ch.p !== page) break;
    const last = lines[lines.length - 1];
    if (last && sameLine(last.ref, ch)) {
      last.r = [Math.min(last.r[0], ch.x0), Math.min(last.r[1], ch.y0), Math.max(last.r[2], ch.x1), Math.max(last.r[3], ch.y1)];
    } else lines.push({ ref: ch, r: [ch.x0, ch.y0, ch.x1, ch.y1] });
  }
  return { page, rects: lines.map(l => l.r) };
}

function fallbackLocation(c, orig, rev) {
  const page = Math.min(c.page, rev.pages.length - 1);
  const po = orig.pages[c.page], pr = rev.pages[page];
  const sx = (pr.view[2] - pr.view[0]) / (po.view[2] - po.view[0]);
  const sy = (pr.view[3] - pr.view[1]) / (po.view[3] - po.view[1]);
  const r = c.rect;
  return {
    page, approx: true,
    rects: [[pr.view[0] + (r[0] - po.view[0]) * sx, pr.view[1] + (r[1] - po.view[1]) * sy,
      pr.view[0] + (r[2] - po.view[0]) * sx, pr.view[1] + (r[3] - po.view[1]) * sy]],
  };
}

// ---------------------------------------------------------------------------
// Öffentliche API

/** Liest die Kommentare des Korrektur-PDFs (unabhängig vom neuen PDF). */
export function extractCorrections(orig) {
  const corrs = groupAnnotations(orig.annotations).map(g => interpret(g, orig));
  corrs.sort((a, b) => a.page - b.page || b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
  corrs.forEach((c, i) => {
    c.n = i + 1;
    if (c.s != null) {
      c.oldDisplay = displayRange(orig, c.s, c.e);
      c.before = contextBefore(orig, c.s);
      c.after = contextAfter(orig, c.e);
    } else { c.oldDisplay = ''; c.before = ''; c.after = ''; }
  });
  return corrs;
}

/** Prüft alle Korrekturen gegen das überarbeitete Dokument. */
export function compare(orig, rev, corrs) {
  const exp = buildExpected(orig.text, corrs);
  return corrs.map(c => {
    const v = verify(c, orig, rev, exp);
    let loc = v.hit ? rectsForRange(rev, v.hit[0], v.hit[1]) : null;
    if (!loc) loc = fallbackLocation(c, orig, rev);
    return { ...c, status: v.status, reason: v.reason, rev: loc };
  });
}

export const KIND_LABEL = { replace: 'Ersetzen', delete: 'Löschen', insert: 'Einfügen', manual: 'Hinweis' };
