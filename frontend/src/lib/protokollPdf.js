// Protokoll der Pendenzenliste als PDF -- modern gegliedert (Projekt-Karten, Status-Pillen) und
// mit ausfuellbaren Feldern: Bemerkung des Mandanten pro offener Aufgabe, allgemeine Bemerkungen,
// Name und Ort/Datum fuer die Unterschrift. Der Mandant kann das PDF elektronisch (z.B. im
// Acrobat Reader oder im Browser) ausfuellen, speichern und zuruecksenden -- oder es ausdrucken.
//
// jspdf wird hereingereicht ({ jsPDF, AcroFormTextField }), damit die Funktion im Browser
// (dynamisch geladen) und in den Tests (Node) gleich laeuft.

import { datumCH, stundenCH, dateiname } from './pendenzenliste.js';

const MM = { breite: 210, hoehe: 297, rand: 16, unten: 18 };
const FARBE = {
  navy: [31, 58, 95], text: [27, 31, 36], grau: [96, 106, 120], hell: [150, 158, 170], linie: [221, 226, 232],
  projekt: [232, 238, 247], eingabe: [255, 251, 230], eingabeRand: [232, 214, 140],
};
const PILLE = {
  Offen: { fl: [233, 237, 242], tx: [71, 85, 105] },
  'In Arbeit': { fl: [214, 228, 255], tx: [29, 78, 216] },
  Warten: { fl: [255, 231, 194], tx: [154, 91, 0] },
  Erledigt: { fl: [217, 242, 221], tx: [22, 101, 52] },
};
const pilleVon = (status) => PILLE[status] ?? (String(status).startsWith('Warten') ? PILLE.Warten : PILLE.Offen);

// Standardschrift (Helvetica, WinAnsi): Zeichen ausserhalb davon ersetzen, sonst erscheinen
// sie im PDF als Zeichensalat.
function sauber(text) {
  return String(text ?? '')
    .replace(/[→⇒]/g, '->').replace(/[✓✔]/g, 'ok').replace(/ /g, ' ')
    .replace(/[^\n -ÿ–—‘’‚“”„•…€]/g, '');
}

function protokollPdf(jspdf, { mandant, liste, heute, firma = {}, bearbeiter = '', logo = null }) {
  const { jsPDF, AcroFormTextField } = jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const innen = MM.breite - 2 * MM.rand;
  const links = MM.rand;
  const rechts = MM.breite - MM.rand;
  const grenze = MM.hoehe - MM.unten;
  let y = MM.rand;
  let felder = 0;

  const farbe = (rgb) => doc.setTextColor(...rgb);
  const schrift = (groesse, stil = 'normal') => { doc.setFont('helvetica', stil); doc.setFontSize(groesse); };
  const zeilenHoehe = (groesse) => groesse * 0.3528 * 1.25;
  const umbrechen = (text, breite) => doc.splitTextToSize(sauber(text), breite);

  function neueSeite(fortsetzung) {
    doc.addPage();
    y = MM.rand;
    if (fortsetzung) {
      schrift(9, 'italic'); farbe(FARBE.hell);
      doc.text(sauber(`Fortsetzung: ${fortsetzung}`), links, y + 3);
      y += 7;
    }
  }
  function platz(hoehe, fortsetzung) {
    if (y + hoehe > grenze) neueSeite(fortsetzung);
  }

  function pille(text, xRechts, yMitte) {
    schrift(9, 'bold');
    const t = sauber(text);
    const b = doc.getTextWidth(t) + 5;
    const { fl, tx } = pilleVon(text);
    doc.setFillColor(...fl);
    doc.roundedRect(xRechts - b, yMitte - 2.7, b, 5.4, 2.7, 2.7, 'F');
    farbe(tx);
    doc.text(t, xRechts - b / 2, yMitte + 1, { align: 'center' });
    return b;
  }

  function textFeld(name, x, yOben, breite, hoehe, { mehrzeilig = true, wert = '' } = {}) {
    doc.setFillColor(...FARBE.eingabe);
    doc.setDrawColor(...FARBE.eingabeRand);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, yOben, breite, hoehe, 1.2, 1.2, 'FD');
    const f = new AcroFormTextField();
    f.fieldName = name;
    f.Rect = [x + 0.6, yOben + 0.4, breite - 1.2, hoehe - 0.8];
    f.multiline = mehrzeilig;
    f.fontSize = 9;
    f.value = wert;
    doc.addField(f);
    felder += 1;
  }

  // ---- Kopf
  if (logo?.daten) {
    const h = 13;
    const b = logo.breite && logo.hoehe ? (h * logo.breite) / logo.hoehe : 40;
    doc.addImage(logo.daten, 'PNG', rechts - b, y - 2, b, h);
  }
  schrift(9); farbe(FARBE.grau);
  const absender = [firma.firma, firma.strasse, firma.plzOrt].filter(Boolean).join('  ·  ');
  if (absender) doc.text(sauber(absender), rechts, y + 15, { align: 'right' });
  schrift(22, 'bold'); farbe(FARBE.navy);
  doc.text('Pendenzenliste', links, y + 7);
  schrift(12, 'bold'); farbe(FARBE.text);
  doc.text(sauber(mandant.name), links, y + 14);
  schrift(9); farbe(FARBE.grau);
  doc.text(sauber(`Protokoll · Stand ${datumCH(heute)}${bearbeiter ? ` · bearbeitet von ${bearbeiter}` : ''}`), links, y + 19.5);
  y += 25;
  doc.setDrawColor(...FARBE.navy); doc.setLineWidth(0.6);
  doc.line(links, y, rechts, y);
  y += 6;

  // ---- Kennzahlen
  const erledigt = liste.projekte.reduce((n, p) => n + (p.schritte.length ? p.schritte.filter((s) => s.erledigt).length : Number(p.erledigt)), 0);
  const kacheln = [
    ['Offen', String(liste.anzahlOffen)],
    ['Erledigt (90 Tage)', String(erledigt)],
    ['Zeitaufwand', stundenCH(liste.summen.minuten) || '0:00 h'],
    ['davon Extra', stundenCH(liste.summen.extra) || '0:00 h'],
  ];
  const kb = (innen - 3 * 4) / 4;
  kacheln.forEach(([titel, wert], i) => {
    const x = links + i * (kb + 4);
    doc.setFillColor(243, 245, 248);
    doc.roundedRect(x, y, kb, 14, 2, 2, 'F');
    schrift(9); farbe(FARBE.grau);
    doc.text(titel, x + 4, y + 5);
    schrift(13, 'bold'); farbe(FARBE.navy);
    doc.text(wert, x + 4, y + 11.5);
  });
  y += 21;

  schrift(9, 'italic'); farbe(FARBE.grau);
  doc.text(umbrechen('Gelbe Felder können direkt im PDF ausgefüllt werden (z.B. im Adobe Acrobat Reader). Bitte das ausgefüllte PDF speichern und zurücksenden – oder ausdrucken und von Hand ergänzen.', innen), links, y);
  y += 10;

  if (!liste.projekte.length) {
    schrift(10, 'italic'); farbe(FARBE.grau);
    doc.text('Keine offenen oder kürzlich erledigten Pendenzen.', links, y);
    y += 10;
  }

  // ---- Taetigkeiten (erledigte Arbeiten) einer Aufgabe
  function taetigkeiten(liste2, einzug, fortsetzung) {
    for (const t of liste2) {
      schrift(9);
      const zeilen = umbrechen(t.text || '–', innen - einzug - 48);
      const h = zeilen.length * zeilenHoehe(9) + 1;
      platz(h, fortsetzung);
      farbe(FARBE.grau);
      doc.text(datumCH(t.datum), links + einzug, y + 3);
      farbe(FARBE.text);
      doc.text(zeilen, links + einzug + 20, y + 3);
      farbe(FARBE.grau);
      doc.text(sauber([stundenCH(t.minuten), t.art].filter(Boolean).join('  ·  ')), rechts, y + 3, { align: 'right' });
      y += h;
    }
  }

  // ---- Eine Aufgabe (Teilaufgabe oder Einzelpendenz): Titel, Status, Daten, Arbeiten, Bemerkungsfeld
  function aufgabe(a, { einzug, fortsetzung, fett = false, groesse = 10 }) {
    schrift(groesse, fett ? 'bold' : 'normal');
    const titelZeilen = umbrechen(a.titel, innen - einzug - 38);
    const info = [a.erledigt ? (a.datum ? `erledigt am ${datumCH(a.datum)}` : 'erledigt') : (a.datum ? `bearbeiten am ${datumCH(a.datum)}` : null),
      !a.erledigt && a.frist ? `Frist ${datumCH(a.frist)}` : null, a.verantwortlich ? `verantwortlich ${a.verantwortlich}` : null,
      a.minuten ? `Zeit ${stundenCH(a.minuten)}` : null].filter(Boolean).join('  ·  ');
    const kopfHoehe = titelZeilen.length * zeilenHoehe(groesse) + (info ? 4.8 : 0) + 2;
    platz(kopfHoehe + (a.erledigt ? 0 : 15), fortsetzung);
    schrift(groesse, fett ? 'bold' : 'normal'); farbe(a.erledigt ? FARBE.grau : (fett ? FARBE.navy : FARBE.text));
    doc.text(titelZeilen, links + einzug, y + 4);
    pille(a.status, rechts, y + 2.8);
    y += titelZeilen.length * zeilenHoehe(groesse) + 1;
    if (info) {
      schrift(9); farbe(FARBE.hell);
      doc.text(sauber(info), links + einzug, y + 3);
      y += 4.8;
    }
    y += 1;
    if (a.taetigkeiten.length) {
      taetigkeiten(a.taetigkeiten, einzug + 2, fortsetzung);
      y += 1;
    }
    if (!a.erledigt) {
      platz(14, fortsetzung);
      schrift(9); farbe(FARBE.grau);
      doc.text('Bemerkung Mandant', links + einzug, y + 3);
      textFeld(`bemerkung_${a.id}`, links + einzug, y + 4.2, innen - einzug, 9);
      y += 15;
    }
  }

  // ---- Projekte
  for (const p of liste.projekte) {
    schrift(11, 'bold');
    const titelZeilen = umbrechen(p.titel, innen - 76);
    const kopf = titelZeilen.length * zeilenHoehe(11) + 6;
    platz(kopf + 20);
    if (p.schritte.length) {
      doc.setFillColor(...FARBE.projekt);
      doc.roundedRect(links, y, innen, kopf, 2, 2, 'F');
      schrift(11, 'bold'); farbe(FARBE.navy);
      doc.text(titelZeilen, links + 4, y + 5.6);
      const b = pille(p.status, rechts - 3, y + 4.6);
      schrift(9); farbe(FARBE.grau);
      const zusatz = [p.frist && !p.erledigt ? `Frist ${datumCH(p.frist)}` : '', stundenCH(p.minuten)].filter(Boolean).join('  ·  ');
      if (zusatz) doc.text(sauber(zusatz), rechts - 3 - b - 3, y + 5.6, { align: 'right' });
      y += kopf + 3;
      if (p.taetigkeiten.length) { taetigkeiten(p.taetigkeiten, 4, p.titel); y += 1; }
      p.schritte.forEach((s, i) => {
        if (i > 0) { doc.setDrawColor(...FARBE.linie); doc.setLineWidth(0.2); doc.line(links + 4, y - 1.5, rechts, y - 1.5); }
        aufgabe(s, { einzug: 4, fortsetzung: p.titel });
      });
    } else {
      // Einzelpendenz als eigene Karte
      doc.setFillColor(...FARBE.projekt);
      doc.rect(links, y, 1.6, 6, 'F');
      aufgabe(p, { einzug: 4, fortsetzung: p.titel, fett: true, groesse: 11 });
    }
    y += 4;
  }

  // ---- Allgemeine Bemerkungen und Unterschriften
  platz(48 + 42);
  schrift(11, 'bold'); farbe(FARBE.navy);
  doc.text('Bemerkungen / Vereinbarungen', links, y + 4);
  textFeld('bemerkungen_allgemein', links, y + 6.5, innen, 36);
  y += 48;

  const sb = (innen - 12) / 2;
  const spalte = (x, titel, name, feldPrefix) => {
    schrift(10, 'bold'); farbe(FARBE.navy);
    doc.text(sauber(titel), x, y + 4);
    schrift(9); farbe(FARBE.grau);
    doc.text('Name', x, y + 9);
    if (feldPrefix) textFeld(`${feldPrefix}_name`, x, y + 10, sb, 7, { mehrzeilig: false, wert: sauber(name) });
    else { schrift(10); farbe(FARBE.text); doc.text(sauber(name), x + 1, y + 15); }
    schrift(9); farbe(FARBE.grau);
    doc.text('Ort, Datum', x, y + 21);
    if (feldPrefix) textFeld(`${feldPrefix}_ort_datum`, x, y + 22, sb, 7, { mehrzeilig: false });
    else { doc.setDrawColor(...FARBE.text); doc.setLineWidth(0.2); doc.line(x, y + 29, x + sb, y + 29); }
    doc.setDrawColor(...FARBE.text); doc.setLineWidth(0.3);
    doc.line(x, y + 39, x + sb, y + 39);
    schrift(9); farbe(FARBE.grau);
    doc.text('Unterschrift', x, y + 42);
  };
  spalte(links, 'Für den Mandanten', '', 'mandant');
  spalte(links + sb + 12, `Für ${firma.firma || 'den Treuhänder'}`, bearbeiter, null);
  y += 44;

  // ---- Fusszeile auf jeder Seite
  const seiten = doc.getNumberOfPages();
  for (let i = 1; i <= seiten; i += 1) {
    doc.setPage(i);
    schrift(9); farbe(FARBE.hell);
    doc.text(sauber(`Pendenzenliste ${mandant.name} · Stand ${datumCH(heute)}`), links, MM.hoehe - 9);
    doc.text(`Seite ${i} von ${seiten}`, rechts, MM.hoehe - 9, { align: 'right' });
  }
  return { doc, seiten, felder, name: dateiname(mandant.name, heute, 'pdf', 'Protokoll') };
}

export { protokollPdf, sauber };
