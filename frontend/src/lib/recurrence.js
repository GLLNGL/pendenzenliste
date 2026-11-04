// Reine Funktionen für die Wiederkehr-Logik: Perioden, Fälligkeitsberechnung, Titel-Platzhalter
// und welche Vorkommen einer Regel bis zu einem Stichtag fällig werden. Ursprünglich 1:1 aus
// backend/src/recurrence.js übernommen, seit Etappe 4 erweitert um die Rhythmen "woechentlich"
// und "14-taeglich" (Fälligkeitstyp "wochentag") sowie Vorlauf in Arbeitstagen. Alle Daten
// werden als UTC-Datumswerte (Mitternacht) gerechnet, damit Sommerzeit-Wechsel die
// Tagesarithmetik nicht verfälschen. Bestehende Periodenschlüssel (z.B. "2026-11" für
// monatlich) bleiben unverändert, damit bereits erzeugte Pendenzen nicht doppelt entstehen.
import { minusArbeitstage } from './vorschlaege.js';

const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

// Bezugsmontag für 14-tägliche Rhythmen, falls die Regel keinen eigenen hat.
const STANDARD_ANKER_14_TAEGLICH = '2026-01-05';
// Wie weit in der Vergangenheit fällige, noch nicht erzeugte Vorkommen beim Erzeugen noch
// nachgetragen werden. Bewusst 0: bereits überfällige Arbeiten (z.B. ein Lohnlauf, der
// längst von Hand erledigt wurde, während die Erzeugung fehlte) sollen nicht nachträglich als
// "überfällig" auftauchen. Da jede Pendenz schon mit ihrem Vorlauf erscheint, geht bei
// regelmässiger Nutzung trotzdem nichts verloren.
const NACHTRAG_TAGE = 0;
const MAX_ITERATIONEN = 120;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISODate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function fromISODate(iso) {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t));
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

function letzterTagDesMonats(jahr, monatIndex0) {
  return new Date(Date.UTC(jahr, monatIndex0 + 1, 0)).getUTCDate();
}

// Montag der Woche, in der `date` liegt.
function montagDerWoche(date) {
  const wochentag = (date.getUTCDay() + 6) % 7; // 0 = Montag
  return addDays(date, -wochentag);
}

function istWochenRhythmus(rhythmus) {
  return rhythmus === 'woechentlich' || rhythmus === '14-taeglich';
}

function anker14(rule) {
  return montagDerWoche(fromISODate(rule.faelligkeit_config?.anker || STANDARD_ANKER_14_TAEGLICH));
}

// Periodenschlüssel: Monat "2026-11", Quartal "2026-Q4", Halbjahr "2026-H2", Jahr "2026";
// Woche bzw. 14-Tage-Periode: Datum ihres Montags "2026-11-09".
function getPeriodKey(rule, date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  switch (rule.rhythmus) {
    case 'woechentlich':
      return toISODate(montagDerWoche(date));
    case '14-taeglich': {
      const anker = anker14(rule);
      const perioden = Math.floor((montagDerWoche(date) - anker) / (14 * 86_400_000));
      return toISODate(addDays(anker, perioden * 14));
    }
    case 'monatlich':
      return `${y}-${pad2(m + 1)}`;
    case 'quartalsweise':
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'halbjaehrlich':
      return `${y}-H${m < 6 ? 1 : 2}`;
    case 'jaehrlich':
      return `${y}`;
    default:
      throw new Error(`Unbekannter Rhythmus: ${rule.rhythmus}`);
  }
}

function parsePeriodKey(rhythmus, periodKey) {
  switch (rhythmus) {
    case 'woechentlich':
    case '14-taeglich': {
      const start = fromISODate(periodKey);
      return { start, jahr: start.getUTCFullYear(), monatIndex0: start.getUTCMonth() };
    }
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
    case 'jaehrlich':
      return { jahr: Number(periodKey), monatIndex0: 0 };
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

function periodenStart(rhythmus, periodKey) {
  const p = parsePeriodKey(rhythmus, periodKey);
  return p.start ?? new Date(Date.UTC(p.jahr, p.monatIndex0, 1));
}

function periodEnd(rhythmus, periodKey) {
  if (rhythmus === 'woechentlich') return addDays(periodenStart(rhythmus, periodKey), 6);
  if (rhythmus === '14-taeglich') return addDays(periodenStart(rhythmus, periodKey), 13);
  const { jahr, monatIndex0 } = parsePeriodKey(rhythmus, periodKey);
  return new Date(Date.UTC(jahr, monatIndex0 + periodenLaengeInMonaten(rhythmus), 0));
}

function nextPeriodKey(rule, periodKey) {
  return getPeriodKey(rule, addDays(periodEnd(rule.rhythmus, periodKey), 1));
}

function previousPeriodKey(rule, periodKey) {
  return getPeriodKey(rule, addDays(periodenStart(rule.rhythmus, periodKey), -1));
}

function berechneFaelligkeiten(rule, periodKey) {
  const { rhythmus, faelligkeit_typ: typ, faelligkeit_config: config = {} } = rule;
  const { jahr, monatIndex0 } = parsePeriodKey(rhythmus, periodKey);

  switch (typ) {
    case 'wochentag': {
      // 1 = Montag … 5 = Freitag (bei 14-täglich in der ersten Woche der Periode).
      const tag = Math.min(Math.max(Number(config.wochentag) || 5, 1), 7);
      return [{ periodKey, faelligkeit: addDays(periodenStart(rhythmus, periodKey), tag - 1) }];
    }
    case 'tag_des_monats': {
      const tag = Math.min(config.tag, letzterTagDesMonats(jahr, monatIndex0));
      return [{ periodKey, faelligkeit: new Date(Date.UTC(jahr, monatIndex0, tag)) }];
    }
    case 'letzter_tag_des_monats':
      return [{ periodKey, faelligkeit: new Date(Date.UTC(jahr, monatIndex0, letzterTagDesMonats(jahr, monatIndex0))) }];
    case 'tage_nach_periodenende':
      return [{ periodKey, faelligkeit: addDays(periodEnd(rhythmus, periodKey), config.tage) }];
    case 'tag_monat_folgejahr': {
      const zielJahr = jahr + (config.jahre_offset ?? 0);
      const zielMonatIndex0 = config.monat - 1;
      const tag = Math.min(config.tag, letzterTagDesMonats(zielJahr, zielMonatIndex0));
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
      throw new Error(`Unbekannter Fälligkeitstyp: ${typ}`);
  }
}

// Ab wann eine Pendenz erscheint: Fälligkeit minus Vorlauf (Kalender- oder Arbeitstage).
function erscheintAb(rule, faelligkeitISO) {
  const vorlauf = Number(rule.vorlauf_tage) || 0;
  if (rule.vorlauf_einheit === 'arbeitstage') return minusArbeitstage(faelligkeitISO, vorlauf);
  return toISODate(addDays(fromISODate(faelligkeitISO), -vorlauf));
}

function rendereTitel(titelVorlage, rhythmus, periodKey, faelligkeitISO) {
  const basisKey = periodKey.split('#')[0];
  const { jahr, monatIndex0 } = parsePeriodKey(rhythmus, basisKey);
  const datum = faelligkeitISO ? faelligkeitISO.split('-').reverse().join('.') : '';
  return titelVorlage
    .replaceAll('{Monat}', MONATSNAMEN[monatIndex0])
    .replaceAll('{Quartal}', `Q${Math.floor(monatIndex0 / 3) + 1}`)
    .replaceAll('{Halbjahr}', monatIndex0 < 6 ? 'H1' : 'H2')
    .replaceAll('{Jahr}', String(jahr))
    .replaceAll('{Datum}', datum);
}

function vorkommen(rule, periodKey) {
  return berechneFaelligkeiten(rule, periodKey).map(({ periodKey: pk, faelligkeit }) => {
    const faelligkeitISO = toISODate(faelligkeit);
    return {
      periodenSchluessel: pk,
      faelligkeit: faelligkeitISO,
      erscheintAb: erscheintAb(rule, faelligkeitISO),
      titel: rendereTitel(rule.titel_vorlage, rule.rhythmus, pk, faelligkeitISO),
    };
  });
}

// Vorschau: die nächsten `anzahl` Vorkommen ab einem Datum.
function naechstePendenzen(rule, ab, anzahl) {
  const ergebnisse = [];
  const abISO = toISODate(ab);
  let periodKey = getPeriodKey(rule, ab);
  for (let i = 0; i < anzahl + 50 && ergebnisse.length < anzahl; i += 1) {
    for (const v of vorkommen(rule, periodKey)) {
      if (ergebnisse.length < anzahl && v.faelligkeit >= abISO) ergebnisse.push(v);
    }
    periodKey = nextPeriodKey(rule, periodKey);
  }
  return ergebnisse;
}

/**
 * Alle Vorkommen einer Regel, die bis zum Stichtag `bisISO` erscheinen (Fälligkeit minus
 * Vorlauf <= Stichtag) und deren Fälligkeit nicht länger als NACHTRAG_TAGE vor `heuteISO`
 * liegt. Idempotenz (keine Duplikate) sichert der eindeutige Index regel_id +
 * perioden_schluessel in der Datenbank.
 */
function faelligeVorkommen(rule, heuteISO, bisISO) {
  const frueheste = toISODate(addDays(fromISODate(heuteISO), -NACHTRAG_TAGE));
  const treffer = [];

  // Rückwärts ab der aktuellen Periode, bis die Fälligkeiten vor dem Nachtragsfenster liegen.
  let key = getPeriodKey(rule, fromISODate(heuteISO));
  for (let i = 0; i < MAX_ITERATIONEN; i += 1) {
    const liste = vorkommen(rule, key);
    treffer.push(...liste);
    if (liste.every((v) => v.faelligkeit < frueheste)) break;
    key = previousPeriodKey(rule, key);
  }

  // Vorwärts, bis eine Periode erst nach dem Stichtag erscheint.
  key = nextPeriodKey(rule, getPeriodKey(rule, fromISODate(heuteISO)));
  for (let i = 0; i < MAX_ITERATIONEN; i += 1) {
    const liste = vorkommen(rule, key);
    treffer.push(...liste);
    if (liste.every((v) => v.erscheintAb > bisISO)) break;
    key = nextPeriodKey(rule, key);
  }

  const gesehen = new Set();
  return treffer
    .filter((v) => v.faelligkeit >= frueheste && v.erscheintAb <= bisISO)
    .filter((v) => (gesehen.has(v.periodenSchluessel) ? false : gesehen.add(v.periodenSchluessel)))
    .sort((a, b) => (a.faelligkeit < b.faelligkeit ? -1 : 1));
}

export {
  heutigesDatumUTC, naechstePendenzen, faelligeVorkommen, rendereTitel, erscheintAb,
  istWochenRhythmus, NACHTRAG_TAGE,
};
