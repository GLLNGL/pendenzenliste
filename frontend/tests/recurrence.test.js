import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naechstePendenzen, faelligeVorkommen, erscheintAb } from '../src/lib/recurrence.js';
import { vorlageFuerTyp } from '../src/lib/regelVorlagen.js';

function regel(felder) {
  return { titel_vorlage: 'Test {Datum}', vorlauf_tage: 0, vorlauf_einheit: 'tage', faelligkeit_config: {}, ...felder };
}

const ab = (iso) => new Date(`${iso}T00:00:00Z`);

test('monatliche Schlüssel bleiben wie bisher ("2026-11")', () => {
  const r = regel({ titel_vorlage: 'Lohnlauf {Monat} {Jahr}', rhythmus: 'monatlich', faelligkeit_typ: 'tag_des_monats', faelligkeit_config: { tag: 25 } });
  const [v] = naechstePendenzen(r, ab('2026-11-04'), 1);
  assert.deepEqual(v, { periodenSchluessel: '2026-11', faelligkeit: '2026-11-25', erscheintAb: '2026-11-25', titel: 'Lohnlauf November 2026' });
});

test('wöchentlich am Freitag, Titel mit Datum', () => {
  const r = regel({ titel_vorlage: 'Zahlungslauf {Datum} ausführen', rhythmus: 'woechentlich', faelligkeit_typ: 'wochentag', faelligkeit_config: { wochentag: 5 } });
  const liste = naechstePendenzen(r, ab('2026-11-04'), 2);
  assert.deepEqual(liste.map((v) => [v.periodenSchluessel, v.faelligkeit, v.titel]), [
    ['2026-11-02', '2026-11-06', 'Zahlungslauf 06.11.2026 ausführen'],
    ['2026-11-09', '2026-11-13', 'Zahlungslauf 13.11.2026 ausführen'],
  ]);
});

test('14-täglich ab Anker-Montag', () => {
  const r = regel({ rhythmus: '14-taeglich', faelligkeit_typ: 'wochentag', faelligkeit_config: { wochentag: 4, anker: '2026-11-02' } });
  const liste = naechstePendenzen(r, ab('2026-11-04'), 3);
  assert.deepEqual(liste.map((v) => v.faelligkeit), ['2026-11-05', '2026-11-19', '2026-12-03']);
});

test('Vorlauf in Arbeitstagen überspringt das Wochenende', () => {
  // Montag 09.11.2026, 2 Arbeitstage vorher = Donnerstag 05.11.2026
  assert.equal(erscheintAb({ vorlauf_tage: 2, vorlauf_einheit: 'arbeitstage' }, '2026-11-09'), '2026-11-05');
  assert.equal(erscheintAb({ vorlauf_tage: 7, vorlauf_einheit: 'tage' }, '2026-11-25'), '2026-11-18');
});

test('Erzeugen für nächste Woche: alles, was bis Freitag nächster Woche erscheint', () => {
  // Heute Mi 04.11.2026, Stichtag Fr 13.11.2026. Lohnlauf am 25., 7 Tage Vorlauf -> erscheint 18.11.: noch nicht.
  const lohn = regel({ titel_vorlage: 'Lohnlauf {Monat}', rhythmus: 'monatlich', faelligkeit_typ: 'tag_des_monats', faelligkeit_config: { tag: 25 }, vorlauf_tage: 7 });
  assert.deepEqual(faelligeVorkommen(lohn, '2026-11-04', '2026-11-13').map((v) => v.faelligkeit), []);
  // Mit 14 Tagen Vorlauf erscheint er am 11.11. -> wird erzeugt.
  assert.deepEqual(faelligeVorkommen({ ...lohn, vorlauf_tage: 14 }, '2026-11-04', '2026-11-13').map((v) => v.faelligkeit), ['2026-11-25']);
});

test('Erzeugen trägt nichts Überfälliges nach (keine Altlasten)', () => {
  const zahlung = regel({ rhythmus: 'woechentlich', faelligkeit_typ: 'wochentag', faelligkeit_config: { wochentag: 5 }, vorlauf_tage: 2, vorlauf_einheit: 'arbeitstage' });
  const daten = faelligeVorkommen(zahlung, '2026-11-04', '2026-11-13').map((v) => v.faelligkeit);
  // 30.10. ist schon vorbei, 06.11. erscheint am 04.11. (heute), 13.11. am 11.11.
  assert.deepEqual(daten, ['2026-11-06', '2026-11-13']);
  // Am Fälligkeitstag selbst wird noch erzeugt.
  assert.deepEqual(faelligeVorkommen(zahlung, '2026-11-06', '2026-11-06').map((v) => v.faelligkeit), ['2026-11-06']);
});

test('MWST quartalsweise: 60 Tage nach Quartalsende, 3 Wochen Vorlauf', () => {
  const v = vorlageFuerTyp('MWST', { mwst_periode: 'Quartal' });
  const r = regel({ titel_vorlage: v.titelVorlage, rhythmus: v.rhythmus, faelligkeit_typ: v.faelligkeitTyp, faelligkeit_config: v.faelligkeitConfig, vorlauf_tage: v.vorlaufTage });
  const [q3] = naechstePendenzen(r, ab('2026-07-01'), 1);
  assert.equal(q3.faelligkeit, '2026-11-29'); // 30.09. + 60 Tage
  assert.equal(q3.erscheintAb, '2026-11-08');
  assert.equal(q3.titel, 'MWST-Abrechnung Q3 2026 einreichen');
});

test('Vorlagen übernehmen die Mandats-Eckdaten', () => {
  assert.deepEqual(vorlageFuerTyp('Lohnlauf', { lohnzahltag: 20 }).faelligkeitConfig, { tag: 20 });
  assert.equal(vorlageFuerTyp('MWST', { mwst_periode: 'Semester' }).rhythmus, 'halbjaehrlich');
  assert.equal(vorlageFuerTyp('Zahlungslauf', { zahlungslauf_rhythmus: '14-taeglich' }).rhythmus, '14-taeglich');
  const abschluss = vorlageFuerTyp('Jahresabschluss', { abschluss_wunsch_tag: 31, abschluss_wunsch_monat: 5 });
  assert.deepEqual(abschluss.faelligkeitConfig, { tag: 31, monat: 5, jahre_offset: 1 });
  assert.equal(abschluss.vorlaufTage, 49);
  assert.equal(vorlageFuerTyp('Zahlungslauf', null).vorlaufEinheit, 'arbeitstage');
  assert.ok(vorlageFuerTyp('Lohnlauf', null).checkliste.length > 0);
});
