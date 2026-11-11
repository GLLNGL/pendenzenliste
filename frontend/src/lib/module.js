// Modul-Struktur analog Abacus: oben die Modulauswahl ("30 Preiskalkulation"), darunter der
// Programmbaum mit Gruppen und Programmnummern. Die Pfade bleiben unveraendert -- das Modul
// ergibt sich aus dem Pfad.

const MODULE = [
  {
    id: 'pendenzen', nr: 10, name: 'Pendenzen', symbol: '✓', beschreibung: 'Cockpit, Eingang, Planung, Archiv, Zeitjournal',
    gruppen: [
      { nr: 1, name: 'Tagesarbeit', eintraege: [
        { nr: 11, pfad: '/', label: 'Cockpit' },
        { nr: 12, pfad: '/eingang', label: 'Eingang' },
        { nr: 13, pfad: '/pendenzen', label: 'Alle Pendenzen' },
      ] },
      { nr: 2, name: 'Planung', eintraege: [
        { nr: 21, pfad: '/planen', label: 'Zu planen' },
        { nr: 22, pfad: '/regeln', label: 'Wiederkehrende' },
        { nr: 23, pfad: '/wochenrueckblick', label: 'Wochenrückblick' },
        { nr: 24, pfad: '/uebersicht', label: 'Übersicht & Kalender' },
      ] },
      { nr: 3, name: 'Auswertungen', eintraege: [
        { nr: 31, pfad: '/archiv', label: 'Archiv' },
      ] },
      { nr: 4, name: 'Zeit', eintraege: [
        { nr: 41, pfad: '/zeit', label: 'Zeitjournal' },
      ] },
    ],
  },
  {
    id: 'kunden', nr: 20, name: 'Kundenstamm', symbol: '◉', beschreibung: 'Mandanten, Offerten pro Mandant, Onboarding, Detailrapporte',
    gruppen: [
      { nr: 1, name: 'Stammdaten', eintraege: [
        { nr: 11, pfad: '/mandanten', label: 'Mandanten' },
        { nr: 12, pfad: '/onboarding-unterlagen', label: 'Onboarding-Unterlagen' },
      ] },
      { nr: 2, name: 'Verrechnung', eintraege: [
        { nr: 21, pfad: '/rapporte', label: 'Detailrapporte' },
      ] },
    ],
  },
  {
    id: 'offerten', nr: 30, name: 'Preiskalkulation', symbol: '✎', beschreibung: 'Angebote kalkulieren, drucken und per E-Mail senden',
    gruppen: [
      { nr: 1, name: 'Angebot', eintraege: [
        { nr: 11, pfad: '/offerten', label: 'Offerten' },
      ] },
      { nr: 2, name: 'Stammdaten', eintraege: [
        { nr: 21, pfad: '/preise', label: 'Preise & Katalog' },
      ] },
    ],
  },
  {
    id: 'buchhaltung', nr: 40, name: 'Buchhaltung', symbol: '₣', beschreibung: 'Kreditoren, Debitoren, Liquiditätsplan, Abstimmungen Jahresabschluss',
    gruppen: [
      { nr: 1, name: 'Belege', eintraege: [
        { nr: 11, pfad: '/kreditoren', label: 'Kreditoren' },
        { nr: 12, pfad: '/debitoren', label: 'Debitoren' },
      ] },
      { nr: 2, name: 'Auswertungen', eintraege: [
        { nr: 21, pfad: '/liquiditaet', label: 'Liquiditätsplan' },
      ] },
      { nr: 3, name: 'Abstimmung MWST', eintraege: [
        { nr: 31, pfad: '/abstimmung/mwst', label: 'MWST' },
      ] },
      { nr: 4, name: 'Abstimmung Sozialversicherungen', eintraege: [
        { nr: 41, pfad: '/abstimmung/ahv', label: 'AHV' },
        { nr: 42, pfad: '/abstimmung/bvg', label: 'BVG' },
        { nr: 43, pfad: '/abstimmung/uvg', label: 'UVG' },
        { nr: 44, pfad: '/abstimmung/ktg', label: 'KTG' },
      ] },
    ],
  },
  {
    id: 'admin', nr: 90, name: 'Administration', symbol: '⚙', beschreibung: 'Team und Einstellungen',
    gruppen: [
      { nr: 1, name: 'System', eintraege: [
        { nr: 11, pfad: '/team', label: 'Team' },
        { nr: 12, pfad: '/einstellungen', label: 'Einstellungen' },
      ] },
    ],
  },
].map((m) => ({ ...m, eintraege: m.gruppen.flatMap((g) => g.eintraege) }));

function passt(pfad, eintragPfad) {
  if (eintragPfad === '/') return pfad === '/';
  return pfad === eintragPfad || pfad.startsWith(`${eintragPfad}/`);
}

// Modul zum aktuellen Pfad (null auf der Startseite).
function modulFuerPfad(pfad) {
  if (pfad === '/start') return null;
  return MODULE.find((m) => m.eintraege.some((e) => passt(pfad, e.pfad))) ?? MODULE[0];
}

export { MODULE, modulFuerPfad, passt };
