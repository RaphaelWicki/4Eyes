// 4 Eyes – Oberfläche
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { openPdf, buildModel } from './pdf-model.js';
import { extractCorrections, compare, KIND_LABEL } from './analyze.js';
import { buildAnnotatedPdf, STATUS_LABEL } from './export.js';
import * as motion from './motion.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  orig: null,        // { name, bytes, pdf, model, corrections, hash }
  rev: null,         // { name, bytes, pdf, model, hash }
  results: [],
  filter: 'all',
  selected: null,    // Nummer der gewählten Korrektur
  store: { overrides: {}, rounds: [] },
};

// ---------------------------------------------------------------------------
// Hilfen

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3200);
}

function busy(text) {
  $('#busy').hidden = text == null;
  if (text != null) $('#busyText').textContent = text;
}

async function hashBytes(bytes) {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 0x811c9dc5;
    const step = Math.max(1, Math.floor(bytes.length / 200000));
    for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return `f${h.toString(16)}-${bytes.length}`;
  }
}

function isPdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF');
}

// Speicherschlüssel bleibt «zweitblick», damit bisherige Runden erhalten bleiben
const storeKey = () => `zweitblick:v1:${state.orig.hash}`;
function loadStore(hash) {
  try {
    const s = JSON.parse(localStorage.getItem(`zweitblick:v1:${hash}`));
    if (s && typeof s === 'object') return { overrides: s.overrides ?? {}, rounds: s.rounds ?? [] };
  } catch { /* leer */ }
  return { overrides: {}, rounds: [] };
}
function saveStore() {
  try { localStorage.setItem(storeKey(), JSON.stringify(state.store)); } catch { /* privat/voll */ }
}

const fmtTime = iso => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `heute ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// ---------------------------------------------------------------------------
// Dateien laden

// onProgress: Fortschritt im Upload-Feld bzw. im Vorhang; ohne Angabe die graue Ladeanzeige
async function readPdf(name, bytes, label, onProgress) {
  if (!isPdf(bytes)) throw new Error(`«${name}» ist keine PDF-Datei.`);
  if (!onProgress) busy(`${label} wird gelesen …`);
  const pdf = await openPdf(pdfjsLib, bytes);
  const model = await buildModel(pdf, p => onProgress ? onProgress(p) : busy(`${label} wird gelesen … ${Math.round(p * 100)} %`));
  return { name, bytes, pdf, model, hash: await hashBytes(bytes) };
}

const uploadVisible = () => !$('#viewUpload').hidden;

async function setOrig(name, bytes) {
  const loader = uploadVisible() ? motion.fieldLoader($('#dropOrig')) : null;
  try {
    const doc = await readPdf(name, bytes, 'Korrektur-PDF', loader?.progress);
    if (!doc.model.text.length) toast('Im Korrektur-PDF wurde kein Text gefunden. Ist es ein Scan?', true);
    doc.corrections = extractCorrections(doc.model);
    state.orig?.pdf?.destroy();
    state.orig = doc;
    state.store = loadStore(doc.hash);
    const n = doc.corrections.length;
    const prev = state.store.rounds.length;
    const fill = () => fillDrop('#dropOrig', name, [
      `${doc.model.pages.length} ${doc.model.pages.length === 1 ? 'Seite' : 'Seiten'} · ${n} ${n === 1 ? 'Korrektur' : 'Korrekturen'} gefunden`,
      prev ? `Bereits ${prev} ${prev === 1 ? 'Runde' : 'Runden'} geprüft – es geht mit Runde ${prev + 1} weiter` : '',
    ], n === 0 ? 'Keine Kommentare gefunden – sind die Korrekturen als PDF-Kommentare angelegt?' : '');
    if (loader) await loader.finish(fill); else fill();
  } catch (e) {
    loader?.fail();
    console.error(e);
    toast(e.message || 'Das PDF konnte nicht gelesen werden.', true);
  } finally {
    busy(null);
    updateCompareButton();
  }
}

async function setRev(name, bytes, onProgress) {
  const loader = !onProgress && uploadVisible() ? motion.fieldLoader($('#dropRev')) : null;
  try {
    const doc = await readPdf(name, bytes, 'Überarbeitetes PDF', onProgress ?? loader?.progress);
    if (!doc.model.text.length) toast('Im überarbeiteten PDF wurde kein Text gefunden. Wurde Text in Pfade umgewandelt?', true);
    state.rev?.pdf?.destroy();
    state.rev = doc;
    const nA = doc.model.annotations.filter(a => a.subtype !== 'Popup' && a.subtype !== 'Link').length;
    const fill = () => fillDrop('#dropRev', name, [`${doc.model.pages.length} ${doc.model.pages.length === 1 ? 'Seite' : 'Seiten'}`],
      nA ? `Enthält ${nA} Kommentare – ist das wirklich die neue Version?` : '');
    if (loader) await loader.finish(fill); else fill();
    return true;
  } catch (e) {
    loader?.fail();
    console.error(e);
    toast(e.message || 'Das PDF konnte nicht gelesen werden.', true);
    return false;
  } finally {
    busy(null);
    updateCompareButton();
  }
}

function fillDrop(sel, name, infos, warn) {
  const d = $(sel);
  d.classList.add('filled');
  const f = $('.drop-file', d);
  f.hidden = false;
  // Dateiname wird von Hand eingekreist (Kreis zeichnet sich bei jedem neuen Füllen neu)
  f.innerHTML = `<span class="drop-name"><svg class="drop-circle" aria-hidden="true"><use href="#hand-circle" /></svg><b title="${esc(name)}">${esc(name)}</b></span>` +
    infos.filter(Boolean).map(i => `<small>${esc(i)}</small>`).join('') +
    (warn ? `<small class="warn">${esc(warn)}</small>` : '');
  $('.drop-cta', d).innerHTML = 'Andere Datei <u>wählen</u>';
  if (state.orig && state.rev && uploadVisible()) motion.spinPlus();
}

function updateCompareButton() {
  $('#btnCompare').disabled = !(state.orig && state.rev);
}

function setupDrop(el) {
  const input = $('input', el);
  const role = el.dataset.role;
  const take = async file => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (role === 'orig') await setOrig(file.name, bytes);
    else await setRev(file.name, bytes);
  };
  input.addEventListener('change', () => { take(input.files[0]); input.value = ''; });
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('over');
    take(e.dataTransfer.files[0]);
  });
}

// ---------------------------------------------------------------------------
// Vergleichen & Runden

function runCompare() {
  const { orig, rev } = state;
  const auto = compare(orig.model, rev.model, orig.corrections);
  const rounds = state.store.rounds;
  const last = rounds[rounds.length - 1];
  const sameFile = last && last.revHash === rev.hash;
  const prevStatuses = (sameFile ? rounds[rounds.length - 2] : last)?.statuses ?? {};

  state.results = auto.map(r => {
    const o = state.store.overrides[r.id];
    const res = { ...r, autoStatus: r.status, manual: false };
    if (o && o !== r.status) { res.status = o; res.manual = true; }
    res.newlyDone = res.status === 'done' && prevStatuses[r.id] != null && prevStatuses[r.id] !== 'done';
    return res;
  });

  const entry = { revName: rev.name, revHash: rev.hash, date: new Date().toISOString() };
  if (sameFile) rounds[rounds.length - 1] = { ...last, ...entry };
  else rounds.push(entry);
  recordRound();

  // Start: die oberste Karte der Liste ist gewählt (und damit scharf)
  const first = visibleResults()[0] ?? state.results[0];
  state.selected = first?.n ?? null;
  reveal.reset();
  showReview();
}

function recordRound() {
  const last = state.store.rounds[state.store.rounds.length - 1];
  if (!last) return;
  last.counts = counts();
  last.statuses = Object.fromEntries(state.results.map(r => [r.id, r.status]));
  saveStore();
}

function counts() {
  const c = { open: 0, check: 0, done: 0 };
  for (const r of state.results) c[r.status]++;
  return c;
}

function setStatus(n, status) {
  const r = state.results.find(x => x.n === n);
  if (!r) return;
  if (status == null || status === r.autoStatus) {
    delete state.store.overrides[r.id];
    r.status = r.autoStatus;
    r.manual = false;
  } else {
    state.store.overrides[r.id] = status;
    r.status = status;
    r.manual = true;
  }
  recordRound();
  renderSidebar();
  renderPanes(false);
}

// ---------------------------------------------------------------------------
// Ansichten

function showUpload() {
  document.body.dataset.view = 'upload';
  $('#viewUpload').hidden = false;
  $('#viewReview').hidden = true;
  $('#reviewActions').hidden = true;
}

function showReview() {
  document.body.dataset.view = 'review';
  $('#viewUpload').hidden = true;
  $('#viewReview').hidden = false;
  $('#reviewActions').hidden = false;
  const sel = state.results.find(r => r.n === state.selected);
  panes.orig.page = sel ? sel.page : 0;
  panes.rev.page = sel ? sel.rev.page : 0;
  renderSidebar();
  state.panesReady = new Promise(res => requestAnimationFrame(() => res(renderPanes(true))));
}

// wartet, bis beide PDF-Seiten gezeichnet sind (höchstens 1.5 s), damit der Vorhang nicht ins Leere aufgeht
const panesReady = () => Promise.race([state.panesReady, motion.wait(1500)]);

const ICON_CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>';

function changeHtml(r) {
  const del = t => `<del>${esc(t)}</del>`;
  const ins = t => `<ins>${esc(t)}</ins>`;
  if (r.kind === 'replace') return `<div class="change">${del(r.oldDisplay)}<span class="arrow">→</span>${ins(r.newDisplay)}</div>`;
  if (r.kind === 'delete') return `<div class="change">${del(r.oldDisplay)}</div>`;
  if (r.kind === 'insert') {
    const b = r.before.trim().split(/\s+/).slice(-3).join(' ');
    const a = r.after.trim().split(/\s+/).slice(0, 3).join(' ');
    return `<div class="change"><span class="ctx">…${esc(b)} </span>${ins(r.newDisplay)}<span class="ctx"> ${esc(a)}…</span></div>`;
  }
  const text = r.comment || (r.oldDisplay ? `«${r.oldDisplay}»` : 'Kommentar ohne Text');
  return `<div class="change quote">${esc(text)}</div>`;
}

function renderSidebar() {
  const c = counts();
  const total = state.results.length;
  const allDone = total > 0 && c.done === total;
  $('#summary').innerHTML = `
    <div class="summary-top">
      <span class="summary-title">${total ? `${c.done} von ${total} erledigt` : 'Keine Korrekturen gefunden'}</span>
      <span class="summary-count">${total ? Math.round((c.done / total) * 100) + ' %' : ''}</span>
    </div>
    <div class="bar">
      <span class="done" style="flex-grow:${c.done}"></span>
      <span class="check" style="flex-grow:${c.check}"></span>
      <span class="open" style="flex-grow:${c.open}"></span>
    </div>
    <div class="legend">
      <span><span class="dot open"></span><b>${c.open}</b> offen</span>
      <span><span class="dot check"></span><b>${c.check}</b> prüfen</span>
      <span><span class="dot done"></span><b>${c.done}</b> erledigt</span>
    </div>
    ${allDone ? `<div class="allgood">${ICON_CHECK}Alle Korrekturen sind umgesetzt.</div>` : ''}`;

  const tabs = [['all', 'Alle', total], ['open', 'Offen', c.open], ['check', 'Prüfen', c.check], ['done', 'Erledigt', c.done]];
  $('#filters').innerHTML = tabs.map(([k, l, n]) =>
    `<button data-filter="${k}" class="${state.filter === k ? 'on' : ''}">${l}<span class="n">${n}</span></button>`).join('');

  const list = visibleResults();
  $('#items').innerHTML = list.length ? list.map(r => {
    const sel = r.n === state.selected;
    const showComment = r.kind !== 'manual' && r.comment && r.comment !== r.newDisplay;
    return `<li class="item ${r.status}${sel ? ' sel' : ''}${reveal.isSeen(r.n) ? ' in' : ''}" data-n="${r.n}">
      <div class="item-head">
        <span class="num">${r.n}</span>
        <span class="kind">${KIND_LABEL[r.kind]}</span>
        <span>S. ${r.page + 1}${r.rev.page !== r.page ? ` → ${r.rev.page + 1}` : ''}</span>
        ${r.manual ? '<span class="tag">manuell</span>' : ''}
        ${r.newlyDone ? '<span class="tag new">neu erledigt</span>' : ''}
        <span class="badge">${STATUS_LABEL[r.status]}</span>
      </div>
      ${changeHtml(r)}
      ${showComment ? `<p class="comment">${esc(r.comment)}${r.author ? ` <span class="who">– ${esc(r.author)}</span>` : ''}</p>` : ''}
      ${r.replies.map(x => `<p class="comment">↳ ${esc(x.text)}${x.author ? ` <span class="who">– ${esc(x.author)}</span>` : ''}</p>`).join('')}
      <p class="reason">${esc(r.reason)}</p>
      ${sel ? `<div class="item-actions">
        ${r.status !== 'done' ? `<button class="btn" data-set="done">${ICON_CHECK}Erledigt <span class="kbd">E</span></button>` : ''}
        ${r.status !== 'open' ? `<button class="btn" data-set="open">Offen <span class="kbd">O</span></button>` : ''}
        ${r.manual ? `<button class="btn btn-ghost" data-set="auto">Automatisch</button>` : ''}
      </div>` : ''}
    </li>`;
  }).join('') : `<li class="empty">${state.filter === 'all' ? 'Im Korrektur-PDF wurden keine Kommentare gefunden.' : 'Keine Einträge in diesem Filter.'}</li>`;

  const rounds = state.store.rounds;
  $('#roundList').innerHTML = rounds.map((r, i) => `<li>
      <b>Runde ${i + 1}</b><span class="rfile" title="${esc(r.revName)}">${esc(r.revName)} · ${fmtTime(r.date)}</span>
      <span>${r.counts ? `${r.counts.open} offen` : ''}</span></li>`).reverse().join('');
  $('#rounds').hidden = rounds.length < 2;

  reveal.observe($$('#items .item'));
  stack.layout();
  const selLi = $('#items .item.sel');
  if (selLi) stack.reveal(selLi);
}

function visibleResults() {
  return state.filter === 'all' ? state.results : state.results.filter(r => r.status === state.filter);
}

function select(n, scroll = true) {
  const r = state.results.find(x => x.n === n);
  if (!r) return;
  state.selected = n;
  panes.orig.page = r.page;
  panes.rev.page = r.rev.page;
  renderSidebar();
  renderPanes(scroll);
}

// ---------------------------------------------------------------------------
// Seitenansicht

const panes = {
  orig: { el: $('#paneOrig'), page: 0, token: 0, task: null },
  rev: { el: $('#paneRev'), page: 0, token: 0, task: null },
};

function renderPanes(scroll) {
  return Promise.all([renderPane('orig', scroll), renderPane('rev', scroll)]);
}

async function renderPane(key, scroll) {
  const P = panes[key];
  const doc = key === 'orig' ? state.orig : state.rev;
  if (!doc) return;
  const n = doc.model.pages.length;
  P.page = Math.max(0, Math.min(P.page, n - 1));
  $('.pager-label', P.el).textContent = `Seite ${P.page + 1} / ${n}`;
  const [prevBtn, nextBtn] = $$('.pager .icon-btn', P.el);
  prevBtn.disabled = P.page === 0;
  nextBtn.disabled = P.page === n - 1;

  const token = ++P.token;
  const page = await doc.pdf.getPage(P.page + 1);
  if (token !== P.token) return;
  const body = $('.pane-body', P.el);
  const sheet = $('.sheet', P.el);
  const base = page.getViewport({ scale: 1 });
  const availW = Math.max(200, body.clientWidth - 48);
  const availH = Math.max(200, body.clientHeight - 48);
  const scale = availW / base.width;
  const vp = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;

  const sameRender = P.lastKey === `${P.page}|${scale}|${dpr}` && sheet.querySelector('canvas');
  if (!sameRender) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    P.task?.cancel();
    P.task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    });
    try { await P.task.promise; } catch (e) {
      if (e?.name === 'RenderingCancelledException') return;
      throw e;
    }
    if (token !== P.token) return;
    // Blättern: alte Seite gleitet raus, neue kommt aus der Blätterrichtung
    const dir = P.shown != null && sheet.querySelector('canvas') ? Math.sign(P.page - P.shown) : 0;
    if (dir) {
      P.outAnim = await motion.sheetOut(sheet, dir);
      if (token !== P.token) return;
    }
    P.swapDir = dir;
    sheet.style.width = `${Math.floor(vp.width)}px`;
    sheet.style.height = `${Math.floor(vp.height)}px`;
    sheet.replaceChildren(canvas);
    P.lastKey = `${P.page}|${scale}|${dpr}`;
    P.shown = P.page;
  }

  // Markierungen
  sheet.querySelector('.overlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const marks = [];
  for (const r of state.results) {
    if (key === 'orig' && r.page === P.page) marks.push({ r, rects: [r.rect], cls: r.n === state.selected ? r.status : 'cust' });
    if (key === 'rev' && r.rev.page === P.page) marks.push({ r, rects: r.rev.rects, cls: r.status + (r.rev.approx ? ' approx' : '') });
  }
  let selEl = null;
  for (const m of marks) {
    m.rects.forEach((rect, i) => {
      const [x0, y0, x1, y1] = vp.convertToViewportRectangle(rect);
      const left = Math.min(x0, x1) - 2, top = Math.min(y0, y1) - 2;
      const el = document.createElement('div');
      el.className = `mark ${m.cls}${m.r.n === state.selected ? ' sel' : ''}`;
      el.style.cssText = `left:${left}px;top:${top}px;width:${Math.abs(x1 - x0) + 4}px;height:${Math.max(Math.abs(y1 - y0) + 4, 8)}px`;
      el.dataset.n = m.r.n;
      el.title = `#${m.r.n} ${STATUS_LABEL[m.r.status]} – ${m.r.reason}`;
      if (i === 0) {
        const num = document.createElement('span');
        num.className = 'mark-num';
        num.textContent = m.r.n;
        el.append(num);
        if (m.r.n === state.selected) selEl = el;
      }
      ov.append(el);
    });
  }
  sheet.append(ov);
  if (P.swapDir) { motion.sheetIn(sheet, P.swapDir, P.outAnim); P.swapDir = 0; P.outAnim = null; }

  if (scroll && selEl) {
    const top = selEl.offsetTop + sheet.offsetTop - body.clientHeight / 2 + selEl.offsetHeight / 2;
    const left = selEl.offsetLeft + sheet.offsetLeft - body.clientWidth / 2 + selEl.offsetWidth / 2;
    body.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' });
  }
}

// ---------------------------------------------------------------------------
// Export

async function exportPdf(opts, loader) {
  if (!loader) busy('Kommentiertes PDF wird erstellt …');
  try {
    const bytes = await buildAnnotatedPdf(state.rev.bytes.slice(0), state.results, {
      origName: state.orig.name,
      revName: state.rev.name,
      round: state.store.rounds.length,
      date: new Date().toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' }),
    }, opts);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.rev.name.replace(/\.pdf$/i, '')}_geprueft_R${state.store.rounds.length}.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (!loader) toast('PDF mit Kommentaren wurde heruntergeladen.');
    return true;
  } catch (e) {
    console.error(e);
    toast('Das PDF konnte nicht erstellt werden: ' + (e.message || e), true);
    return false;
  } finally {
    if (!loader) busy(null);
  }
}

// ---------------------------------------------------------------------------
// Neue Version (Schritt 3: so lange, bis nichts mehr fehlt)

async function takeNewVersion(file) {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let ok = false;
  await motion.pageTransition('Neue Version wird gelesen', async () => {
    ok = await setRev(file.name, bytes, motion.curtainProgress);
    if (!ok) return;
    motion.curtainProgress(null);
    motion.curtainText('Korrekturen werden geprüft');
    await motion.wait(250);
    runCompare();
    await panesReady();
  }, d => { if (ok) motion.enterReview(d); });
  if (!ok) return;
  const c = counts();
  toast(c.open + c.check === 0 ? 'Alles umgesetzt – nichts mehr offen.' : `Runde ${state.store.rounds.length}: ${c.open} offen, ${c.check} zu prüfen.`);
}

// ---------------------------------------------------------------------------
// Ereignisse

setupDrop($('#dropOrig'));
setupDrop($('#dropRev'));

$('#btnCompare').addEventListener('click', async () => {
  let ok = false;
  await motion.pageTransition('Korrekturen werden geprüft', async () => {
    await motion.wait(150);
    try { runCompare(); ok = true; await panesReady(); }
    catch (e) { console.error(e); toast('Beim Vergleich ist ein Fehler aufgetreten: ' + e.message, true); }
  }, d => { if (ok) motion.enterReview(d); });
});

$('#btnDemo').addEventListener('click', async () => {
  try {
    const get = async f => new Uint8Array(await (await fetch(`beispiel/${f}`)).arrayBuffer());
    await setOrig('kunde-korrekturen.pdf', await get('kunde-korrekturen.pdf'));
    await setRev('neu-v1.pdf', await get('neu-v1.pdf'));
    if (state.orig && state.rev) $('#btnCompare').click();
  } catch (e) {
    toast('Beispiel-PDFs konnten nicht geladen werden.', true);
  }
});

$('#brandLink').addEventListener('click', e => {
  e.preventDefault();
  if (state.results.length) motion.pageTransition('', showUpload, motion.enterUpload);
});
// Neu beginnen: Dateien weg und gespeicherter Verlauf (Runden, manuelle Entscheide) gelöscht
function clearHistory() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('zweitblick:v1:')) localStorage.removeItem(k);
  } catch { /* privat */ }
  state.store = { overrides: {}, rounds: [] };
}

$('#btnRestart').addEventListener('click', () => motion.pageTransition('', restart, motion.enterUpload));
function restart() {
  clearHistory();
  state.orig?.pdf?.destroy();
  state.rev?.pdf?.destroy();
  state.orig = state.rev = null;
  state.results = [];
  for (const sel of ['#dropOrig', '#dropRev']) {
    const d = $(sel);
    d.classList.remove('filled');
    $('.drop-file', d).hidden = true;
    $('.drop-cta', d).innerHTML = 'PDF hierher ziehen oder <u>auswählen</u>';
  }
  for (const P of Object.values(panes)) { $('.sheet', P.el).replaceChildren(); P.lastKey = null; }
  for (const P of Object.values(panes)) P.shown = null;
  updateCompareButton();
  showUpload();
}

$('#btnNewVersion').addEventListener('click', () => $('#newVersionInput').click());
$('#newVersionInput').addEventListener('change', e => { takeNewVersion(e.target.files[0]); e.target.value = ''; });

// Download-Fenster: fährt wie der Vorhang von unten auf; beim Herunterladen füllt es sich blau
const exportDialog = $('#exportDialog');
$('#btnExport').addEventListener('click', () => motion.openDialog(exportDialog));
exportDialog.addEventListener('cancel', e => { e.preventDefault(); motion.closeDialog(exportDialog); });
exportDialog.addEventListener('click', e => { if (e.target === exportDialog) motion.closeDialog(exportDialog); });   // Klick daneben
$('form', exportDialog).addEventListener('submit', async e => {
  e.preventDefault();
  if (e.submitter?.value !== 'ok') return motion.closeDialog(exportDialog);
  if (exportDialog.dataset.busy) return;
  exportDialog.dataset.busy = '1';
  const f = e.target.elements;
  const loader = motion.dialogLoader(exportDialog);
  const ok = await exportPdf({ include: { open: f.open.checked, check: f.check.checked, done: f.done.checked }, report: f.report.checked }, loader);
  await (ok ? loader.finish() : loader.fail());
  delete exportDialog.dataset.busy;
  if (ok) motion.closeDialog(exportDialog);
});

$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  state.filter = b.dataset.filter;
  renderSidebar();
});

$('#items').addEventListener('click', e => {
  const act = e.target.closest('[data-set]');
  if (act) {
    const v = act.dataset.set;
    setStatus(state.selected, v === 'auto' ? null : v);
    return;
  }
  const li = e.target.closest('.item');
  if (li) select(Number(li.dataset.n));
});

for (const key of ['orig', 'rev']) {
  const P = panes[key];
  P.el.addEventListener('click', e => {
    const step = e.target.closest('[data-step]');
    if (step) { P.page += Number(step.dataset.step); renderPane(key, false); return; }
    const m = e.target.closest('.mark');
    if (m) select(Number(m.dataset.n));
  });
}


let resizeT;
new ResizeObserver(() => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (!$('#viewReview').hidden) renderPanes(false); }, 120);
}).observe($('.compare'));

document.addEventListener('keydown', e => {
  if ($('#viewReview').hidden || $('#exportDialog').open) return;
  if ((e.target instanceof Element && e.target.closest('input, textarea, select')) || e.metaKey || e.ctrlKey || e.altKey) return;
  const list = visibleResults();
  const i = list.findIndex(r => r.n === state.selected);
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); const r = list[Math.min(list.length - 1, i + 1)]; if (r) select(r.n); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); const r = list[Math.max(0, i - 1)]; if (r) select(r.n); }
  else if (e.key === 'e' && state.selected != null) setStatus(state.selected, 'done');
  else if (e.key === 'o' && state.selected != null) setStatus(state.selected, 'open');
});

// Neue Version per Drag & Drop direkt in der Prüfansicht
let dragDepth = 0;
const veil = $('#dropveil');
document.addEventListener('dragenter', e => {
  if ($('#viewReview').hidden || !e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  veil.hidden = false;
});
document.addEventListener('dragleave', () => {
  if ($('#viewReview').hidden) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) veil.hidden = true;
});
document.addEventListener('dragover', e => { if (!$('#viewReview').hidden) e.preventDefault(); });
document.addEventListener('drop', e => {
  if ($('#viewReview').hidden) return;
  e.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  takeNewVersion(e.dataTransfer.files[0]);
});

// Upload-Ansicht: PDFs, die neben den Feldern landen, nicht im Browser öffnen
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { if (!e.target.closest?.('.drop')) e.preventDefault(); });

// Bewegung: weiches Scrollen, Einflug der Startseite
const reveal = motion.revealer($('#items'));
const stack = motion.cardStack($('#items'));
motion.smoothScroll($('#items'));
$$('.pane-body').forEach(el => motion.smoothScroll(el));
motion.enterUpload(250);

// index.html#demo lädt direkt das Beispiel
if (location.hash === '#demo') $('#btnDemo').click();

// Für automatisierte Tests
window.__fourEyes = { state, setOrig, setRev, runCompare, exportPdf, select };
