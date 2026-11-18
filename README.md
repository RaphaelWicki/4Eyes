# 4 Eyes

Prüft nach dem Vier-Augen-Prinzip, ob alle Korrekturen der Kund*innen aus einem kommentierten PDF in der überarbeiteten Version umgesetzt wurden.

## Starten

- **Lokal (Mac):** Doppelklick auf `4 Eyes starten.command`. Der Browser öffnet sich auf `http://localhost:8420`.
  Beim ersten Mal ggf. Rechtsklick → Öffnen, weil macOS das Skript sonst blockiert.
- **Online:** Den ganzen Ordner auf ein beliebiges statisches Hosting legen (Netlify, GitHub Pages, eigener Webspace). Es gibt keinen Server-Code.
- Ein Doppelklick auf `index.html` reicht **nicht**: Browser blockieren ES-Module bei `file://`.

Alles läuft im Browser. Die PDFs verlassen den Rechner nie.

## Ablauf

1. Korrektur-PDF der Kund*in und die überarbeitete Version hochladen → **Korrekturen prüfen**.
2. Links die Liste (Offen / Prüfen / Erledigt), rechts Kund*in und neue Version nebeneinander.
   Tastatur: ↑/↓ blättern, **E** = erledigt, **O** = offen.
3. **Kommentiertes PDF** lädt die neue Version mit allen offenen Punkten als PDF-Kommentare herunter, optional mit Prüfbericht als letzte Seite.
4. Nachbessern, neu exportieren, **Neue Version prüfen** (oder das PDF einfach ins Fenster ziehen) → nächste Runde.
   Manuell abgehakte Punkte und der Verlauf bleiben pro Korrektur-PDF im Browser gespeichert.

## Was erkannt wird

| Kommentar im PDF der Kund*in | Erwartung |
|---|---|
| Text ersetzen (Durchstreichen + Einfügezeichen) | markierter Text → neuer Text |
| Durchgestrichen ohne Kommentar | Text löschen |
| Einfügezeichen mit Text | Text an dieser Stelle einfügen |
| Markierung mit `alt → neu`, `neu statt alt`, `alt durch neu ersetzen`, `ersetzen durch: neu` | Ersetzung |
| Markierung mit `löschen` / `streichen` | Löschen |
| Markierung mit kurzem Text (z. B. `CHF 49.–`) | wird als neuer Text vermutet |
| Notizen, Formen, Freihand, Layout-Anweisungen («Bild grösser») | **Prüfen**: manuell abhaken |

Status: **Offen** = alter Text steht noch da bzw. neuer Text fehlt · **Prüfen** = nicht automatisch entscheidbar · **Erledigt** = neue Fassung an der Stelle gefunden.

Der Vergleich ignoriert Leerraum, Zeilenumbrüche, Silbentrennung und typografische Varianten (– vs. -, „“ vs. ""). Er funktioniert also auch, wenn der Text neu umbricht oder auf eine andere Seite rutscht. Reine Leerzeichen- oder Typografie-Korrekturen landen deshalb unter «Prüfen».

## Grenzen

- Die Korrekturen müssen als PDF-Kommentare vorliegen, nicht als eingescannte Handschrift.
- Im neuen PDF muss echter Text stehen (nicht in Pfade umgewandelt).

## Dateien

- `js/analyze.js`: Kommentare deuten und abgleichen (reine Logik)
- `js/pdf-model.js`: Text mit Zeichenpositionen und Kommentare lesen (pdf.js)
- `js/export.js`: kommentiertes PDF und Prüfbericht schreiben (pdf-lib)
- `js/app.js`, `index.html`, `css/app.css`: Oberfläche
- `js/logo.js`: lebendiges Logo (Aufbau, Umherschauen, Comic-Blinzeln)
- `js/motion.js`: Bewegung (Vorhang beim Seitenwechsel, Füllung beim Hochladen, Blättern, weiches Scrollen, Einflüge)
- `fonts/`: IMG Basis Regular (© Raphael Wicki), wird überall verwendet; IMG Writing Bold und Werk Neue Mono liegen noch dort, sind aber zurzeit nicht eingebunden
- `img/`: Original-Logo (SVG und PNG) und Handschrift-Elemente (Kreis, Kritzel); die Pfade stecken auch direkt in index.html
- `_backup-zweitblick-design/`: frühere Designs zum Zurückwechseln (oberste Ebene: Zweitblick, `v2-gelb/`: 4 Eyes gelb, `v3-dunkel/`: 4 Eyes dunkel)
- `vendor/`: pdf.js 4.10.38, pdf-lib 1.17.1 (lokal, kein CDN nötig)
- `beispiel/`: PDF der Kund*in mit 9 Korrekturen, `neu-v1.pdf` (2 vergessen), `neu-v2.pdf` (alles drin)
