// Pendenzenliste pro Mandant als Excel -- zum gemeinsamen Bearbeiten mit dem Mandanten.
// Nur was der Mandant sehen soll: Projekt, Aufgabe, Status, Termine, Verantwortlich und leere
// Spalten fuer seine Rueckmeldung. Keine Beschreibungen, Notizen, Aufwand oder Verrechnung.

import { xlsxBlob } from './xlsx.js';

const ERLEDIGT_TAGE = 90;

function dateinameTeil(text) {
  return String(text ?? '').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// 20261117_Pendenzenliste_A4 Personal AG.xlsx
function dateiname(mandantName, heute) {
  return `${heute.replace(/-/g, '')}_Pendenzenliste_${dateinameTeil(mandantName) || 'Mandant'}.xlsx`;
}

function statusText(p) {
  if (p.status === 'Später') return 'Offen';
  if (p.status === 'Warten auf') return p.warten_auf_person ? `Warten auf ${p.warten_auf_person}` : 'Warten auf';
  return p.status;
}

function plusTage(iso, tage) {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

/**
 * Zeilen der Liste: Projekte mit Teilaufgaben als je eine Zeile pro Teilaufgabe (Projekt in
 * eigener Spalte), Einzelpendenzen als eine Zeile. Projekt-Koepfe mit Teilaufgaben entfallen.
 * @returns {{ offen: object[], erledigt: object[] }}
 */
function listeAufbauen(pendenzen, heute) {
  const kinder = new Map();
  for (const p of pendenzen) {
    if (p.uebergeordnete_pendenz_id) kinder.set(p.uebergeordnete_pendenz_id, [...(kinder.get(p.uebergeordnete_pendenz_id) ?? []), p]);
  }
  const titelVon = new Map(pendenzen.map((p) => [p.id, p.titel]));
  const zeilen = [];
  for (const p of pendenzen) {
    if (!p.uebergeordnete_pendenz_id && (kinder.get(p.id)?.length || p.teilaufgaben_gesamt > 0)) continue;
    const projekt = p.uebergeordnete_pendenz_id ? (p.eltern_titel ?? titelVon.get(p.uebergeordnete_pendenz_id) ?? '') : p.titel;
    zeilen.push({
      id: p.id,
      projekt,
      aufgabe: p.uebergeordnete_pendenz_id ? p.titel : '',
      status: statusText(p),
      erledigt: p.status === 'Erledigt',
      bearbeitenAm: p.bearbeitungstag ?? null,
      frist: p.faelligkeit ?? null,
      erledigtAm: p.erledigt_am ?? null,
      verantwortlich: p.bearbeiter_name ?? '',
      reihenfolge: p.reihenfolge ?? 0,
    });
  }
  const sortiere = (a, b) => a.projekt.localeCompare(b.projekt, 'de-CH') || a.reihenfolge - b.reihenfolge || a.id - b.id;
  const grenze = plusTage(heute, -ERLEDIGT_TAGE);
  return {
    offen: zeilen.filter((z) => !z.erledigt).sort(sortiere),
    erledigt: zeilen.filter((z) => z.erledigt && (z.erledigtAm ?? '') >= grenze)
      .sort((a, b) => (b.erledigtAm ?? '').localeCompare(a.erledigtAm ?? '') || sortiere(a, b)),
  };
}

const KOPF_OFFEN = ['Nr.', 'Projekt', 'Aufgabe', 'Status', 'Bearbeiten am', 'Frist', 'Verantwortlich', 'Rückmeldung / Bemerkung Mandant', 'Erledigt (Datum/Visum)'];
const BREITEN_OFFEN = [7, 38, 48, 16, 13, 12, 16, 42, 18];
const KOPF_ERLEDIGT = ['Nr.', 'Projekt', 'Aufgabe', 'Erledigt am', 'Verantwortlich'];
const BREITEN_ERLEDIGT = [7, 38, 48, 13, 16];

function blattOffen(mandant, liste, heute) {
  const titel = [
    [{ wert: `Pendenzenliste ${mandant.name}`, stil: 'titel' }],
    [{ wert: 'Stand' , stil: 'fett' }, { datum: heute }],
    [],
  ];
  const kopf = KOPF_OFFEN.map((t) => ({ wert: t, stil: 'kopf' }));
  const zeilen = liste.offen.map((z) => [
    { wert: z.id, stil: 'text' }, { wert: z.projekt, stil: 'text' }, { wert: z.aufgabe, stil: 'text' },
    { wert: z.status, stil: 'text' },
    z.bearbeitenAm ? { datum: z.bearbeitenAm } : { wert: '', stil: 'text' },
    z.frist ? { datum: z.frist } : { wert: '', stil: 'text' },
    { wert: z.verantwortlich, stil: 'text' }, { wert: '', stil: 'text' }, { wert: '', stil: 'text' },
  ]);
  const ersteZeile = titel.length + 1;
  return {
    name: 'Offen',
    spalten: BREITEN_OFFEN.map((breite) => ({ breite })),
    zeilen: [...titel, kopf, ...zeilen],
    fixiereZeilen: ersteZeile,
    filter: `A${ersteZeile}:I${ersteZeile + Math.max(zeilen.length, 1)}`,
  };
}

function blattErledigt(liste) {
  const kopf = KOPF_ERLEDIGT.map((t) => ({ wert: t, stil: 'kopf' }));
  const zeilen = liste.erledigt.map((z) => [
    { wert: z.id, stil: 'text' }, { wert: z.projekt, stil: 'text' }, { wert: z.aufgabe, stil: 'text' },
    z.erledigtAm ? { datum: z.erledigtAm } : { wert: '', stil: 'text' }, { wert: z.verantwortlich, stil: 'text' },
  ]);
  return {
    name: `Erledigt (${ERLEDIGT_TAGE} Tage)`,
    spalten: BREITEN_ERLEDIGT.map((breite) => ({ breite })),
    zeilen: [kopf, ...zeilen],
    fixiereZeilen: 1,
  };
}

function pendenzenlisteBlaetter(mandant, pendenzen, heute) {
  const liste = listeAufbauen(pendenzen, heute);
  return { liste, blaetter: [blattOffen(mandant, liste, heute), blattErledigt(liste)] };
}

function pendenzenlisteXlsx(mandant, pendenzen, heute) {
  const { liste, blaetter } = pendenzenlisteBlaetter(mandant, pendenzen, heute);
  return { blob: xlsxBlob(blaetter), name: dateiname(mandant.name, heute), anzahlOffen: liste.offen.length, anzahlErledigt: liste.erledigt.length };
}

export { dateiname, listeAufbauen, pendenzenlisteBlaetter, pendenzenlisteXlsx, ERLEDIGT_TAGE };
