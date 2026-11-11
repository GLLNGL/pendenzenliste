// Kontoauszug (v7): Buchungen aus camt.053/054 oder CSV lesen und Zahlungseingaenge mit offenen
// Debitorenrechnungen abgleichen. Reine Funktionen mit Tests.
import { datumErkennen } from './buchungsjournal.js';
import { qrReferenzGueltig, scorGueltig } from './pain001.js';

// -------------------------------------------------------------------------------------------
// camt.053 / camt.054 (ISO 20022, Export aus dem E-Banking)
// -------------------------------------------------------------------------------------------
function tag(xml, name) {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1] : null;
}
function alle(xml, name) {
  return xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>[\\s\\S]*?</(?:\\w+:)?${name}>`, 'g')) ?? [];
}
function text(wert) {
  return wert == null ? '' : String(wert).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
// Erstes Datum (YYYY-MM-DD) in einem Abschnitt -- Dt/DtTm koennen verschachtelt sein.
function datumAus(xml) {
  return /(\d{4}-\d{2}-\d{2})/.exec(xml ?? '')?.[1] ?? null;
}

// -------------------------------------------------------------------------------------------
// Referenzen (QR-Referenz 27 Ziffern, RF-Creditor-Reference)
// -------------------------------------------------------------------------------------------
// Vergleichsform: nur Ziffern/Buchstaben, gross; reine Ziffernfolgen ohne fuehrende Nullen
// (die KI oder ein Export laesst sie gelegentlich weg).
function referenzNorm(ref) {
  const r = String(ref ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^\d+$/.test(r) ? r.replace(/^0+(?=\d)/, '') : r;
}
// Als QR-Referenz (27 Ziffern) aufgefuellt, falls rein numerisch und nicht laenger.
function qrForm(ref) {
  const r = referenzNorm(ref);
  return /^\d{1,27}$/.test(r) ? r.padStart(27, '0') : null;
}
// Gueltige QR- oder RF-Referenz in einem freien Text (mit oder ohne Leerzeichen).
function referenzAusText(t) {
  const s = String(t ?? '');
  for (const m of s.matchAll(/(?<![\d])\d(?:[ \u00a0]?\d){26}(?![\d])/g)) {
    const r = m[0].replace(/\D/g, '');
    if (qrReferenzGueltig(r)) return r;
  }
  for (const m of s.toUpperCase().matchAll(/RF\d{2}(?:[ \u00a0]?[A-Z0-9]){1,21}/g)) {
    const r = m[0].replace(/[^0-9A-Z]/g, '');
    if (scorGueltig(r)) return r;
  }
  return null;
}
// Anzahl abweichender Ziffern zweier QR-Referenzen (gleiche Laenge), sonst Infinity.
function ziffernAbstand(a, b) {
  const x = qrForm(a);
  const y = qrForm(b);
  if (!x || !y) return Infinity;
  let n = 0;
  for (let i = 0; i < 27; i++) if (x[i] !== y[i]) n++;
  return n;
}

function camtLesen(xmlText) {
  const xml = String(xmlText);
  const buchungen = [];
  for (const ntry of alle(xml, 'Ntry')) {
    const richtung = /CRDT/.test(tag(ntry, 'CdtDbtInd') ?? '') ? 'gutschrift' : 'belastung';
    const datum = datumAus(tag(ntry, 'BookgDt')) ?? datumAus(tag(ntry, 'ValDt'));
    const waehrung = /Ccy="(\w+)"/.exec(ntry)?.[1] ?? 'CHF';
    const details = alle(ntry, 'TxDtls');
    // Sammelbuchung mit mehreren Transaktionen: jede einzeln (eigener Betrag/Referenz).
    const teile = details.length > 1 ? details : [details[0] ?? ntry];
    for (const tx of teile) {
      const betragRoh = tag(tx, 'Amt') ?? tag(ntry, 'Amt');
      const partei = richtung === 'gutschrift'
        ? tag(tag(tx, 'Dbtr') ?? tag(tx, 'RltdPties') ?? '', 'Nm')
        : tag(tag(tx, 'Cdtr') ?? '', 'Nm');
      const mitteilung = [...alle(tx, 'Ustrd'), ...alle(tx, 'AddtlTxInf'), ...alle(ntry, 'AddtlNtryInf')].map(text).filter(Boolean);
      // Strukturierte Referenz (QRR/SCOR); fehlt sie (z.B. Sammelbuchung ohne Details), eine
      // gueltige QR-/RF-Referenz aus der Mitteilung uebernehmen.
      const strukturiert = text(tag(tag(tx, 'CdtrRefInf') ?? '', 'Ref')).replace(/\s+/g, '');
      buchungen.push({
        datum, richtung, waehrung,
        betrag: Number(text(details.length > 1 ? tag(tx, 'Amt') : tag(ntry, 'Amt')) || text(betragRoh)) || 0,
        gegenpartei: text(partei),
        referenz: strukturiert || referenzAusText(mitteilung.join(' ')) || '',
        text: [...new Set(mitteilung)].join(' · '),
      });
    }
  }
  let schlusssaldo = null;
  for (const bal of alle(xml, 'Bal')) {
    if (!/CLBD/.test(tag(bal, 'Tp') ?? '')) continue;
    const betrag = Number(text(tag(bal, 'Amt'))) * (/DBIT/.test(tag(bal, 'CdtDbtInd') ?? '') ? -1 : 1);
    schlusssaldo = { betrag, datum: datumAus(tag(bal, 'Dt') ?? bal) };
  }
  return { buchungen, schlusssaldo };
}

// -------------------------------------------------------------------------------------------
// CSV (E-Banking-Export): Datum, Gutschrift/Belastung oder Betrag mit Vorzeichen, Text.
// -------------------------------------------------------------------------------------------
function zahl(wert) {
  if (wert == null || wert === '') return null;
  if (typeof wert === 'number') return wert;
  const t = String(wert).replace(/['’\s]/g, '').replace(/CHF|EUR/gi, '');
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

function csvAuszugLesen(zeilen) {
  const kopfIndex = zeilen.findIndex((z) => z.some((f) => /datum|date/i.test(String(f ?? ''))) && z.some((f) => /gutschrift|haben|credit|betrag|amount/i.test(String(f ?? ''))));
  if (kopfIndex < 0) return null;
  const kopf = zeilen[kopfIndex].map((f) => String(f ?? '').trim());
  const finde = (re) => kopf.findIndex((k) => re.test(k));
  const sDatum = [finde(/buchungs?datum|abschlussdatum|booking/i), finde(/datum|date/i)].find((i) => i >= 0);
  const sValuta = finde(/valuta|value/i);
  const sGut = finde(/gutschrift|haben|credit|eingang/i);
  const sBel = finde(/belastung|soll|debit|ausgang/i);
  const sBetrag = finde(/^betrag|amount|einzelbetrag/i);
  const sTexte = kopf.map((k, i) => (/beschreibung|text|mitteilung|zahlungsgrund|details|auftraggeber|empf/i.test(k) ? i : -1)).filter((i) => i >= 0);
  const sRef = finde(/referenz|reference/i);
  const buchungen = [];
  for (const z of zeilen.slice(kopfIndex + 1)) {
    const datum = datumErkennen(z[sDatum]) ?? (sValuta >= 0 ? datumErkennen(z[sValuta]) : null);
    if (!datum) continue;
    let betrag = null;
    let richtung = null;
    if (sGut >= 0 && zahl(z[sGut])) { betrag = Math.abs(zahl(z[sGut])); richtung = 'gutschrift'; }
    else if (sBel >= 0 && zahl(z[sBel])) { betrag = Math.abs(zahl(z[sBel])); richtung = 'belastung'; }
    else if (sBetrag >= 0 && zahl(z[sBetrag]) != null) { const b = zahl(z[sBetrag]); betrag = Math.abs(b); richtung = b >= 0 ? 'gutschrift' : 'belastung'; }
    if (!betrag) continue;
    const t = sTexte.map((i) => String(z[i] ?? '').trim()).filter(Boolean).join(' · ');
    buchungen.push({ datum, richtung, waehrung: 'CHF', betrag, gegenpartei: '', referenz: (sRef >= 0 ? String(z[sRef] ?? '').replace(/\s+/g, '') : '') || referenzAusText(t) || '', text: t });
  }
  return { buchungen, schlusssaldo: null };
}

// -------------------------------------------------------------------------------------------
// Abgleich Zahlungseingaenge <-> offene Debitorenrechnungen
// -------------------------------------------------------------------------------------------
function vereinfacht(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(ag|gmbh|sa|sarl|klg|kg|ltd|inc)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function nameTrifft(partner, buchung) {
  const p = vereinfacht(partner);
  if (!p) return false;
  const quelle = vereinfacht(`${buchung.gegenpartei} ${buchung.text}`);
  const woerter = p.split(' ').filter((w) => w.length >= 3);
  return woerter.length > 0 && woerter.every((w) => quelle.includes(w));
}
const gleich = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
// Echte Referenz (gueltige QR- oder RF-Referenz), nicht bloss eine freie Mitteilung.
function istReferenz(ref) {
  const q = qrForm(ref);
  return (q && qrReferenzGueltig(q)) || scorGueltig(referenzNorm(ref));
}

// Bewertung eines Paars (hoeher = besser); 0 = passt nicht. Die QR-Referenz ist massgebend:
// gleiche Referenz = sicher; zwei gueltige, verschiedene Referenzen = andere Rechnung.
function bewertung(buchung, beleg) {
  const refBeleg = referenzNorm(beleg.zahlungsreferenz);
  const refZahlung = referenzNorm(buchung.referenz);
  const betragGleich = gleich(buchung.betrag, beleg.betrag);
  if (refBeleg && refZahlung && refBeleg === refZahlung) {
    return betragGleich
      ? { punkte: 100, sicherheit: 'sicher', grund: 'QR-Referenz' }
      : { punkte: 95, sicherheit: 'wahrscheinlich', grund: `QR-Referenz (Betrag abweichend: ${Number(buchung.betrag).toFixed(2)} statt ${Number(beleg.betrag).toFixed(2)})` };
  }
  if (refBeleg.length >= 10 && !refZahlung && referenzNorm(buchung.text).includes(refBeleg)) {
    return { punkte: betragGleich ? 98 : 90, sicherheit: betragGleich ? 'sicher' : 'wahrscheinlich', grund: 'QR-Referenz in der Mitteilung' };
  }
  if (refBeleg && refZahlung && istReferenz(refBeleg) && istReferenz(refZahlung)) {
    if (betragGleich && ziffernAbstand(refBeleg, refZahlung) <= 2) return { punkte: 70, sicherheit: 'wahrscheinlich', grund: 'QR-Referenz fast gleich – Referenz in der Rechnung prüfen' };
    return { punkte: 0 };
  }
  // Rechnung ohne gespeicherte Referenz: viele Programme bauen die Rechnungs-Nr. rechtsbuendig
  // vor der Pruefziffer in die QR-Referenz ein.
  const nrZiffern = String(beleg.rechnungsnummer ?? '').replace(/\D/g, '');
  const qr = qrForm(refZahlung);
  if (!refBeleg && qr && qrReferenzGueltig(qr) && nrZiffern.length >= 3 && qr.slice(0, 26).endsWith(nrZiffern)) {
    return betragGleich
      ? { punkte: 85, sicherheit: 'sicher', grund: 'Rechnungs-Nr. in der QR-Referenz und Betrag' }
      : { punkte: 55, sicherheit: 'wahrscheinlich', grund: 'Rechnungs-Nr. in der QR-Referenz (Betrag abweichend)' };
  }
  const nr = String(beleg.rechnungsnummer ?? '').trim();
  const nrImText = nr.length >= 2 && new RegExp(`(^|[^0-9A-Za-z])${nr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9A-Za-z]|$)`).test(buchung.text ?? '');
  const name = nameTrifft(beleg.partner, buchung);
  if (betragGleich && (nrImText || name)) return { punkte: 80, sicherheit: 'sicher', grund: nrImText ? 'Betrag und Rechnungs-Nr.' : 'Betrag und Name' };
  if (nrImText) return { punkte: 60, sicherheit: 'wahrscheinlich', grund: 'Rechnungs-Nr. im Text (Betrag abweichend)' };
  if (betragGleich) return { punkte: 40, sicherheit: 'wahrscheinlich', grund: 'gleicher Betrag' };
  return { punkte: 0 };
}

/**
 * Gutschriften den offenen Debitorenrechnungen zuordnen (jede Rechnung hoechstens einmal; beste
 * Paare zuerst). Gleicher Betrag ohne weiteren Hinweis bei mehreren Kandidaten = unsicher.
 * @returns [{ buchung, beleg|null, sicherheit, grund }]
 */
function abgleichen(buchungen, debitoren) {
  const eingaenge = buchungen.filter((b) => b.richtung === 'gutschrift');
  const offen = debitoren.filter((d) => !d.bezahlt_am && Number(d.betrag));
  // Referenz einer bereits bezahlten Rechnung: nicht einer anderen Rechnung zuordnen.
  const bezahltRef = new Set(debitoren.filter((d) => d.bezahlt_am && istReferenz(d.zahlungsreferenz)).map((d) => referenzNorm(d.zahlungsreferenz)));
  const paare = [];
  eingaenge.forEach((b, i) => offen.forEach((d) => {
    if (bezahltRef.has(referenzNorm(b.referenz)) && referenzNorm(d.zahlungsreferenz) !== referenzNorm(b.referenz)) return;
    const w = bewertung(b, d);
    if (w.punkte > 0) paare.push({ i, d, ...w });
  }));
  paare.sort((a, b) => b.punkte - a.punkte);
  const vergeben = new Set();
  const ergebnis = eingaenge.map((buchung) => ({ buchung, beleg: null, sicherheit: null, grund: 'keine passende offene Rechnung' }));
  for (const p of paare) {
    if (ergebnis[p.i].beleg || vergeben.has(p.d.id)) continue;
    let sicherheit = p.sicherheit;
    if (p.punkte === 40) {
      const gleicheBetraege = offen.filter((d) => !vergeben.has(d.id) && gleich(d.betrag, ergebnis[p.i].buchung.betrag)).length;
      if (gleicheBetraege > 1) sicherheit = 'unsicher';
    }
    ergebnis[p.i] = { buchung: ergebnis[p.i].buchung, beleg: p.d, sicherheit, grund: p.grund };
    vergeben.add(p.d.id);
  }
  // Nicht zugeordnet, aber mit Referenz: sagen, warum.
  for (const e of ergebnis) {
    const ref = referenzNorm(e.buchung.referenz);
    if (e.beleg || !ref) continue;
    const bekannt = debitoren.find((d) => referenzNorm(d.zahlungsreferenz) === ref);
    if (bekannt?.bezahlt_am) e.grund = `QR-Referenz gehört zu Rechnung ${bekannt.rechnungsnummer || bekannt.partner} – bereits bezahlt am ${String(bekannt.bezahlt_am).slice(0, 10).split('-').reverse().join('.')}`;
    else if (bekannt) e.grund = `QR-Referenz gehört zu Rechnung ${bekannt.rechnungsnummer || bekannt.partner} – bereits einer anderen Zahlung zugeordnet`;
    else e.grund = 'QR-Referenz bei keiner offenen Rechnung hinterlegt';
  }
  return ergebnis;
}

export { camtLesen, csvAuszugLesen, abgleichen, bewertung, referenzNorm, referenzAusText, istReferenz };
