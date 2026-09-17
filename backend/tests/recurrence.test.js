import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPeriodKey,
  nextPeriodKey,
  previousPeriodKey,
  periodStart,
  periodEnd,
  berechneFaelligkeiten,
  rendereTitel,
  naechstePendenzen,
  toISODate,
  addMonths,
} from '../src/recurrence.js';

describe('getPeriodKey', () => {
  test('monatlich', () => {
    assert.equal(getPeriodKey('monatlich', new Date(Date.UTC(2026, 0, 15))), '2026-01');
    assert.equal(getPeriodKey('monatlich', new Date(Date.UTC(2026, 11, 1))), '2026-12');
  });

  test('quartalsweise ordnet jeden Monat dem richtigen Quartal zu', () => {
    assert.equal(getPeriodKey('quartalsweise', new Date(Date.UTC(2026, 0, 1))), '2026-Q1');
    assert.equal(getPeriodKey('quartalsweise', new Date(Date.UTC(2026, 2, 31))), '2026-Q1');
    assert.equal(getPeriodKey('quartalsweise', new Date(Date.UTC(2026, 3, 1))), '2026-Q2');
    assert.equal(getPeriodKey('quartalsweise', new Date(Date.UTC(2026, 9, 1))), '2026-Q4');
  });

  test('halbjaehrlich', () => {
    assert.equal(getPeriodKey('halbjaehrlich', new Date(Date.UTC(2026, 5, 30))), '2026-H1');
    assert.equal(getPeriodKey('halbjaehrlich', new Date(Date.UTC(2026, 6, 1))), '2026-H2');
  });

  test('jaehrlich', () => {
    assert.equal(getPeriodKey('jaehrlich', new Date(Date.UTC(2026, 5, 1))), '2026');
  });
});

describe('nextPeriodKey / previousPeriodKey ueber Jahreswechsel', () => {
  test('monatlich Dezember -> Januar Folgejahr', () => {
    assert.equal(nextPeriodKey('monatlich', '2025-12'), '2026-01');
    assert.equal(previousPeriodKey('monatlich', '2026-01'), '2025-12');
  });

  test('quartalsweise Q4 -> Q1 Folgejahr', () => {
    assert.equal(nextPeriodKey('quartalsweise', '2025-Q4'), '2026-Q1');
    assert.equal(previousPeriodKey('quartalsweise', '2026-Q1'), '2025-Q4');
  });

  test('halbjaehrlich H2 -> H1 Folgejahr', () => {
    assert.equal(nextPeriodKey('halbjaehrlich', '2025-H2'), '2026-H1');
  });

  test('jaehrlich', () => {
    assert.equal(nextPeriodKey('jaehrlich', '2025'), '2026');
    assert.equal(previousPeriodKey('jaehrlich', '2026'), '2025');
  });
});

describe('periodStart / periodEnd', () => {
  test('quartalsweise Q1 2026 umfasst Januar bis Maerz', () => {
    assert.equal(toISODate(periodStart('quartalsweise', '2026-Q1')), '2026-01-01');
    assert.equal(toISODate(periodEnd('quartalsweise', '2026-Q1')), '2026-03-31');
  });

  test('Monatsende Februar im Schaltjahr 2028', () => {
    assert.equal(toISODate(periodEnd('monatlich', '2028-02')), '2028-02-29');
  });

  test('Monatsende Februar im Nicht-Schaltjahr 2026', () => {
    assert.equal(toISODate(periodEnd('monatlich', '2026-02')), '2026-02-28');
  });
});

describe('addMonths mit Monatsende-Clamping', () => {
  test('31. Januar + 1 Monat faellt auf letzten Tag Februar (Nicht-Schaltjahr)', () => {
    assert.equal(toISODate(addMonths(new Date(Date.UTC(2026, 0, 31)), 1)), '2026-02-28');
  });

  test('31. Januar + 1 Monat faellt auf letzten Tag Februar (Schaltjahr)', () => {
    assert.equal(toISODate(addMonths(new Date(Date.UTC(2028, 0, 31)), 1)), '2028-02-29');
  });
});

describe('berechneFaelligkeiten: tag_des_monats', () => {
  test('Lohnlauf am 25. eines regulaeren Monats', () => {
    const rule = { rhythmus: 'monatlich', faelligkeit_typ: 'tag_des_monats', faelligkeit_config: { tag: 25 } };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2026-04');
    assert.equal(toISODate(faelligkeit), '2026-04-25');
  });

  test('Tag 31 wird im Februar auf den letzten Tag begrenzt', () => {
    const rule = { rhythmus: 'monatlich', faelligkeit_typ: 'tag_des_monats', faelligkeit_config: { tag: 31 } };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2026-02');
    assert.equal(toISODate(faelligkeit), '2026-02-28');
  });
});

describe('berechneFaelligkeiten: letzter_tag_des_monats', () => {
  test('Februar im Schaltjahr', () => {
    const rule = { rhythmus: 'monatlich', faelligkeit_typ: 'letzter_tag_des_monats', faelligkeit_config: {} };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2028-02');
    assert.equal(toISODate(faelligkeit), '2028-02-29');
  });

  test('Februar im Nicht-Schaltjahr', () => {
    const rule = { rhythmus: 'monatlich', faelligkeit_typ: 'letzter_tag_des_monats', faelligkeit_config: {} };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2026-02');
    assert.equal(toISODate(faelligkeit), '2026-02-28');
  });

  test('April (30 Tage)', () => {
    const rule = { rhythmus: 'monatlich', faelligkeit_typ: 'letzter_tag_des_monats', faelligkeit_config: {} };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2026-04');
    assert.equal(toISODate(faelligkeit), '2026-04-30');
  });
});

describe('berechneFaelligkeiten: tage_nach_periodenende (MWST-Logik)', () => {
  test('60 Tage nach Ende Q1 2026 (31.03.) liegt im Mai', () => {
    const rule = {
      rhythmus: 'quartalsweise', faelligkeit_typ: 'tage_nach_periodenende', faelligkeit_config: { tage: 60 },
    };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2026-Q1');
    assert.equal(toISODate(faelligkeit), '2026-05-30');
  });

  test('60 Tage nach Ende Q4 2025 (31.12.) liegt im Folgejahr', () => {
    const rule = {
      rhythmus: 'quartalsweise', faelligkeit_typ: 'tage_nach_periodenende', faelligkeit_config: { tage: 60 },
    };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2025-Q4');
    assert.equal(toISODate(faelligkeit), '2026-03-01');
  });
});

describe('berechneFaelligkeiten: tag_monat_folgejahr (Jahresabschluss-Logik)', () => {
  test('30.06. des Folgejahres fuer Geschaeftsjahr 2026', () => {
    const rule = {
      rhythmus: 'jaehrlich', faelligkeit_typ: 'tag_monat_folgejahr',
      faelligkeit_config: { tag: 30, monat: 6, jahre_offset: 1 },
    };
    const [{ faelligkeit }] = berechneFaelligkeiten(rule, '2026');
    assert.equal(toISODate(faelligkeit), '2027-06-30');
  });
});

describe('berechneFaelligkeiten: tage_des_monats_liste (Zahlungslauf zweimal monatlich)', () => {
  test('liefert zwei Faelligkeiten mit unterschiedlichem Periodenschluessel', () => {
    const rule = {
      rhythmus: 'monatlich', faelligkeit_typ: 'tage_des_monats_liste', faelligkeit_config: { tage: [15, 28] },
    };
    const ergebnisse = berechneFaelligkeiten(rule, '2026-04');
    assert.equal(ergebnisse.length, 2);
    assert.equal(toISODate(ergebnisse[0].faelligkeit), '2026-04-15');
    assert.equal(toISODate(ergebnisse[1].faelligkeit), '2026-04-28');
    assert.equal(ergebnisse[0].periodKey, '2026-04#0');
    assert.equal(ergebnisse[1].periodKey, '2026-04#1');
  });
});

describe('rendereTitel', () => {
  test('ersetzt Monat, Quartal und Jahr', () => {
    assert.equal(rendereTitel('Lohnlauf {Monat} {Jahr}', 'monatlich', '2026-03'), 'Lohnlauf Maerz 2026');
    assert.equal(rendereTitel('MWST-Abrechnung {Quartal} {Jahr}', 'quartalsweise', '2026-Q3'), 'MWST-Abrechnung Q3 2026');
  });

  test('nutzt bei Jahresabschluss das Geschaeftsjahr der Periode, nicht das Faelligkeitsjahr', () => {
    // Fälligkeit liegt im Folgejahr, der Titel soll aber das Geschaeftsjahr zeigen.
    assert.equal(rendereTitel('Jahresabschluss {Jahr}', 'jaehrlich', '2026'), 'Jahresabschluss 2026');
  });

  test('funktioniert mit Periodenschluessel-Suffix (#0/#1)', () => {
    assert.equal(rendereTitel('Zahlungslauf {Monat} {Jahr}', 'monatlich', '2026-04#1'), 'Zahlungslauf April 2026');
  });
});

describe('naechstePendenzen (Regel-Vorschau)', () => {
  test('liefert die naechsten 3 Termine in korrekter Reihenfolge', () => {
    const rule = {
      titel_vorlage: 'Lohnlauf {Monat} {Jahr}', rhythmus: 'monatlich',
      faelligkeit_typ: 'tag_des_monats', faelligkeit_config: { tag: 25 }, vorlauf_tage: 7,
    };
    const ergebnisse = naechstePendenzen(rule, new Date(Date.UTC(2026, 0, 1)), 3);
    assert.equal(ergebnisse.length, 3);
    assert.deepEqual(ergebnisse.map((e) => e.faelligkeit), ['2026-01-25', '2026-02-25', '2026-03-25']);
    assert.equal(ergebnisse[0].titel, 'Lohnlauf Januar 2026');
    assert.equal(ergebnisse[0].erscheintAb, '2026-01-18');
  });

  test('zaehlt Mehrfach-Faelligkeiten pro Periode korrekt (Zahlungslauf)', () => {
    const rule = {
      titel_vorlage: 'Zahlungslauf {Monat} {Jahr}', rhythmus: 'monatlich',
      faelligkeit_typ: 'tage_des_monats_liste', faelligkeit_config: { tage: [15, 28] }, vorlauf_tage: 3,
    };
    const ergebnisse = naechstePendenzen(rule, new Date(Date.UTC(2026, 0, 1)), 3);
    assert.deepEqual(ergebnisse.map((e) => e.faelligkeit), ['2026-01-15', '2026-01-28', '2026-02-15']);
  });
});
