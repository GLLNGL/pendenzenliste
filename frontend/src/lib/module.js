// Modul-Struktur analog Abacus: Startseite mit Modulen, in jedem Modul nur dessen Programme.
// Die Pfade bleiben unveraendert -- das Modul ergibt sich aus dem Pfad.

const MODULE = [
  {
    id: 'pendenzen', name: 'Pendenzen', symbol: '✓', beschreibung: 'Cockpit, Eingang, Planung, Wiederkehrende, Archiv',
    eintraege: [
      { pfad: '/', label: 'Cockpit' },
      { pfad: '/eingang', label: 'Eingang' },
      { pfad: '/pendenzen', label: 'Alle Pendenzen' },
      { pfad: '/regeln', label: 'Wiederkehrende' },
      { pfad: '/wochenrueckblick', label: 'Wochenrückblick' },
      { pfad: '/archiv', label: 'Archiv' },
    ],
  },
  {
    id: 'kunden', name: 'Kundenstamm', symbol: '◉', beschreibung: 'Mandanten, Interessenten, Adressen und Pauschalen',
    eintraege: [{ pfad: '/mandanten', label: 'Mandanten' }],
  },
  {
    id: 'offerten', name: 'Offerten', symbol: '✎', beschreibung: 'Offerten erstellen, drucken und per E-Mail senden',
    eintraege: [
      { pfad: '/offerten', label: 'Offerten' },
      { pfad: '/preise', label: 'Preise & Katalog' },
    ],
  },
  {
    id: 'zeit', name: 'Zeiterfassung', symbol: '◷', beschreibung: 'Stunden pro Mandant, Detailrapport, Rentabilität',
    eintraege: [], folgt: true,
  },
  {
    id: 'admin', name: 'Administration', symbol: '⚙', beschreibung: 'Team und Einstellungen',
    eintraege: [
      { pfad: '/team', label: 'Team' },
      { pfad: '/einstellungen', label: 'Einstellungen' },
    ],
  },
];

function passt(pfad, eintragPfad) {
  if (eintragPfad === '/') return pfad === '/';
  return pfad === eintragPfad || pfad.startsWith(`${eintragPfad}/`);
}

// Modul zum aktuellen Pfad (null auf der Startseite).
function modulFuerPfad(pfad) {
  if (pfad === '/start') return null;
  return MODULE.find((m) => m.eintraege.some((e) => passt(pfad, e.pfad))) ?? MODULE[0];
}

export { MODULE, modulFuerPfad };
