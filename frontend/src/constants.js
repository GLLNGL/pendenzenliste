// Status/Prioritaeten seit "Etappe 1 Arbeitsprozess" (siehe supabase/schema.sql). "Warten auf"
// verlangt immer Person + Nachfassdatum, "Später" = bewusst zurueckgestellt (z.B. weitere
// Schritte eines Projekts, solange der vorherige noch offen ist).
const STATUS_WERTE = ['Offen', 'In Arbeit', 'Warten auf', 'Später', 'Erledigt'];
const OFFENE_STATUS = ['Offen', 'In Arbeit', 'Warten auf', 'Später'];
const PRIORITAETEN = ['A', 'B', 'C'];
const PRIORITAET_BESCHREIBUNG = {
  A: 'A – harte Frist in ≤ 5 Arbeitstagen oder Mandant blockiert',
  B: 'B – wichtig, nicht dringend',
  C: 'C – dringend, wenig Wert (bündeln/delegieren)',
};

const AUFWAND_MINUTEN = [15, 30, 60, 120];
const BLOECKE = ['Zahlungen', 'Lohn', 'MWST', 'Abschluss', 'Debitoren', 'Admin', 'Sonstiges'];

// Mandats-Eckdaten (Kundenliste). Werte = gespeicherter Text, Label = Anzeige.
const MWST_PERIODEN = ['Quartal', 'Semester', 'keine'];
const ZAHLUNGSLAUF_RHYTHMEN = [
  { wert: 'woechentlich', label: 'Wöchentlich' },
  { wert: '14-taeglich', label: 'Alle 14 Tage' },
  { wert: 'monatlich', label: 'Monatlich' },
  { wert: 'keiner', label: 'Kein Zahlungslauf' },
];

// Frueher per GET /api/meta vom Server geliefert (aus backend/src/recurrence.js) -- da rein
// statisch, jetzt direkt als Konstante im Frontend statt eines Netzwerk-Aufrufs.
const RHYTHMEN = ['woechentlich', '14-taeglich', 'monatlich', 'quartalsweise', 'halbjaehrlich', 'jaehrlich'];
const RHYTHMUS_LABEL = {
  woechentlich: 'Wöchentlich', '14-taeglich': 'Alle 14 Tage', monatlich: 'Monatlich',
  quartalsweise: 'Quartalsweise', halbjaehrlich: 'Halbjährlich', jaehrlich: 'Jährlich',
};
// "wochentag" gehoert zu den Wochen-Rhythmen, alle anderen zu den Monats-/Jahres-Rhythmen.
const FAELLIGKEIT_TYPEN = [
  { typ: 'wochentag', label: 'Wochentag', felder: ['wochentag'] },
  { typ: 'tag_des_monats', label: 'Tag des Monats', felder: ['tag'] },
  { typ: 'letzter_tag_des_monats', label: 'Letzter Tag des Monats', felder: [] },
  { typ: 'tage_nach_periodenende', label: 'X Tage nach Periodenende', felder: ['tage'] },
  { typ: 'tag_monat_folgejahr', label: 'Tag/Monat (mit Jahresversatz)', felder: ['tag', 'monat', 'jahre_offset'] },
  { typ: 'tage_des_monats_liste', label: 'Mehrere Tage im Monat', felder: ['tage'] },
];

// Fuer CSS-Klassen (status-offen, status-warten-auf, status-spaeter ...) -- Umlaute werden
// ersetzt, damit die Klassennamen reines ASCII bleiben.
function statusSlug(status) {
  return status.toLowerCase().replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll(' ', '-');
}

// "Warten auf" ohne bereits hinterlegte Person/Nachfassdatum laesst sich nicht per Schnell-
// Dropdown setzen -- die Listen oeffnen dann stattdessen das Bearbeiten-Fenster mit diesem
// Status vorausgewaehlt, damit beides gleich erfasst werden kann.
function statusWechselBrauchtFormular(pendenz, neuerStatus) {
  return neuerStatus === 'Warten auf' && !(pendenz.warten_auf_person && pendenz.wiedervorlage);
}

// Geschaetzte Gesamtzeit einer Liste: Summe der Minuten plus Anzahl Pendenzen ohne Schaetzung
// (die in der Summe fehlen und darum separat ausgewiesen werden).
function aufwandSumme(pendenzen) {
  return pendenzen.reduce((s, p) => (p.aufwand_minuten == null
    ? { ...s, ohne: s.ohne + 1 }
    : { ...s, minuten: s.minuten + p.aufwand_minuten }), { minuten: 0, ohne: 0 });
}

// Stunden mit hoechstens einer Nachkommastelle im Schweizer Format ("4.5 h", "45 Min.").
function formatiereStunden(minuten) {
  if (minuten < 60) return `${minuten} Min.`;
  return `${(minuten / 60).toLocaleString('de-CH', { maximumFractionDigits: 1 })} h`;
}

function formatiereAufwand(minuten) {
  if (minuten == null) return '';
  return minuten < 60 ? `${minuten} Min.` : `${minuten / 60} Std.`;
}

export {
  STATUS_WERTE, OFFENE_STATUS, PRIORITAETEN, PRIORITAET_BESCHREIBUNG, AUFWAND_MINUTEN, BLOECKE,
  MWST_PERIODEN, ZAHLUNGSLAUF_RHYTHMEN, RHYTHMEN, RHYTHMUS_LABEL, FAELLIGKEIT_TYPEN, statusSlug, formatiereAufwand,
  statusWechselBrauchtFormular, aufwandSumme, formatiereStunden,
};
