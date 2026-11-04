// Wochenrückblick und Nachfassen (Etappe 5) -- reine Funktionen, damit sie sich mit `npm test`
// prüfen lassen.

// Abhakbare Checkliste des Wochenrückblicks (Freitag). Die Schlüssel werden pro Woche in
// wochenrueckblicke.checkliste gespeichert -- Texte dürfen sich ändern, Schlüssel nicht.
const RUECKBLICK_CHECKLISTE = [
  {
    gruppe: 'Leeren',
    punkte: [
      { key: 'posteingang', text: 'Mail-Posteingang verarbeitet' },
      { key: 'deepbox', text: 'DeepBox-/OneDrive-Eingänge gesichtet' },
      { key: 'notizen', text: 'Notizen übertragen (Eingang leer)' },
    ],
  },
  {
    gruppe: 'Aktualisieren',
    punkte: [
      { key: 'erledigtes', text: 'Erledigtes abgeschlossen' },
      { key: 'naechster_schritt', text: 'Jede offene Pendenz hat nächsten Schritt + Frist' },
      { key: 'nachgefasst', text: 'Warten-auf nachgefasst' },
      { key: 'fristen', text: 'Fristen der nächsten 4 Wochen geprüft' },
      { key: 'wiederkehrende', text: 'Wiederkehrende Pendenzen erzeugt' },
    ],
  },
  {
    gruppe: 'Planen',
    punkte: [
      { key: 'wochenziele', text: '3–5 wichtigste Ergebnisse der nächsten Woche markiert' },
      { key: 'auslastung', text: 'Auslastung nächste Woche ≤ 70 %' },
    ],
  },
];

const ALLE_PUNKTE = RUECKBLICK_CHECKLISTE.flatMap((g) => g.punkte);
const WOCHENZIELE_MIN = 3;
const WOCHENZIELE_MAX = 5;
const NACHFASS_ABSTAND_TAGE = 7;

function montagDerWoche(iso) {
  const [j, m, t] = iso.split('-').map(Number);
  const datum = new Date(Date.UTC(j, m - 1, t));
  datum.setUTCDate(datum.getUTCDate() - ((datum.getUTCDay() + 6) % 7));
  return datum.toISOString().slice(0, 10);
}

function fortschritt(checkliste) {
  const erledigt = ALLE_PUNKTE.filter((p) => checkliste?.[p.key]).length;
  return { erledigt, gesamt: ALLE_PUNKTE.length };
}

function formatiere(iso) {
  return iso ? iso.split('-').reverse().join('.') : '';
}

// Erinnerungs-Mail für eine Pendenz mit Status "Warten auf". Wird nur VORBEREITET -- die
// Person prüft und sendet selbst. Empfänger-Vorschlag: Ansprechperson des Mandanten.
function baueErinnerung(pendenz, absenderName) {
  const anrede = pendenz.warten_auf_person ? `Guten Tag ${pendenz.warten_auf_person}` : 'Guten Tag';
  const seit = pendenz.warte_seit ? ` seit dem ${formatiere(pendenz.warte_seit)}` : '';
  const betreffBasis = pendenz.mandant_name ? `${pendenz.mandant_name}: ${pendenz.titel}` : pendenz.titel;
  return {
    an: pendenz.mandant_email || '',
    betreff: `Erinnerung – ${betreffBasis}`,
    text: [
      anrede,
      '',
      `Gerne erinnere ich Sie an «${pendenz.titel}». Wir warten${seit} auf Ihre Rückmeldung bzw. Unterlagen, `
        + `damit wir die Arbeit abschliessen können${pendenz.faelligkeit ? ` (Frist ${formatiere(pendenz.faelligkeit)})` : ''}.`,
      '',
      'Besten Dank für Ihre Rückmeldung.',
      '',
      'Freundliche Grüsse',
      absenderName || '',
    ].join('\n').trimEnd(),
  };
}

export {
  RUECKBLICK_CHECKLISTE, WOCHENZIELE_MIN, WOCHENZIELE_MAX, NACHFASS_ABSTAND_TAGE,
  montagDerWoche, fortschritt, baueErinnerung,
};
