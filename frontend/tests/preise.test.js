import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  preisProEinheit, listenpreisMonat, planMinutenMonat, effektiverSatz,
  naechsteKundenNr, aktivePauschalen, pauschalenSumme,
} from '../src/lib/preise.js';

const ansaetze = [{ id: 1, chf_pro_stunde: '130.00' }, { id: 2, chf_pro_stunde: 90 }];
const fibu = { preis_art: 'zeit', minuten_pro_einheit: 3, stundenansatz_id: 1, turnus: 'monatlich' };
const abschluss = { preis_art: 'zeit', minuten_pro_einheit: 60, stundenansatz_id: 1, turnus: 'jaehrlich' };
const lohn = { preis_art: 'fix', festpreis_pro_einheit: 35, minuten_pro_einheit: null, turnus: 'monatlich' };
const lohnausweis = { preis_art: 'fix', festpreis_pro_einheit: 50, turnus: 'jaehrlich' };
const kredi = { preis_art: 'zeit', minuten_pro_einheit: 3, stundenansatz_id: 2, turnus: 'monatlich' };

test('Preis pro Einheit wie im Excel', () => {
  assert.equal(preisProEinheit(fibu, ansaetze), 6.5);
  assert.equal(preisProEinheit(kredi, ansaetze), 4.5);
  assert.equal(preisProEinheit(lohn, ansaetze), 35);
  assert.equal(preisProEinheit({ ...fibu, stundenansatz_id: 99 }, ansaetze), null);
});

test('Listenpreis pro Monat (Beispiel Inparo aus dem Excel: 728.33)', () => {
  const summe = listenpreisMonat(fibu, 80, ansaetze) + listenpreisMonat(abschluss, 12, ansaetze)
    + listenpreisMonat(lohn, 2, ansaetze) + listenpreisMonat(lohnausweis, 2, ansaetze);
  assert.equal(listenpreisMonat(fibu, 80, ansaetze), 520);
  assert.equal(listenpreisMonat(abschluss, 12, ansaetze), 130);
  assert.equal(Math.round(summe * 100) / 100, 728.33);
  assert.equal(listenpreisMonat(fibu, '', ansaetze), null);
});

test('Planzeit und effektiver Satz', () => {
  assert.equal(planMinutenMonat(fibu, 80), 240);
  assert.equal(planMinutenMonat(abschluss, 12), 60);
  assert.equal(planMinutenMonat(lohn, 2), null);
  assert.equal(effektiverSatz(468, 240), 117);
  assert.equal(effektiverSatz(100, 0), null);
});

test('Nächste Kunden-Nr.', () => {
  assert.equal(naechsteKundenNr([]), 'M-001');
  assert.equal(naechsteKundenNr([{ kunden_nr: 'M-004' }, { kunden_nr: null }, { kunden_nr: 'X-9' }]), 'M-005');
});

test('Aktive Pauschalen und Summe', () => {
  const liste = [
    { gueltig_ab: '2026-01-01', gueltig_bis: null, betrag_monat: '468.00' },
    { gueltig_ab: '2025-01-01', gueltig_bis: '2025-12-31', betrag_monat: 300 },
    { gueltig_ab: '2027-01-01', gueltig_bis: null, betrag_monat: 50 },
  ];
  const aktiv = aktivePauschalen(liste, '2026-11-06');
  assert.equal(aktiv.length, 1);
  assert.equal(pauschalenSumme(aktiv), 468);
});
