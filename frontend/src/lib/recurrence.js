// Reine Funktionen für die Wiederkehr-Logik: Perioden, Fälligkeitsberechnung, Titel-Platzhalter.
// 1:1-Kopie von backend/src/recurrence.js -- reine Datumsarithmetik ohne DB-Zugriff, darum ohne
// Aenderung im Frontend weiterverwendbar (Regel-Vorschau). Alle Daten werden als UTC-Datumswerte
// (Mitternacht) gerechnet, damit Sommerzeit-Wechsel die Tagesarithmetik nicht verfälschen.

const MONATSNAMEN = [
  'Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const RHYTHMEN = ['monatlich', 'quartalsweise', 'halbjaehrlich', 'jaehrlich'];

const FAELLIGKEIT_TYPEN = [
  { typ: 'tag_des_monats', label: 'Tag des Monats', felder: ['tag'] },
  { typ: 'letzter_tag_des_monats', label: 'Letzter Tag des Monats', felder: [] },
  { typ: 'tage_nach_periodenende', label: 'X Tage nach Periodenende', felder: ['tage'] },
  { typ: 'tag_monat_folgejahr', label: 'Tag/Monat (mit Jahresversatz)', felder: ['tag', 'monat', 'jahre_offset'] },
  { typ: 'tage_des_monats_liste', label: 'Mehrere Tage im Monat', felder: ['tage'] },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISODate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function heutigesDatumUTC() {
  const jetzt = new Date();
  return new Date(Date.UTC(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()));
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const zielMonatErsterTag = new Date(Date.UTC(y, m + months, 1));
  const letzterTagZielmonat = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate();
  zielMonatErsterTag.setUTCDate(Math.min(d, letzterTagZielmonat));
  return zielMonatErsterTag;
}

function letzterTagDesMonats(jahr, monatIndex0) {
  return new Date(Date.UTC(jahr, monatIndex0 + 1, 0)).getUTCDate();
}

function getPeriodKey(rhythmus, date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  switch (rhythmus) {
    case 'monatlich':
      return `${y}-${pad2(m + 1)}`;
    case 'quartalsweise':
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'halbjaehrlich':
      return `${y}-H${m < 6 ? 1 : 2}`;
    case 'jaehrlich':
      return `${y}`;
    default:
      throw new Error(`Unbekannter Rhythmus: ${rhythmus}`);
  }
}

function parsePeriodKey(rhythmus, periodKey) {
  switch (rhythmus) {
    case 'monatlich': {
      const [y, m] = periodKey.split('-').map(Number);
      return { jahr: y, monatIndex0: m - 1 };
    }
    case 'quartalsweise': {
      const [y, q] = periodKey.split('-Q').map(Number);
      return { jahr: y, quartal: q, monatIndex0: (q - 1) * 3 };
    }
    case 'halbjaehrlich': {
      const [y, h] = periodKey.split('-H').map(Number);
      return { jahr: y, halbjahr: h, monatIndex0: h === 1 ? 0 : 6 };
    }
    case 'jaehrlich': {
      return { jahr: Number(periodKey), monatIndex0: 0 };
    }
    default:
      throw new Error(`Unbekannter Rhythmus: ${rhythmus}`);
  }
}

function periodenLaengeInMonaten(rhythmus) {
  switch (rhythmus) {
    case 'monatlich': return 1;
    case 'quartalsweise': return 3;
    case 'halbjaehrlich': return 6;
    case 'jaehrlich': return 12;
    default: throw new Error(`Unbekannter Rhythmus: ${rhythmus}`);
  }
}

function periodEnd(rhythmus, periodKey) {
  const { jahr, monatIndex0 } = parsePeriodKey(rhythmus, periodKey);
  const laenge = periodenLaengeInMonaten(rhythmus);
  return new Date(Date.UTC(jahr, monatIndex0 + laenge, 0));
}

function nextPeriodKey(rhythmus, periodKey) {
  const start = new Date(Date.UTC(parsePeriodKey(rhythmus, periodKey).jahr, parsePeriodKey(rhythmus, periodKey).monatIndex0, 1));
  const laenge = periodenLaengeInMonaten(rhythmus);
  const naechsterStart = addMonths(start, laenge);
  return getPeriodKey(rhythmus, naechsterStart);
}

function berechneFaelligkeiten(rule, periodKey) {
  const { rhythmus, faelligkeit_typ: typ, faelligkeit_config: config } = rule;
  const { jahr, monatIndex0 } = parsePeriodKey(rhythmus, periodKey);

  switch (typ) {
    case 'tag_des_monats': {
      const letzterTag = letzterTagDesMonats(jahr, monatIndex0);
      const tag = Math.min(config.tag, letzterTag);
      return [{ periodKey, faelligkeit: new Date(Date.UTC(jahr, monatIndex0, tag)) }];
    }
    case 'letzter_tag_des_monats': {
      const letzterTag = letzterTagDesMonats(jahr, monatIndex0);
      return [{ periodKey, faelligkeit: new Date(Date.UTC(jahr, monatIndex0, letzterTag)) }];
    }
    case 'tage_nach_periodenende': {
      const ende = periodEnd(rhythmus, periodKey);
      return [{ periodKey, faelligkeit: addDays(ende, config.tage) }];
    }
    case 'tag_monat_folgejahr': {
      const zielJahr = jahr + (config.jahre_offset ?? 0);
      const zielMonatIndex0 = config.monat - 1;
      const letzterTag = letzterTagDesMonats(zielJahr, zielMonatIndex0);
      const tag = Math.min(config.tag, letzterTag);
      return [{ periodKey, faelligkeit: new Date(Date.UTC(zielJahr, zielMonatIndex0, tag)) }];
    }
    case 'tage_des_monats_liste': {
      const letzterTag = letzterTagDesMonats(jahr, monatIndex0);
      return config.tage.map((tag, idx) => ({
        periodKey: `${periodKey}#${idx}`,
        faelligkeit: new Date(Date.UTC(jahr, monatIndex0, Math.min(tag, letzterTag))),
      }));
    }
    default:
      throw new Error(`Unbekannter Faelligkeitstyp: ${typ}`);
  }
}

function quartalVonMonatIndex0(monatIndex0) {
  return Math.floor(monatIndex0 / 3) + 1;
}

function rendereTitel(titelVorlage, rhythmus, periodKey) {
  const basisKey = periodKey.split('#')[0];
  const { jahr, monatIndex0 } = parsePeriodKey(rhythmus, basisKey);
  return titelVorlage
    .replaceAll('{Monat}', MONATSNAMEN[monatIndex0])
    .replaceAll('{Quartal}', `Q${quartalVonMonatIndex0(monatIndex0)}`)
    .replaceAll('{Halbjahr}', monatIndex0 < 6 ? 'H1' : 'H2')
    .replaceAll('{Jahr}', String(jahr));
}

function naechstePendenzen(rule, ab, anzahl) {
  const ergebnisse = [];
  let periodKey = getPeriodKey(rule.rhythmus, ab);
  let sicherheitszaehler = 0;
  while (ergebnisse.length < anzahl && sicherheitszaehler < anzahl + 50) {
    sicherheitszaehler += 1;
    const faelligkeiten = berechneFaelligkeiten(rule, periodKey);
    for (const { periodKey: pk, faelligkeit } of faelligkeiten) {
      if (ergebnisse.length >= anzahl) break;
      ergebnisse.push({
        periodenSchluessel: pk,
        faelligkeit: toISODate(faelligkeit),
        erscheintAb: toISODate(addDays(faelligkeit, -rule.vorlauf_tage)),
        titel: rendereTitel(rule.titel_vorlage, rule.rhythmus, pk),
      });
    }
    periodKey = nextPeriodKey(rule.rhythmus, periodKey);
  }
  return ergebnisse;
}

export { RHYTHMEN, FAELLIGKEIT_TYPEN, heutigesDatumUTC, naechstePendenzen };
