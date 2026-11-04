import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aufwandSumme, formatiereStunden } from '../src/constants.js';

test('Aufwand-Summe zählt Minuten und Pendenzen ohne Schätzung', () => {
  assert.deepEqual(aufwandSumme([]), { minuten: 0, ohne: 0 });
  assert.deepEqual(aufwandSumme([
    { aufwand_minuten: 30 }, { aufwand_minuten: 120 }, { aufwand_minuten: null }, {},
  ]), { minuten: 150, ohne: 2 });
});

test('Projekt-Köpfe zählen nicht als «ohne Schätzung»', () => {
  assert.deepEqual(aufwandSumme([
    { aufwand_minuten: null, teilaufgaben_gesamt: 3 }, { aufwand_minuten: 60, uebergeordnete_pendenz_id: 1 },
  ]), { minuten: 60, ohne: 0 });
});

test('Gesamtzeit in Stunden bzw. Minuten', () => {
  assert.equal(formatiereStunden(45), '45 Min.');
  assert.equal(formatiereStunden(60), '1 h');
  assert.equal(formatiereStunden(270), '4.5 h'); // Schweizer Format mit Dezimalpunkt (de-CH)
  assert.equal(formatiereStunden(0), '0 Min.');
});
