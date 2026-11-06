// Preislogik (v7, Etappe 1) -- aus dem bisherigen Excel-Preiskalkulator uebernommen.
// Reine Funktionen ohne Datenbankzugriff, damit sie in Tests und spaeter in Offerte,
// Rapport und Rentabilitaet gleich rechnen.

const TURNUS = [
  { wert: 'monatlich', label: 'Mt.' },
  { wert: 'jaehrlich', label: 'Jahr' },
];
const PREIS_ARTEN = [
  { wert: 'zeit', label: 'Zeitbasiert (Zeit × Ansatz)' },
  { wert: 'fix', label: 'Festpreis pro Einheit' },
];
const EINHEITEN_VORSCHLAG = ['Beleg', 'MA', 'Std.', 'Pauschale'];

function turnusLabel(turnus) {
  return TURNUS.find((t) => t.wert === turnus)?.label ?? turnus;
}

function zahl(wert) {
  return wert === '' || wert == null ? null : Number(wert);
}

// CHF pro Einheit: zeitbasiert = Minuten / 60 x Ansatz, sonst Festpreis. null, wenn Angaben fehlen.
function preisProEinheit(leistung, ansaetze) {
  if (!leistung) return null;
  if (leistung.preis_art === 'fix') return zahl(leistung.festpreis_pro_einheit);
  const minuten = zahl(leistung.minuten_pro_einheit);
  const ansatz = ansaetze.find((a) => a.id === leistung.stundenansatz_id);
  if (minuten == null || !ansatz) return null;
  return (minuten / 60) * Number(ansatz.chf_pro_stunde);
}

// Listenpreis pro Monat fuer eine Menge (jaehrliche Leistungen auf 12 Monate verteilt).
function listenpreisMonat(leistung, menge, ansaetze) {
  const preis = preisProEinheit(leistung, ansaetze);
  const m = zahl(menge);
  if (preis == null || m == null) return null;
  const jahr = leistung.turnus === 'jaehrlich';
  return jahr ? (m * preis) / 12 : m * preis;
}

// Planzeit in Minuten pro Monat -- Grundlage fuer den Soll-/Ist-Vergleich.
function planMinutenMonat(leistung, menge) {
  const minuten = zahl(leistung?.minuten_pro_einheit);
  const m = zahl(menge);
  if (minuten == null || m == null) return null;
  return leistung.turnus === 'jaehrlich' ? (m * minuten) / 12 : m * minuten;
}

// Effektiver Stundensatz: Ertrag pro Monat / Stunden pro Monat.
function effektiverSatz(betragMonat, minutenMonat) {
  if (!minutenMonat || betragMonat == null) return null;
  return Number(betragMonat) / (minutenMonat / 60);
}

function formatiereCHF(betrag, { ohneRappen = false } = {}) {
  if (betrag == null || Number.isNaN(Number(betrag))) return '–';
  const stellen = ohneRappen ? 0 : 2;
  return Number(betrag).toLocaleString('de-CH', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

// Minuten kompakt: "3 Min.", "1.5 h".
function formatiereMinuten(minuten) {
  if (minuten == null) return '–';
  if (minuten < 60) return `${Number(minuten).toLocaleString('de-CH', { maximumFractionDigits: 1 })} Min.`;
  return `${(minuten / 60).toLocaleString('de-CH', { maximumFractionDigits: 1 })} h`;
}

// Naechste freie Kunden-Nummer im Format M-NNN (wie im Excel).
function naechsteKundenNr(mandanten) {
  const hoechste = mandanten.reduce((max, m) => {
    const treffer = /^M-(\d+)$/.exec(m.kunden_nr || '');
    return treffer ? Math.max(max, Number(treffer[1])) : max;
  }, 0);
  return `M-${String(hoechste + 1).padStart(3, '0')}`;
}

// Pauschalen, die an einem Stichtag gelten (gueltig_ab <= Tag <= gueltig_bis).
function aktivePauschalen(pauschalen, stichtag) {
  return pauschalen.filter((p) => p.gueltig_ab <= stichtag && (!p.gueltig_bis || p.gueltig_bis >= stichtag));
}

function pauschalenSumme(pauschalen) {
  return pauschalen.reduce((s, p) => s + Number(p.betrag_monat || 0), 0);
}

const STUNDEN_PRO_TAG = 8;

// Zielansatz einer Leistung (CHF/Std.): ihr Ansatz, sonst der Standardansatz.
function zielansatz(leistung, ansaetze) {
  const a = ansaetze.find((x) => x.id === leistung?.stundenansatz_id) ?? ansaetze.find((x) => x.ist_standard);
  return a ? Number(a.chf_pro_stunde) : null;
}

// Maximale Minuten, die der Betrag beim Zielansatz deckt (Betrag / Ansatz).
function maxMinuten(betrag, ansatz) {
  if (betrag == null || !ansatz) return null;
  return (Number(betrag) / Number(ansatz)) * 60;
}

// "0.4 Tage" (1 Tag = 8 h).
function formatiereTage(minuten) {
  if (minuten == null) return '–';
  const tage = minuten / 60 / STUNDEN_PRO_TAG;
  return `${tage.toLocaleString('de-CH', { maximumFractionDigits: tage < 1 ? 2 : 1 })} ${tage === 1 ? 'Tag' : 'Tage'}`;
}

export {
  STUNDEN_PRO_TAG, zielansatz, maxMinuten, formatiereTage,
  TURNUS, PREIS_ARTEN, EINHEITEN_VORSCHLAG, turnusLabel,
  preisProEinheit, listenpreisMonat, planMinutenMonat, effektiverSatz,
  formatiereCHF, formatiereMinuten, naechsteKundenNr, aktivePauschalen, pauschalenSumme,
};
