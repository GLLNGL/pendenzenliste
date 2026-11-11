// Kontoauszug (v7): Buchungen aus camt.053/054 oder CSV lesen und Zahlungseingaenge mit offenen
// Debitorenrechnungen abgleichen. Reine Funktionen mit Tests.
import { datumErkennen } from './buchungsjournal.js';

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
      buchungen.push({
        datum, richtung, waehrung,
        betrag: Number(text(details.length > 1 ? tag(tx, 'Amt') : tag(ntry, 'Amt')) || text(betragRoh)) || 0,
        gegenpartei: text(partei),
        referenz: text(tag(tag(tx, 'CdtrRefInf') ?? '', 'Ref')).replace(/\s+/g, ''),
        text: [text(tag(tx, 'Ustrd')), text(tag(ntry, 'AddtlNtryInf'))].filter(Boolean).join(' · '),
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
    buchungen.push({ datum, richtung, waehrung: 'CHF', betrag, gegenpartei: '', referenz: sRef >= 0 ? String(z[sRef] ?? '').replace(/\s+/g, '') : '', text: t });
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

// Bewertung eines Paars (hoeher = besser); 0 = passt nicht.
function bewertung(buchung, beleg) {
  const ref = String(beleg.zahlungsreferenz ?? '').replace(/\s+/g, '');
  if (ref && buchung.referenz && ref === buchung.referenz) return { punkte: 100, sicherheit: 'sicher', grund: 'QR-Referenz' };
  const betragGleich = gleich(buchung.betrag, beleg.betrag);
  const nr = String(beleg.rechnungsnummer ?? '').trim();
  const nrImText = nr.length >= 2 && new RegExp(`(^|[^0-9A-Za-z])${nr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9A-Za-z]|$)`).test(`${buchung.text} ${buchung.referenz}`);
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
  const paare = [];
  eingaenge.forEach((b, i) => offen.forEach((d) => {
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
  return ergebnis;
}

export { camtLesen, csvAuszugLesen, abgleichen, bewertung };
