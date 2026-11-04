import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berechneCockpit, naechsteWoche } from '../src/lib/cockpit.js';

// Mittwoch, 04.11.2026 -- +5 Arbeitstage = Mi 11.11., nächste Woche = Mo 09.11.–Fr 13.11.
const heute = '2026-11-04';
const jetzt = new Date('2026-11-04T10:00:00Z');
const ICH = 1;
const ANDERE = 2;

let naechsteId = 1;
function p(felder) {
  return {
    id: naechsteId++, status: 'Offen', prioritaet: 'B', block: 'Sonstiges', faelligkeit: '2026-12-31',
    bearbeiter_id: ICH, teilaufgaben_gesamt: 0, zuletzt_geaendert_am: '2026-11-03T08:00:00Z',
    aufwand_minuten: null, bearbeitungstag: null, wiedervorlage: null, ...felder,
  };
}

test('nächste Woche läuft Montag bis Freitag', () => {
  assert.deepEqual(naechsteWoche('2026-11-04'), { von: '2026-11-09', bis: '2026-11-13' });
  assert.deepEqual(naechsteWoche('2026-11-08'), { von: '2026-11-09', bis: '2026-11-13' }); // Sonntag
  assert.deepEqual(naechsteWoche('2026-11-09'), { von: '2026-11-16', bis: '2026-11-20' }); // Montag
});

test('Fällig in ≤ 5 Arbeitstagen, sortiert nach Frist, dann Priorität', () => {
  const liste = [
    p({ titel: 'spät', faelligkeit: '2026-11-12' }), // ausserhalb
    p({ titel: 'B', faelligkeit: '2026-11-10', prioritaet: 'B' }),
    p({ titel: 'A', faelligkeit: '2026-11-10', prioritaet: 'A' }),
    p({ titel: 'überfällig', faelligkeit: '2026-10-30' }),
    p({ titel: 'Projekt-Kopf', faelligkeit: '2026-11-05', teilaufgaben_gesamt: 3 }),
  ];
  const { faellig } = berechneCockpit(liste, { heute, jetzt, ichId: ICH });
  assert.deepEqual(faellig.map((x) => x.titel), ['überfällig', 'A', 'B']);
});

test('In Arbeit zählt nur eigene Schritte', () => {
  const liste = [
    p({ status: 'In Arbeit' }), p({ status: 'In Arbeit' }), p({ status: 'In Arbeit' }), p({ status: 'In Arbeit' }),
    p({ status: 'In Arbeit', bearbeiter_id: ANDERE }),
    p({ status: 'In Arbeit', teilaufgaben_gesamt: 2 }),
  ];
  const { inArbeitAnzahl } = berechneCockpit(liste, { heute, jetzt, ichId: ICH });
  assert.equal(inArbeitAnzahl, 4);
});

test('Nachfassen: nur Warten auf mit fälligem Nachfassdatum', () => {
  const liste = [
    p({ titel: 'fällig', status: 'Warten auf', wiedervorlage: '2026-11-04' }),
    p({ titel: 'überfällig', status: 'Warten auf', wiedervorlage: '2026-11-01' }),
    p({ titel: 'später', status: 'Warten auf', wiedervorlage: '2026-11-05' }),
  ];
  const { nachfassen } = berechneCockpit(liste, { heute, jetzt, ichId: ICH });
  assert.deepEqual(nachfassen.map((x) => x.titel), ['überfällig', 'fällig']);
});

test('Unverändert > 14 Tage: nur Offen/In Arbeit', () => {
  const alt = '2026-10-01T08:00:00Z';
  const liste = [
    p({ titel: 'alt offen', zuletzt_geaendert_am: alt }),
    p({ titel: 'alt später', status: 'Später', zuletzt_geaendert_am: alt }),
    p({ titel: 'alt wartet', status: 'Warten auf', wiedervorlage: '2026-12-01', zuletzt_geaendert_am: alt }),
    p({ titel: 'frisch', zuletzt_geaendert_am: '2026-10-25T08:00:00Z' }),
  ];
  const { unveraendert } = berechneCockpit(liste, { heute, jetzt, ichId: ICH });
  assert.deepEqual(unveraendert.map((x) => x.titel), ['alt offen']);
});

test('Auslastung nächste Woche gegen Fokusstunden, Warnung über 70 %', () => {
  const liste = [
    p({ faelligkeit: '2026-11-10', aufwand_minuten: 120 }),
    p({ faelligkeit: '2026-11-30', bearbeitungstag: '2026-11-11', aufwand_minuten: 120 }), // Bearbeitungstag zählt
    p({ faelligkeit: '2026-11-12', aufwand_minuten: 120, bearbeiter_id: null }), // nicht zugewiesen zählt
    p({ faelligkeit: '2026-11-12', aufwand_minuten: 120, bearbeiter_id: ANDERE }), // andere Person nicht
    p({ faelligkeit: '2026-11-13' }), // ohne Aufwand
    p({ faelligkeit: '2026-11-20', aufwand_minuten: 60 }), // übernächste Woche
  ];
  const { auslastung } = berechneCockpit(liste, { heute, jetzt, ichId: ICH, fokusstunden: 8 });
  assert.equal(auslastung.minuten, 360);
  assert.equal(auslastung.fokusMinuten, 480);
  assert.equal(auslastung.anteil, 0.75);
  assert.equal(auslastung.warnung, true);
  assert.equal(auslastung.ohneAufwand, 1);
});

test('Block-Filter wirkt auf die Listen, nicht auf die Auslastung', () => {
  const liste = [
    p({ block: 'Lohn', faelligkeit: '2026-11-10', aufwand_minuten: 60 }),
    p({ block: 'MWST', faelligkeit: '2026-11-10', aufwand_minuten: 60 }),
  ];
  const ergebnis = berechneCockpit(liste, { heute, jetzt, ichId: ICH, block: 'Lohn' });
  assert.equal(ergebnis.faellig.length, 1);
  assert.equal(ergebnis.auslastung.minuten, 120);
});
