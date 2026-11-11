import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belegStatus, durchschnittFrist, liquiditaetsplan, montag } from '../src/lib/liquiditaet.js';

const heute = '2026-11-11'; // Mittwoch

test('Status eines Belegs', () => {
  assert.equal(belegStatus({ bezahlt_am: '2026-11-01', faelligkeit: '2026-10-01' }, heute), 'bezahlt');
  assert.equal(belegStatus({ faelligkeit: '2026-11-10' }, heute), 'ueberfaellig');
  assert.equal(belegStatus({ faelligkeit: heute }, heute), 'offen');
  assert.equal(belegStatus({}, heute), 'offen');
});

test('Durchschnittliche Frist nach Betrag gewichtet', () => {
  assert.equal(durchschnittFrist([
    { rechnungsdatum: '2026-11-01', faelligkeit: '2026-12-01', betrag: 3000 }, // 30 Tage
    { rechnungsdatum: '2026-11-01', faelligkeit: '2026-11-11', betrag: 1000 }, // 10 Tage
  ]), 25);
  assert.equal(durchschnittFrist([{ rechnungsdatum: null, faelligkeit: '2026-11-11' }]), null);
});

test('Montag der Woche', () => {
  assert.equal(montag(heute), '2026-11-09');
  assert.equal(montag('2026-11-15'), '2026-11-09');
});

test('Liquiditätsplan pro Woche', () => {
  const belege = [
    { art: 'debitor', betrag: 5000, faelligkeit: '2026-11-13' },          // diese Woche
    { art: 'kreditor', betrag: 2000, faelligkeit: '2026-11-18' },         // nächste Woche
    { art: 'kreditor', betrag: 500, faelligkeit: '2026-11-05' },          // überfällig
    { art: 'debitor', betrag: 1000, faelligkeit: '2026-11-12', bezahlt_am: '2026-11-10' }, // bezahlt
    { art: 'debitor', betrag: 800, faelligkeit: null },                   // ohne Datum
    { art: 'kreditor', betrag: 300, faelligkeit: '2026-11-20', waehrung: 'EUR' }, // Fremdwährung
    { art: 'debitor', betrag: 9000, faelligkeit: '2027-06-01' },          // nach dem Plan
  ];
  const plan = liquiditaetsplan(belege, { heute, start: 10000, perioden: 3 });
  assert.deepEqual(plan.ueberfaellig, { zufluss: 0, abfluss: 500 });
  assert.equal(plan.standNachUeberfaellig, 9500);
  assert.deepEqual(plan.zeilen.map((z) => [z.von, z.zufluss, z.abfluss, z.stand]), [
    [heute, 5000, 0, 14500],
    ['2026-11-16', 0, 2000, 12500],
    ['2026-11-23', 0, 0, 12500],
  ]);
  assert.equal(plan.ohneDatum, 800);
  assert.equal(plan.spaeter, 9000);
  assert.equal(plan.fremdwaehrung.length, 1);
  assert.equal(plan.tiefsterStand, 9500);
});

test('Liquiditätsplan pro Monat', () => {
  const plan = liquiditaetsplan([{ art: 'kreditor', betrag: 100, faelligkeit: '2026-12-31' }], { heute, start: 0, perioden: 2, einheit: 'monat' });
  assert.deepEqual(plan.zeilen.map((z) => [z.von, z.bis, z.abfluss]), [[heute, '2026-11-30', 0], ['2026-12-01', '2026-12-31', 100]]);
});

import { buchhaltungsMandant, belegOrdner, belegDateiname } from '../src/lib/belege.js';

test('Ablage und Dateiname der Belege', () => {
  const mandanten = [{ id: 1, name: 'A AG' }, { id: 4, name: 'EST Controlling GmbH', ablage_ordner: 'EST' }];
  assert.equal(buchhaltungsMandant({}, mandanten).id, 4);
  assert.equal(buchhaltungsMandant({ mandantId: 1 }, mandanten).id, 1);
  const m = mandanten[1];
  assert.deepEqual(belegOrdner({ art: 'kreditor', datum: '2026-11-03' }, {}, m, {}), ['EST', 'Kreditoren', '2026']);
  assert.deepEqual(belegOrdner({ art: 'debitor', datum: null }, { ordnerDebitoren: 'Buchhaltung/Debi', proJahr: false }, m, {}), ['EST', 'Buchhaltung', 'Debi']);
  assert.equal(belegOrdner({ art: 'kreditor' }, {}, mandanten[0], {}), null);
  assert.equal(belegDateiname({ rechnungsdatum: '2026-11-03', partner: 'Swisscom (Schweiz) AG', rechnungsnummer: '12/34' }, 'scan.PDF'), '2026-11-03 Swisscom (Schweiz) AG 12 34.pdf');
  assert.equal(belegDateiname({}, 'x.pdf'), 'x.pdf');
});

import { mandantZuPartner, rechnungPlatzhalter, RECHNUNG_VORLAGE } from '../src/lib/belege.js';
import { textErsetzen } from '../src/lib/offerte.js';

test('Rechnungs-Mail: Mandant finden und Platzhalter', () => {
  const mandanten = [{ id: 1, name: 'A4 Personal AG', ansprechperson: 'Herr Lucente' }, { id: 2, name: 'Bad Ideen GmbH' }];
  assert.equal(mandantZuPartner('A4 Personal', mandanten).id, 1);
  assert.equal(mandantZuPartner('Bäd Ideen GmbH', mandanten).id, 2); // Akzente egal
  assert.equal(mandantZuPartner('Bad Ideen', mandanten).id, 2);
  assert.equal(mandantZuPartner('Unbekannt AG', mandanten), null);
  const p = rechnungPlatzhalter({ partner: 'A4 Personal AG', rechnungsnummer: 'R-12', rechnungsdatum: '2026-11-01', faelligkeit: '2026-12-01', betrag: 1250.5, waehrung: 'CHF' }, mandanten[0], { firma: 'estcontrolling GmbH' });
  const text = textErsetzen(RECHNUNG_VORLAGE.mailText, p);
  assert.match(text, /^Guten Tag Herr Lucente/);
  assert.match(text, /Rechnung Nr. R-12 vom 01.11.2026 über CHF 1.250.50./);
  assert.match(text, /innert 10 Tagen mit dem beiliegenden QR-Einzahlungsschein/);
  assert.equal(textErsetzen(RECHNUNG_VORLAGE.mailBetreff, p), 'Rechnung R-12 – estcontrolling GmbH');
});
