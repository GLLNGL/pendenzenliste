// Modul-Struktur analog Abacus: oben die Modulauswahl ("30 Offerten"), darunter der
// Programmbaum mit Gruppen und Programmnummern. Die Pfade bleiben unveraendert -- das Modul
// ergibt sich aus dem Pfad.

const MODULE = [
  {
    id: 'pendenzen', nr: 10, name: 'Pendenzen', symbol: '✓', beschreibung: 'Cockpit, Eingang, Planung, Wiederkehrende, Archiv',
    gruppen: [
      { nr: 1, name: 'Tagesarbeit', eintraege: [
        { nr: 11, pfad: '/', label: 'Cockpit' },
        { nr: 12, pfad: '/eingang', label: 'Eingang' },
        { nr: 13, pfad: '/pendenzen', label: 'Alle Pendenzen' },
      ] },
      { nr: 2, name: 'Planung', eintraege: [
        { nr: 21, pfad: '/regeln', label: 'Wiederkehrende' },
        { nr: 22, pfad: '/wochenrueckblick', label: 'Wochenrückblick' },
      ] },
      { nr: 3, name: 'Auswertungen', eintraege: [
        { nr: 31, pfad: '/archiv', label: 'Archiv' },
      ] },
    ],
  },
  {
    id: 'kunden', nr: 20, name: 'Kundenstamm', symbol: '◉', beschreibung: 'Mandanten, Interessenten, Adressen und Pauschalen',
    gruppen: [
      { nr: 1, name: 'Stammdaten', eintraege: [
        { nr: 11, pfad: '/mandanten', label: 'Mandanten' },
      ] },
    ],
  },
  {
    id: 'offerten', nr: 30, name: 'Offerten', symbol: '✎', beschreibung: 'Offerten erstellen, drucken und per E-Mail senden',
    gruppen: [
      { nr: 1, name: 'Offerten', eintraege: [
        { nr: 11, pfad: '/offerten', label: 'Offerten' },
      ] },
      { nr: 2, name: 'Stammdaten', eintraege: [
        { nr: 21, pfad: '/preise', label: 'Preise & Katalog' },
      ] },
    ],
  },
  {
    id: 'zeit', nr: 40, name: 'Zeiterfassung', symbol: '◷', beschreibung: 'Stunden pro Mandant (Pauschale/Extra) – Detailrapport und Rentabilität folgen',
    gruppen: [
      { nr: 1, name: 'Erfassung', eintraege: [
        { nr: 11, pfad: '/zeit', label: 'Zeitjournal' },
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
