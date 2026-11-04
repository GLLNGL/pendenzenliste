import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montagDerWoche, fortschritt, baueErinnerung } from '../src/lib/wochenrueckblick.js';
import { berechneCockpit } from '../src/lib/cockpit.js';

test('Montag der Woche (auch am Wochenende)', () => {
  assert.equal(montagDerWoche('2026-11-06'), '2026-11-02'); // Freitag
  assert.equal(montagDerWoche('2026-11-08'), '2026-11-02'); // Sonntag gehört zur selben Woche
  assert.equal(montagDerWoche('2026-11-09'), '2026-11-09'); // Montag
});

test('Fortschritt der Checkliste', () => {
  assert.deepEqual(fortschritt({}), { erledigt: 0, gesamt: 10 });
  assert.deepEqual(fortschritt({ posteingang: true, fristen: true, unbekannt: true, deepbox: false }), { erledigt: 2, gesamt: 10 });
});

test('Erinnerungs-Mail wird mit Person, Mandant und Frist vorbereitet', () => {
  const mail = baueErinnerung({
    titel: 'Belege Q3 einfordern', mandant_name: 'Muster AG', mandant_email: 'info@muster.ch',
    warten_auf_person: 'Herr Muster', warte_seit: '2026-10-20', faelligkeit: '2026-11-30',
  }, 'Angelo');
  assert.equal(mail.an, 'info@muster.ch');
  assert.equal(mail.betreff, 'Erinnerung – Muster AG: Belege Q3 einfordern');
  assert.match(mail.text, /^Guten Tag Herr Muster/);
  assert.match(mail.text, /seit dem 20\.10\.2026/);
  assert.match(mail.text, /Frist 30\.11\.2026/);
  assert.match(mail.text, /Angelo$/);
});

test('Erinnerung ohne Mandant/Person bleibt neutral', () => {
  const mail = baueErinnerung({ titel: 'Rückmeldung Steueramt' }, '');
  assert.equal(mail.an, '');
  assert.equal(mail.betreff, 'Erinnerung – Rückmeldung Steueramt');
  assert.match(mail.text, /^Guten Tag\n/);
});

test('Cockpit zeigt die Wochenziele der laufenden Woche', () => {
  const basis = { status: 'Offen', prioritaet: 'B', faelligkeit: '2026-12-31', bearbeiter_id: 1, teilaufgaben_gesamt: 0, zuletzt_geaendert_am: '2026-11-03T08:00:00Z' };
  const liste = [
    { ...basis, id: 1, wochenziel_woche: '2026-11-02' },
    { ...basis, id: 2, wochenziel_woche: '2026-11-09' }, // nächste Woche
    { ...basis, id: 3, wochenziel_woche: null },
  ];
  const { wochenziele } = berechneCockpit(liste, { heute: '2026-11-04', jetzt: new Date('2026-11-04T10:00:00Z'), ichId: 1 });
  assert.deepEqual(wochenziele.map((p) => p.id), [1]);
});
