// Preiskalkulation (v7): Buchungen pro Monat aus einem Buchungsjournal oder Bankauszug zaehlen.
// CSV/Excel-Tabellen und camt.053/054 (E-Banking-Export) werden im Browser gezaehlt; PDFs liest
// die KI (Edge Function). Reine Funktionen mit Tests -- ausser dem Excel-Leser (Browser).

// Datum in vielen Schreibweisen -> 'YYYY-MM-DD' (oder null).
function datumErkennen(wert) {
  if (wert == null || wert === '') return null;
  if (typeof wert === 'number' || /^\d{5}(\.\d+)?$/.test(String(wert).trim())) {
    // Excel-Seriennummer (Tage seit 1899-12-30), plausibel 2000–2049.
    const n = Number(wert);
    if (n < 36526 || n > 54789) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }
  const t = String(wert).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return gueltig(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/.exec(t);
  if (m) {
    const jahr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return gueltig(jahr, +m[2], +m[1]);
  }
  return null;
}

function gueltig(j, mo, t) {
  if (j < 2000 || j > 2049 || mo < 1 || mo > 12 || t < 1 || t > 31) return null;
  return `${j}-${String(mo).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

// CSV/TXT in Zeilen und Felder zerlegen (Trennzeichen ; , oder Tab, Anfuehrungszeichen).
function csvZerlegen(text) {
  const zeilen = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((z) => z.trim());
  if (!zeilen.length) return [];
  const probe = zeilen.slice(0, 20).join('\n');
  const trenner = [';', '\t', ','].map((t) => [t, probe.split(t).length]).sort((a, b) => b[1] - a[1])[0][0];
  return zeilen.map((zeile) => {
    const felder = [];
    let feld = '';
    let inAnf = false;
    for (let i = 0; i < zeile.length; i += 1) {
      const c = zeile[i];
      if (c === '"') {
        if (inAnf && zeile[i + 1] === '"') { feld += '"'; i += 1; } else inAnf = !inAnf;
      } else if (c === trenner && !inAnf) { felder.push(feld.trim()); feld = ''; } else feld += c;
    }
    felder.push(feld.trim());
    return felder;
  });
}

const DATUM_KOPF = /datum|date|valuta|buchungstag|buch\.?-?dat/i;
const BELEG_KOPF = /^(beleg|beleg-?nr|beleg\s*nr\.?|bel\.?-?nr\.?|dok(ument)?-?nr\.?|buchungs-?nr\.?|journal-?nr\.?)$/i;

/**
 * Buchungen pro Monat in einer Tabelle zaehlen.
 * Datumsspalte: bevorzugt mit passender Ueberschrift, sonst die Spalte mit den meisten Daten.
 * Gibt es eine Beleg-Nr.-Spalte, zaehlen gleiche Beleg-Nummern als eine Buchung (Sammel-/
 * Splitbuchungen im Journal), sonst jede Zeile mit Datum.
 */
function tabelleZaehlen(zeilen) {
  if (!zeilen.length) return null;
  const breite = Math.max(...zeilen.map((z) => z.length));
  const kopfIndex = zeilen.findIndex((z) => z.some((f) => DATUM_KOPF.test(String(f ?? ''))) && z.filter((f) => datumErkennen(f)).length === 0);
  const kopf = kopfIndex >= 0 ? zeilen[kopfIndex].map((f) => String(f ?? '')) : [];
  const daten = kopfIndex >= 0 ? zeilen.slice(kopfIndex + 1) : zeilen;

  const treffer = Array.from({ length: breite }, (_, s) => daten.filter((z) => datumErkennen(z[s])).length);
  const kandidaten = treffer.map((n, s) => ({ s, n, kopf: DATUM_KOPF.test(kopf[s] ?? '') })).filter((k) => k.n > 0);
  if (!kandidaten.length) return null;
  // Mit Ueberschrift "Datum" und mindestens halb so vielen Treffern wie die beste Spalte bevorzugen.
  const max = Math.max(...kandidaten.map((k) => k.n));
  const spalte = (kandidaten.find((k) => k.kopf && k.n >= max / 2) ?? kandidaten.sort((a, b) => b.n - a.n)[0]).s;
  const belegSpalte = kopf.findIndex((f) => BELEG_KOPF.test(f.trim()));

  const proMonat = new Map();
  const gesehen = new Set();
  for (const z of daten) {
    const d = datumErkennen(z[spalte]);
    if (!d) continue;
    if (belegSpalte >= 0 && String(z[belegSpalte] ?? '').trim()) {
      const schluessel = `${String(z[belegSpalte]).trim()}|${d.slice(0, 7)}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
    }
    proMonat.set(d.slice(0, 7), (proMonat.get(d.slice(0, 7)) ?? 0) + 1);
  }
  return {
    monate: [...proMonat.entries()].sort().map(([monat, anzahl]) => ({ monat, anzahl })),
    methode: belegSpalte >= 0 ? `nach Beleg-Nr. («${kopf[belegSpalte]}»)` : `Zeilen mit Datum${kopf[spalte] ? ` («${kopf[spalte]}»)` : ''}`,
  };
}

// camt.053/054: jede <Ntry> ist eine Buchung; Monat aus Buchungsdatum (sonst Valuta).
function camtZaehlen(xmlText) {
  const proMonat = new Map();
  const eintraege = String(xmlText).match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) ?? [];
  for (const e of eintraege) {
    const d = /<(?:\w+:)?BookgDt>\s*<(?:\w+:)?Dt(?:Tm)?>([\d-]{10})/.exec(e)?.[1] ?? /<(?:\w+:)?ValDt>\s*<(?:\w+:)?Dt(?:Tm)?>([\d-]{10})/.exec(e)?.[1];
    if (!d) continue;
    proMonat.set(d.slice(0, 7), (proMonat.get(d.slice(0, 7)) ?? 0) + 1);
  }
  if (!proMonat.size) return null;
  return { monate: [...proMonat.entries()].sort().map(([monat, anzahl]) => ({ monat, anzahl })), methode: 'Buchungen im camt-Auszug' };
}

// Mehrere Dateien (z.B. 12 Monatsauszuege) zusammenfassen.
function monateZusammen(listen) {
  const summe = new Map();
  for (const l of listen) for (const { monat, anzahl } of l) summe.set(monat, (summe.get(monat) ?? 0) + anzahl);
  return [...summe.entries()].sort().map(([monat, anzahl]) => ({ monat, anzahl }));
}

// Kennzahlen; leere Monate zwischen erstem und letztem Monat zaehlen als 0.
function kennzahlen(monate) {
  if (!monate.length) return null;
  const alle = [];
  const [j0, m0] = monate[0].monat.split('-').map(Number);
  const [j1, m1] = monate[monate.length - 1].monat.split('-').map(Number);
  const werte = new Map(monate.map((x) => [x.monat, x.anzahl]));
  for (let j = j0, m = m0; j < j1 || (j === j1 && m <= m1); m === 12 ? (j += 1, m = 1) : (m += 1)) {
    const schluessel = `${j}-${String(m).padStart(2, '0')}`;
    alle.push({ monat: schluessel, anzahl: werte.get(schluessel) ?? 0 });
  }
  const total = alle.reduce((s, x) => s + x.anzahl, 0);
  return {
    monate: alle,
    total,
    durchschnitt: Math.round((total / alle.length) * 10) / 10,
    maximum: Math.max(...alle.map((x) => x.anzahl)),
    minimum: Math.min(...alle.map((x) => x.anzahl)),
  };
}

// --------------------------------------------------------------------------------------------
// Excel (.xlsx) im Browser lesen: ZIP-Verzeichnis, Tabellenblatt 1 und gemeinsame Texte.
// --------------------------------------------------------------------------------------------
async function zipEintraege(puffer) {
  const v = new DataView(puffer);
  let ende = -1;
  for (let i = puffer.byteLength - 22; i >= Math.max(0, puffer.byteLength - 65557); i -= 1) {
    if (v.getUint32(i, true) === 0x06054b50) { ende = i; break; }
  }
  if (ende < 0) throw new Error('Keine gültige Excel-Datei (.xlsx).');
  const anzahl = v.getUint16(ende + 10, true);
  let pos = v.getUint32(ende + 16, true);
  const eintraege = new Map();
  const dekoder = new TextDecoder();
  for (let i = 0; i < anzahl; i += 1) {
    const methode = v.getUint16(pos + 10, true);
    const groesse = v.getUint32(pos + 20, true);
    const nameLaenge = v.getUint16(pos + 28, true);
    const extra = v.getUint16(pos + 30, true);
    const kommentar = v.getUint16(pos + 32, true);
    const lokal = v.getUint32(pos + 42, true);
    const name = dekoder.decode(new Uint8Array(puffer, pos + 46, nameLaenge));
    eintraege.set(name, { methode, groesse, lokal });
    pos += 46 + nameLaenge + extra + kommentar;
  }
  return async (name) => {
    const e = eintraege.get(name);
    if (!e) return null;
    const start = e.lokal + 30 + v.getUint16(e.lokal + 26, true) + v.getUint16(e.lokal + 28, true);
    const daten = new Uint8Array(puffer, start, e.groesse);
    if (e.methode === 0) return dekoder.decode(daten);
    const strom = new Blob([daten]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(strom).text();
  };
}

function spaltenIndex(ref) {
  const buchstaben = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...buchstaben].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

async function xlsxZeilen(puffer) {
  const lesen = await zipEintraege(puffer);
  const parser = new DOMParser();
  const texte = [];
  const shared = await lesen('xl/sharedStrings.xml');
  if (shared) {
    for (const si of parser.parseFromString(shared, 'application/xml').getElementsByTagName('si')) {
      texte.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
  }
  const blatt = await lesen('xl/worksheets/sheet1.xml');
  if (!blatt) throw new Error('Tabellenblatt nicht gefunden.');
  const zeilen = [];
  for (const row of parser.parseFromString(blatt, 'application/xml').getElementsByTagName('row')) {
    const zeile = [];
    for (const c of row.getElementsByTagName('c')) {
      const typ = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? c.getElementsByTagName('t')[0]?.textContent ?? '';
      zeile[spaltenIndex(c.getAttribute('r') ?? '')] = typ === 's' ? texte[Number(v)] ?? '' : (typ === 'str' || typ === 'inlineStr' || v === '' || Number.isNaN(Number(v)) ? v : Number(v));
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

export { datumErkennen, csvZerlegen, tabelleZaehlen, camtZaehlen, monateZusammen, kennzahlen, xlsxZeilen };
