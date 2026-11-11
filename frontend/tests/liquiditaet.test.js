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
  assert.equal(plan.ueberfaellig.abfluss, 500);
  // Überfälliges ist nicht im Liq. Stand, nur im theoretischen Stand.
  assert.deepEqual(plan.zeilen.map((z) => [z.von, z.zufluss, z.abfluss, z.stand, z.theoretisch]), [
    [heute, 5000, 0, 15000, 14500],
    ['2026-11-16', 0, 2000, 13000, 12500],
    ['2026-11-23', 0, 0, 13000, 12500],
  ]);
  assert.equal(plan.ohneDatum, 800);
  assert.equal(plan.spaeter, 9000);
  assert.equal(plan.fremdwaehrung.length, 1);
  assert.equal(plan.tiefsterStand, 10000);
  assert.equal(plan.ueberfaellig.kreditoren[0].bezahlbarAb, 'sofort');
});

test('Liquiditätsplan: überfällige Kreditoren – bezahlbar ab', () => {
  const belege = [
    { art: 'kreditor', partner: 'Customize AG', betrag: 3297.05, faelligkeit: '2026-11-06' },
    { art: 'debitor', betrag: 7262.75, faelligkeit: '2026-12-01' },
    { art: 'kreditor', betrag: 1913.35, faelligkeit: '2026-12-02' },
  ];
  const plan = liquiditaetsplan(belege, { heute, start: 194.44, perioden: 5 });
  assert.equal(plan.engpass, null); // ohne das Überfällige kein Engpass
  assert.ok(plan.tiefsterTheoretisch < 0); // theoretisch im Minus
  assert.deepEqual(plan.ueberfaellig.kreditoren.map((k) => [k.partner, k.bezahlbarAb]), [['Customize AG', 'KW ab 30.11.']]);
  const zuWenig = liquiditaetsplan([belege[0]], { heute, start: 100, perioden: 3 });
  assert.equal(zuWenig.ueberfaellig.kreditoren[0].bezahlbarAb, null);
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

test('Liquiditätsplan: bezahlte Rechnungen nach dem Stichtag des Kontostands', () => {
  const belege = [
    { art: 'kreditor', betrag: 1000, faelligkeit: '2026-12-15', bezahlt_am: '2026-11-10' }, // vor Fälligkeit bezahlt, nach Stichtag
    { art: 'debitor', betrag: 300, faelligkeit: '2026-11-30', bezahlt_am: '2026-11-11' },   // heute eingegangen
    { art: 'kreditor', betrag: 200, faelligkeit: '2026-11-20', bezahlt_am: '2026-11-08' },  // vor Stichtag -> im Kontostand
    { art: 'kreditor', betrag: 50, faelligkeit: '2026-12-01', bezahlt_am: '2026-11-17' },   // Zahlungsauftrag mit künftigem Datum
  ];
  const plan = liquiditaetsplan(belege, { heute, start: 5000, perioden: 2, kontostandDatum: '2026-11-09' });
  assert.deepEqual(plan.bezahltSeitStand, { zufluss: 300, ausgang: 1000, anzahl: 2 });
  assert.equal(plan.standNachBezahlt, 4300);
  assert.deepEqual(plan.zeilen.map((z) => [z.ausgang, z.stand]), [[0, 4300], [50, 4250]]);
  // Ohne Stichtag: bisherige Zahlungen gelten als im Kontostand enthalten.
  assert.equal(liquiditaetsplan(belege, { heute, start: 5000, perioden: 2 }).standNachBezahlt, 5000);
});

test('Liquiditätsplan: Zahlungslauf als Zahlungsausgang, nicht doppelt', () => {
  const belege = [
    { art: 'kreditor', betrag: 800, faelligkeit: '2026-12-10', zahlungslauf_id: 7 },  // im Lauf, Ausführung 13.11.
    { art: 'kreditor', betrag: 400, faelligkeit: '2026-11-20' },                      // offen, Fälligkeit
    { art: 'debitor', betrag: 1000, faelligkeit: '2026-11-18' },
  ];
  const plan = liquiditaetsplan(belege, { heute, start: 1000, perioden: 2, laeufe: [{ id: 7, ausfuehrungsdatum: '2026-11-13' }] });
  assert.deepEqual(plan.zeilen.map((z) => [z.zufluss, z.abfluss, z.ausgang, z.saldo, z.stand]), [
    [0, 0, 800, -800, 200],
    [1000, 400, 0, 600, 800],
  ]);
  assert.equal(plan.engpass, null);
  const knapp = liquiditaetsplan(belege, { heute, start: 500, perioden: 2, laeufe: [{ id: 7, ausfuehrungsdatum: '2026-11-13' }] });
  assert.equal(knapp.engpass.von, heute);
  assert.equal(knapp.tiefsterStand, -300);
});

test('Liquiditätsplan: Zahlung am Tag des Kontostands zählt (Stand vor den Zahlungen)', () => {
  const belege = [{ art: 'kreditor', betrag: 772.7, faelligkeit: '2026-11-30', bezahlt_am: heute }];
  const plan = liquiditaetsplan(belege, { heute, start: 3491.49, perioden: 1, kontostandDatum: heute });
  assert.deepEqual(plan.bezahltSeitStand, { zufluss: 0, ausgang: 772.7, anzahl: 1 });
  assert.equal(Math.round(plan.standNachBezahlt * 100) / 100, 2718.79);
  assert.equal(plan.zeilen[0].ausgang, 0); // nicht zusätzlich in der laufenden Woche
});
