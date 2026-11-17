// Pendenzenliste pro Mandant -- als Excel (zum gemeinsamen Bearbeiten mit dem Mandanten); das
// PDF-Protokoll baut protokollPdf.js aus derselben Liste. Gegliedert nach Projekt:
//
//   Projekt
//     Teilaufgabe 1   -> Status, Datum
//       Taetigkeit    -> was wurde erledigt, Datum, Zeitaufwand, Pauschal/Extra
//     Teilaufgabe 2   -> ...
//
// Einzelpendenzen ohne Teilaufgaben erscheinen als Projekt mit ihren Taetigkeiten direkt darunter.

import { xlsxBlob } from './xlsx.js';

const ERLEDIGT_TAGE = 90;

function dateinameTeil(text) {
  return String(text ?? '').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// 20261117_Pendenzenliste_A4 Personal AG.xlsx
function dateiname(mandantName, heute, endung = 'xlsx', art = 'Pendenzenliste') {
  return `${heute.replace(/-/g, '')}_${art}_${dateinameTeil(mandantName) || 'Mandant'}.${endung}`;
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

const ART_TEXT = { pauschal: 'Pauschal', extra: 'Extra' };
const stunden = (minuten) => Math.round(((minuten ?? 0) / 60) * 100) / 100;

/**
 * Taetigkeiten einer Pendenz: erfasste Zeiten (mit Text, Datum, Dauer, Pauschal/Extra) und
 * Statusnotizen ohne Zeit. Interne Zeiten und laufende Timer gehoeren nicht in die Liste.
 */
function taetigkeitenVon(id, zeitenProPendenz, notizenProPendenz) {
  const zeiten = (zeitenProPendenz.get(id) ?? [])
    .filter((z) => z.minuten != null && z.art !== 'intern')
    .map((z) => ({ id: `z${z.id}`, datum: z.datum, text: z.beschreibung?.trim() || '', minuten: z.minuten, art: ART_TEXT[z.art] ?? '' }));
  const notizen = (notizenProPendenz.get(id) ?? [])
    .map((n) => ({ id: `n${n.id}`, datum: String(n.erstellt_am ?? '').slice(0, 10), text: n.text?.trim() || '', minuten: null, art: '' }));
  return [...zeiten, ...notizen]
    .filter((t) => t.text || t.minuten)
    .sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? '') || a.id.localeCompare(b.id));
}

function gruppieren(liste, schluessel) {
  const m = new Map();
  for (const x of liste ?? []) {
    const k = x[schluessel];
    if (k != null) m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

const summe = (taetigkeiten) => taetigkeiten.reduce((s, t) => s + (t.minuten ?? 0), 0);

/**
 * Gegliederte Liste fuer Excel und Protokoll.
 * pendenzen: aus pendenzen_angereichert (offen + in den letzten 90 Tagen erledigt)
 * zeiten: zeiteintraege dieser Pendenzen, notizen: pendenz_notizen dieser Pendenzen
 * @returns {{ projekte: object[], summen: { minuten, pauschal, extra }, anzahlOffen: number }}
 */
function listeAufbauen(pendenzen, heute, zeiten = [], notizen = []) {
  const grenze = plusTage(heute, -ERLEDIGT_TAGE);
  const zeitenProPendenz = gruppieren(zeiten, 'pendenz_id');
  const notizenProPendenz = gruppieren(notizen, 'pendenz_id');
  const kinder = gruppieren(pendenzen, 'uebergeordnete_pendenz_id');
  const nachId = new Map(pendenzen.map((p) => [p.id, p]));
  const sichtbar = (p) => p.status !== 'Erledigt' || (p.erledigt_am ?? '') >= grenze;

  const schrittVon = (p, nr) => {
    const taetigkeiten = taetigkeitenVon(p.id, zeitenProPendenz, notizenProPendenz);
    return {
      id: p.id, nr, titel: p.titel, status: statusText(p), erledigt: p.status === 'Erledigt',
      datum: p.status === 'Erledigt' ? (p.erledigt_am ?? null) : (p.bearbeitungstag ?? null),
      frist: p.faelligkeit ?? null, verantwortlich: p.bearbeiter_name ?? '',
      taetigkeiten, minuten: summe(taetigkeiten),
    };
  };

  // Projekt-Koepfe: alle Pendenzen ohne Eltern, dazu Eltern von Teilaufgaben, deren Kopf nicht
  // mitgeladen wurde (z.B. schon laenger erledigt).
  const koepfe = new Map();
  for (const p of pendenzen) {
    if (!p.uebergeordnete_pendenz_id) koepfe.set(p.id, p);
    else if (!nachId.has(p.uebergeordnete_pendenz_id) && !koepfe.has(p.uebergeordnete_pendenz_id)) {
      koepfe.set(p.uebergeordnete_pendenz_id, { id: p.uebergeordnete_pendenz_id, titel: p.eltern_titel ?? 'Projekt', status: 'Offen' });
    }
  }

  const projekte = [];
  for (const kopf of koepfe.values()) {
    const schritteAlle = [...(kinder.get(kopf.id) ?? [])].sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0) || a.id - b.id);
    const schritte = schritteAlle.filter(sichtbar).map((p) => schrittVon(p, schritteAlle.indexOf(p) + 1));
    const eigene = taetigkeitenVon(kopf.id, zeitenProPendenz, notizenProPendenz);
    const istProjekt = schritteAlle.length > 0 || kopf.teilaufgaben_gesamt > 0;
    if (istProjekt && schritte.length === 0 && !sichtbar(kopf)) continue;
    if (!istProjekt && !sichtbar(kopf)) continue;
    const offen = istProjekt ? schritte.some((s) => !s.erledigt) || (schritte.length === 0 && kopf.status !== 'Erledigt') : kopf.status !== 'Erledigt';
    projekte.push({
      id: kopf.id, titel: kopf.titel, istProjekt,
      status: statusText(kopf), erledigt: !offen,
      datum: offen ? (kopf.bearbeitungstag ?? null) : (kopf.erledigt_am ?? null),
      frist: kopf.faelligkeit ?? null, verantwortlich: kopf.bearbeiter_name ?? '',
      taetigkeiten: eigene, schritte,
      minuten: summe(eigene) + schritte.reduce((s, x) => s + x.minuten, 0),
    });
  }
  // Offene Projekte zuerst, dann erledigte; jeweils alphabetisch.
  projekte.sort((a, b) => Number(a.erledigt) - Number(b.erledigt) || a.titel.localeCompare(b.titel, 'de-CH') || a.id - b.id);

  const alle = projekte.flatMap((p) => [...p.taetigkeiten, ...p.schritte.flatMap((s) => s.taetigkeiten)]);
  const nachArt = (art) => alle.filter((t) => t.art === art).reduce((s, t) => s + (t.minuten ?? 0), 0);
  const anzahlOffen = projekte.reduce((n, p) => n + (p.schritte.length ? p.schritte.filter((s) => !s.erledigt).length : Number(!p.erledigt)), 0);
  return { projekte, summen: { minuten: summe(alle), pauschal: nachArt('Pauschal'), extra: nachArt('Extra') }, anzahlOffen };
}

// ---------------------------------------------------------------- Hilfen

const datumCH = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
function stundenCH(minuten) {
  if (!minuten) return '';
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

// ---------------------------------------------------------------- Excel

// Eine Zeile pro Aufgabe: Projekt als Kopfzeile, Teilaufgaben darunter; die erledigten Arbeiten
// stehen zusammengefasst in einer Zelle (Datum, was, Zeit, Pauschal/Extra) statt in vielen Zeilen.
const KOPF = ['Nr.', 'Aufgabe', 'Status', 'Bearbeiten / erledigt am', 'Frist', 'Erledigte Arbeiten', 'Zeit (h)', 'Verrechnung', 'Bemerkung Mandant'];
const BREITEN = [7, 46, 15, 13, 11, 58, 9, 12, 42];

const STATUS_STIL = { Offen: 'statusOffen', 'In Arbeit': 'statusArbeit', Erledigt: 'statusErledigt' };
const statusStil = (status) => STATUS_STIL[status] ?? (String(status).startsWith('Warten') ? 'statusWarten' : 'statusOffen');

const leer = (stil) => ({ wert: '', stil });
const datumZelle = (iso, stil, leerStil) => (iso ? { datum: iso, stil } : leer(leerStil));
const zahlZelle = (minuten, stil, leerStil) => (minuten ? { wert: stunden(minuten), stil } : leer(leerStil));

function arbeitenText(taetigkeiten) {
  return taetigkeiten.map((t) => {
    const zusatz = [t.minuten ? stundenCH(t.minuten) : '', t.art].filter(Boolean).join(', ');
    return `${datumCH(t.datum).slice(0, 6)}  ${t.text}${zusatz ? ` (${zusatz})` : ''}`;
  }).join('\n');
}

function verrechnungText(taetigkeiten) {
  const arten = [...new Set(taetigkeiten.filter((t) => t.minuten && t.art).map((t) => t.art))];
  return arten.join(' + ');
}

// titelStil: Projekt fett hinterlegt, Einzelpendenz fett, Teilaufgabe normal und eingerueckt.
function aufgabenZeile(x, { projektZeile, titel, titelStil }) {
  const t = projektZeile ? 'projekt' : 'text';
  return [
    { wert: x.id, stil: projektZeile ? 'projekt' : 'text' },
    { wert: titel, stil: titelStil },
    { wert: x.status, stil: statusStil(x.status) },
    datumZelle(x.datum, projektZeile ? 'projektDatum' : 'datum', t),
    datumZelle(x.frist, projektZeile ? 'projektDatum' : 'datum', t),
    { wert: arbeitenText(x.taetigkeiten), stil: projektZeile ? 'projekt' : 'arbeiten' },
    zahlZelle(x.minuten, projektZeile ? 'projektZahl' : 'zahl', t),
    { wert: verrechnungText(x.taetigkeiten), stil: t },
    leer('eingabe'),
  ];
}

function pendenzenlisteBlaetter(mandant, pendenzen, heute, zeiten = [], notizen = [], { firma = {}, bearbeiter = '' } = {}) {
  const liste = listeAufbauen(pendenzen, heute, zeiten, notizen);
  const { summen } = liste;
  const kennzahlen = [`${liste.anzahlOffen} offen`, summen.minuten ? `Zeitaufwand ${stundenCH(summen.minuten)} (Pauschal ${stundenCH(summen.pauschal) || '0:00 h'}, Extra ${stundenCH(summen.extra) || '0:00 h'})` : ''].filter(Boolean).join('   ·   ');
  const titel = [
    [{ wert: `Pendenzenliste ${mandant.name}`, stil: 'titel' }],
    [{ wert: `Stand ${datumCH(heute)}   ·   ${kennzahlen}`, stil: 'untertitel' }],
    [{ wert: 'Bitte Rückmeldungen in der gelben Spalte «Bemerkung Mandant» eintragen.', stil: 'untertitel' }],
  ];
  const zeilen = [];
  for (const p of liste.projekte) {
    // Einzelpendenz: eine Zeile mit ihren Arbeiten. Projekt: Kopfzeile ohne Eingabefeld-Text,
    // Arbeiten am Projekt selbst dort, die Teilaufgaben je eine Zeile.
    const istProjekt = p.schritte.length > 0;
    zeilen.push(aufgabenZeile(p, { projektZeile: istProjekt, titel: p.titel, titelStil: istProjekt ? 'projekt' : 'schritt' }));
    for (const s of p.schritte) zeilen.push(aufgabenZeile(s, { projektZeile: false, titel: s.titel, titelStil: 'taetigkeit' }));
  }
  const blatt = {
    name: 'Pendenzenliste',
    spalten: BREITEN.map((breite) => ({ breite })),
    zeilen: [...titel, KOPF.map((t) => ({ wert: t, stil: 'kopf' })), ...zeilen],
    fixiereZeilen: titel.length + 1,
  };
  return { liste, blaetter: [blatt, druckBlatt(mandant, liste, heute, firma, bearbeiter)] };
}

// ---------------------------------------------------------------- Druckblatt «Protokoll»

// Zweites Blatt, sofort druckbar bzw. als PDF speicherbar: A4 hoch, eine Seitenbreite, ohne
// Gitternetz, Kopfzeile auf jeder Seite, Fusszeile mit Seitenzahl. Schrift Arial 10, Projekte
// Arial 11 fett, Bemerkungen/erledigte Arbeiten bei den Aufgaben Arial 9.
const DRUCK_KOPF = ['Datum', 'Projekt / Aufgabe', 'Status', 'Zeit', 'Bemerkung Mandant'];
const DRUCK_BREITEN = [11.5, 50, 15, 9, 30];

function statusMitFrist(x) {
  return !x.erledigt && x.frist ? `${x.status}\nFrist ${datumCH(x.frist)}` : x.status;
}

function druckBlatt(mandant, liste, heute, firma = {}, bearbeiter = '') {
  const z = [];
  const { summen } = liste;
  z.push([null, { wert: `Pendenzenliste ${mandant.name}`, stil: 'titel' }]);
  z.push([null, `Protokoll · Stand ${datumCH(heute)} · ${liste.anzahlOffen} offen${summen.minuten ? ` · Zeitaufwand ${stundenCH(summen.minuten)}` : ''}`]);
  z.push([]);
  const kopfZeile = z.length + 1;
  z.push(DRUCK_KOPF.map((t) => ({ wert: t, stil: 'kopf' })));

  const arbeitenZeilen = (liste2) => {
    for (const t of liste2) {
      z.push([
        t.datum ? { datum: t.datum, stil: 'dKleinDatum' } : null,
        { wert: t.text, stil: 'dKlein' },
        null,
        { wert: [stundenCH(t.minuten), t.art].filter(Boolean).join('\n'), stil: 'dKleinText' },
        null,
      ]);
    }
  };
  const aufgabenZeile = (a, { stil, datumStil }) => [
    a.datum ? { datum: a.datum, stil: datumStil } : { wert: '', stil: stil === 'dProjekt' ? 'dProjekt' : 'dText' },
    { wert: a.titel, stil },
    { wert: statusMitFrist(a), stil: stil === 'dProjekt' ? 'dProjekt' : 'dText' },
    { wert: stundenCH(a.minuten), stil: stil === 'dProjekt' ? 'dProjekt' : 'dText' },
    { wert: '', stil: stil === 'dProjekt' ? 'dProjekt' : 'dText' },
  ];

  for (const p of liste.projekte) {
    if (p.schritte.length) {
      z.push(aufgabenZeile(p, { stil: 'dProjekt', datumStil: 'dProjektDatum' }));
      arbeitenZeilen(p.taetigkeiten);
      for (const s of p.schritte) {
        z.push(aufgabenZeile(s, { stil: 'aufgabe', datumStil: 'dDatum' }));
        arbeitenZeilen(s.taetigkeiten);
      }
    } else {
      // Einzelpendenz: wie ein Projekt (Arial 11), Arbeiten darunter.
      z.push(aufgabenZeile(p, { stil: 'dProjekt', datumStil: 'dProjektDatum' }));
      arbeitenZeilen(p.taetigkeiten);
    }
  }
  if (!liste.projekte.length) z.push([null, 'Keine offenen oder kürzlich erledigten Pendenzen.']);

  // Bemerkungen und Unterschriften
  const linie = () => [null, { wert: '', stil: 'dLinie' }, { wert: '', stil: 'dLinie' }, { wert: '', stil: 'dLinie' }, { wert: '', stil: 'dLinie' }];
  z.push([], [null, { wert: 'Bemerkungen / Vereinbarungen', stil: 'dFett' }], linie(), linie(), linie(), [], []);
  z.push([null, { wert: 'Für den Mandanten', stil: 'dFett' }, null, null, { wert: `Für ${firma.firma || 'den Treuhänder'}`, stil: 'dFett' }]);
  z.push([null, mandant.name, null, null, bearbeiter || '']);
  z.push([], []);
  z.push([null, { wert: '', stil: 'dLinie' }, null, null, { wert: '', stil: 'dLinie' }]);
  z.push([null, { wert: 'Ort, Datum, Unterschrift', stil: 'dKleinText' }, null, null, { wert: 'Ort, Datum, Unterschrift', stil: 'dKleinText' }]);

  return {
    name: 'Protokoll',
    spalten: DRUCK_BREITEN.map((breite) => ({ breite })),
    zeilen: z,
    druck: {
      hochformat: true,
      ohneGitter: true,
      wiederholeZeile: kopfZeile,
      // "&" ist in Excel-Fusszeilen ein Steuerzeichen -- im Namen verdoppeln.
      fusszeile: `&L&"Arial"&9Pendenzenliste ${String(mandant.name).replace(/&/g, '&&')} · Stand ${datumCH(heute)}&R&"Arial"&9Seite &P von &N`,
    },
  };
}

function pendenzenlisteXlsx(mandant, pendenzen, heute, zeiten = [], notizen = [], { firma = {}, bearbeiter = '' } = {}) {
  const { liste, blaetter } = pendenzenlisteBlaetter(mandant, pendenzen, heute, zeiten, notizen, { firma, bearbeiter });
  return { blob: xlsxBlob(blaetter), name: dateiname(mandant.name, heute), anzahlOffen: liste.anzahlOffen };
}

export { dateiname, listeAufbauen, pendenzenlisteBlaetter, pendenzenlisteXlsx, datumCH, stundenCH, ERLEDIGT_TAGE };
