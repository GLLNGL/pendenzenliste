import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionAusLeistung, positionAusModul, dokumentZeilen, totale, planung, naechsteNummer,
  pauschalenAusOfferte, textErsetzen, chf,
} from '../src/lib/offerte.js';

const ansaetze = [{ id: 1, chf_pro_stunde: 130, ist_standard: true }];
const fibu = { id: 1, name: 'Finanzbuchhaltung (Standard)', einheit: 'Beleg', turnus: 'monatlich', preis_art: 'zeit', minuten_pro_einheit: 3, stundenansatz_id: 1 };
const abschluss = { id: 5, name: 'Jahresabschluss (ordentlich)', einheit: 'Std.', turnus: 'jaehrlich', preis_art: 'zeit', minuten_pro_einheit: 60, stundenansatz_id: 1 };
const lohn = { id: 3, name: 'Lohnbuchhaltung', einheit: 'MA', turnus: 'monatlich', preis_art: 'fix', festpreis_pro_einheit: 35, angebot_gruppe: 'Lohnbuchhaltung (inkl. Lohnausweise)' };
const ausweis = { id: 4, name: 'Lohnausweise', einheit: 'MA', turnus: 'jaehrlich', preis_art: 'fix', festpreis_pro_einheit: 50, angebot_gruppe: 'Lohnbuchhaltung (inkl. Lohnausweise)' };

// Beispiel "Inparo GmbH" aus dem Excel (Angebot A-2026-01).
const positionen = [
  positionAusLeistung(fibu, ansaetze, 80), positionAusLeistung(abschluss, ansaetze, 12),
  positionAusLeistung(lohn, ansaetze, 2), positionAusLeistung(ausweis, ansaetze, 2),
  positionAusModul({ id: 4, name: 'Fibu/Kredi 2 <2500', chf_pro_monat: 105 }),
  positionAusModul({ id: 6, name: 'Lohnbuchhaltung S', chf_pro_monat: 85 }),
  positionAusModul({ id: 7, name: 'Electronic Banking', chf_pro_monat: 25 }),
];
const offerte = { rabatt_prozent: 10, mwst_pflichtig: true, mwst_satz: 8.1 };

test('Dokumentzeilen wie im Excel-Angebot', () => {
  const { leistungen, lizenzen } = dokumentZeilen(positionen);
  assert.deepEqual(leistungen.map((z) => [z.pos, z.bezeichnung, z.menge, z.einheit, z.ePreis]), [
    [1, 'Finanzbuchhaltung (Standard)', 80, 'Beleg', 6.5],
    [2, 'Jahresabschluss (ordentlich)', 12, 'Std.', 130],
    [3, 'Lohnbuchhaltung (inkl. Lohnausweise)', 2, 'MA', null],
  ]);
  assert.equal(Math.round(leistungen[2].gPreis * 100) / 100, 78.33);
  assert.deepEqual(lizenzen.map((z) => [z.pos, z.gPreis]), [[4, 105], [5, 85], [6, 25]]);
});

test('Totale wie im Excel-Angebot', () => {
  const t = totale(positionen, offerte);
  const r = (z) => Math.round(z * 100) / 100;
  assert.equal(r(t.netto), 943.33);
  assert.equal(r(t.rabatt), 94.33);
  assert.equal(r(t.nettoNachRabatt), 849);
  assert.equal(r(t.mwst), 68.77);
  assert.equal(r(t.total), 917.77);
  assert.equal(totale(positionen, { ...offerte, mwst_pflichtig: false }).mwst, 0);
});

test('Planzeit und Satz pro Planstunde', () => {
  const p = planung(positionen, offerte);
  assert.equal(p.minuten, 300); // 80 x 3 + 12 x 60 / 12
  assert.equal(p.ohneZeit, 2);
  assert.equal(Math.round(p.satz), 117); // (520 + 130) x 0.9 / 5 h
});

test('Nummer, Pauschalen, Texte, CHF-Format', () => {
  assert.equal(naechsteNummer([], 2026), 'A-2026-01');
  assert.equal(naechsteNummer([{ nummer: 'A-2026-07' }, { nummer: 'A-2025-12' }], 2026), 'A-2026-08');
  const pauschalen = pauschalenAusOfferte(offerte, positionen);
  assert.equal(pauschalen.length, 7);
  assert.deepEqual(pauschalen[0], { leistung_id: 1, abacus_modul_id: null, menge: 80, betrag_monat: 468 });
  assert.deepEqual(pauschalen[4], { leistung_id: null, abacus_modul_id: 4, menge: 1, betrag_monat: 94.5 });
  assert.equal(textErsetzen('Angebot {nummer} für {mandant}{x}', { nummer: 'A-1', mandant: 'X' }), 'Angebot A-1 für X');
  assert.equal(chf(1234.5), "CHF 1'234.50");
  assert.equal(chf(-94.333), '-CHF 94.33');
});

test('Standardmenge der Leistung als Vorschlag', () => {
  const mwst = { id: 15, name: 'MWST-Abrechnung effektiv (komplex)', einheit: 'Abrechnung', turnus: 'jaehrlich', preis_art: 'zeit', minuten_pro_einheit: 180, stundenansatz_id: 1, standard_menge: 4 };
  const ansaetze = [{ id: 1, chf_pro_stunde: 130 }];
  assert.equal(positionAusLeistung(mwst, ansaetze).menge, '4');
  assert.equal(positionAusLeistung(mwst, ansaetze, 2).menge, 2);
  assert.equal(positionAusLeistung(mwst, ansaetze).preis_pro_einheit, 390);
  assert.equal(positionAusLeistung({ ...mwst, standard_menge: null }, ansaetze).menge, '');
});
