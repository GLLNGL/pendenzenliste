// Pendenzenliste pro Mandant -- als Excel (zum gemeinsamen Bearbeiten mit dem Mandanten) und
// als druckbares Protokoll zum Unterzeichnen. Gegliedert nach Projekt:
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

// ---------------------------------------------------------------- Excel

const KOPF = ['Nr.', 'Projekt / Teilaufgabe / Tätigkeit', 'Status', 'Datum', 'Frist', 'Zeit (h)', 'Verrechnung', 'Verantwortlich', 'Rückmeldung / Bemerkung Mandant'];
const BREITEN = [7, 64, 16, 12, 12, 9, 12, 15, 40];

const leer = (stil) => ({ wert: '', stil });
const datumZelle = (iso, stil) => (iso ? { datum: iso, stil } : leer(stil === 'projektDatum' ? 'projekt' : stil === 'schrittDatum' ? 'schrittText' : 'text'));
const zahlZelle = (minuten, stil, leerStil) => (minuten ? { wert: stunden(minuten), stil } : leer(leerStil));

function taetigkeitZeile(t) {
  return [leer('text'), { wert: t.text, stil: 'taetigkeit' }, leer('text'), datumZelle(t.datum, 'datum'), leer('text'),
    zahlZelle(t.minuten, 'zahl', 'text'), { wert: t.art, stil: 'text' }, leer('text'), leer('text')];
}

function pendenzenlisteBlaetter(mandant, pendenzen, heute, zeiten = [], notizen = []) {
  const liste = listeAufbauen(pendenzen, heute, zeiten, notizen);
  const titel = [
    [{ wert: `Pendenzenliste ${mandant.name}`, stil: 'titel' }],
    [{ wert: 'Stand', stil: 'fett' }, { datum: heute, stil: 'datumText' }],
    [],
  ];
  const zeilen = [];
  for (const p of liste.projekte) {
    zeilen.push([{ wert: p.id, stil: 'projekt' }, { wert: p.titel, stil: 'projekt' }, { wert: p.status, stil: 'projekt' },
      datumZelle(p.datum, 'projektDatum'), datumZelle(p.frist, 'projektDatum'), zahlZelle(p.minuten, 'projektZahl', 'projekt'),
      leer('projekt'), { wert: p.verantwortlich, stil: 'projekt' }, leer('projekt')]);
    for (const t of p.taetigkeiten) zeilen.push(taetigkeitZeile(t));
    for (const s of p.schritte) {
      zeilen.push([{ wert: s.id, stil: 'schrittText' }, { wert: `${s.nr}. ${s.titel}`, stil: 'schritt' }, { wert: s.status, stil: 'schrittText' },
        datumZelle(s.datum, 'schrittDatum'), datumZelle(s.frist, 'schrittDatum'), zahlZelle(s.minuten, 'schrittZahl', 'schrittText'),
        leer('schrittText'), { wert: s.verantwortlich, stil: 'schrittText' }, leer('schrittText')]);
      for (const t of s.taetigkeiten) zeilen.push(taetigkeitZeile(t));
    }
  }
  const fuss = liste.summen.minuten ? [
    [],
    [null, { wert: 'Total Zeitaufwand', stil: 'fett' }, null, null, null, { wert: stunden(liste.summen.minuten), stil: 'summe' }],
    [null, 'davon Pauschal', null, null, null, { wert: stunden(liste.summen.pauschal), stil: 'zahl' }],
    [null, 'davon Extra', null, null, null, { wert: stunden(liste.summen.extra), stil: 'zahl' }],
  ] : [];
  const blatt = {
    name: 'Pendenzenliste',
    spalten: BREITEN.map((breite) => ({ breite })),
    zeilen: [...titel, KOPF.map((t) => ({ wert: t, stil: 'kopf' })), ...zeilen, ...fuss],
    fixiereZeilen: titel.length + 1,
  };
  return { liste, blaetter: [blatt] };
}

function pendenzenlisteXlsx(mandant, pendenzen, heute, zeiten = [], notizen = []) {
  const { liste, blaetter } = pendenzenlisteBlaetter(mandant, pendenzen, heute, zeiten, notizen);
  return { blob: xlsxBlob(blaetter), name: dateiname(mandant.name, heute), anzahlOffen: liste.anzahlOffen };
}

// ---------------------------------------------------------------- Protokoll (Druck)

const html = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const datumCH = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
function stundenCH(minuten) {
  if (!minuten) return '';
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

const PROTOKOLL_CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #1b1f24; margin: 0; }
.kopf { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f3a5f; padding-bottom: 8px; margin-bottom: 14px; }
.kopf img { height: 46px; }
.absender { font-size: 8pt; color: #555; margin-top: 4px; }
h1 { font-size: 16pt; margin: 0 0 2px; color: #1f3a5f; }
.meta { font-size: 9pt; color: #444; }
.meta td { padding: 1px 12px 1px 0; }
table.liste { width: 100%; border-collapse: collapse; margin-top: 10px; }
table.liste th { background: #1f3a5f; color: #fff; text-align: left; font-size: 8.5pt; padding: 5px 6px; }
table.liste td { padding: 4px 6px; border-bottom: 1px solid #dde2e8; vertical-align: top; }
table.liste thead { display: table-header-group; }
tr { page-break-inside: avoid; }
tr.projekt td { background: #dce6f1; font-weight: bold; border-top: 1px solid #b8c7da; }
tr.schritt td { background: #f3f5f8; }
tr.schritt td.titel { font-weight: bold; padding-left: 16px; }
tr.taetigkeit td.titel { padding-left: 30px; }
tr.taetigkeit td { font-size: 9pt; }
.erledigt { color: #2e7d32; }
.frist { font-size: 8pt; font-weight: normal; color: #555; }
.zahl { text-align: right; white-space: nowrap; }
.datum { white-space: nowrap; }
.summen { margin: 12px 0 0 auto; border-collapse: collapse; }
.summen td { padding: 2px 0 2px 18px; }
.summen tr:first-child td { font-weight: bold; border-top: 1px solid #1f3a5f; padding-top: 4px; }
.bemerkungen { margin-top: 18px; page-break-inside: avoid; }
.bemerkungen .zeile { border-bottom: 1px solid #999; height: 24px; }
.unterschriften { display: flex; gap: 36px; margin-top: 28px; page-break-inside: avoid; }
.unterschriften > div { flex: 1; }
.unterschriften .titel { font-weight: bold; margin-bottom: 4px; }
.unterschriften .linie { border-bottom: 1px solid #333; height: 44px; }
.unterschriften .klein { font-size: 8pt; color: #555; margin-top: 3px; }
.leer { color: #777; font-style: italic; }
`;

/**
 * Protokoll als eigenstaendiges HTML-Dokument (Druck / "Als PDF speichern").
 * firma: { firma, strasse, plzOrt } aus den Bueroeinstellungen; logoUrl: absolute URL.
 */
// Frist nur bei offenen Punkten, klein unter dem Status.
const fristHtml = (x) => (x.frist && !x.erledigt ? `<div class="frist">Frist ${datumCH(x.frist)}</div>` : '');

function protokollHtml({ mandant, liste, heute, firma = {}, bearbeiter = '', logoUrl = '' }) {
  const absender = [firma.firma, firma.strasse, firma.plzOrt].filter(Boolean).join('  •  ');
  const taetigkeit = (t) => `<tr class="taetigkeit"><td class="datum">${datumCH(t.datum)}</td><td class="titel">${html(t.text)}</td><td></td><td class="zahl">${stundenCH(t.minuten)}</td><td>${html(t.art)}</td></tr>`;
  const zeilen = liste.projekte.map((p) => [
    `<tr class="projekt"><td class="datum">${datumCH(p.datum)}</td><td class="titel">${html(p.titel)}</td><td class="${p.erledigt ? 'erledigt' : ''}">${html(p.status)}${fristHtml(p)}</td><td class="zahl">${stundenCH(p.minuten)}</td><td></td></tr>`,
    ...p.taetigkeiten.map(taetigkeit),
    ...p.schritte.flatMap((s) => [
      `<tr class="schritt"><td class="datum">${datumCH(s.datum)}</td><td class="titel">${s.nr}. ${html(s.titel)}</td><td class="${s.erledigt ? 'erledigt' : ''}">${html(s.status)}${fristHtml(s)}</td><td class="zahl">${stundenCH(s.minuten)}</td><td></td></tr>`,
      ...s.taetigkeiten.map(taetigkeit),
    ]),
  ].join('')).join('');
  const { summen } = liste;
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${html(dateiname(mandant.name, heute, 'pdf', 'Protokoll').replace(/\.pdf$/, ''))}</title><style>${PROTOKOLL_CSS}</style></head><body>
<div class="kopf"><div><h1>Protokoll Pendenzen</h1><table class="meta"><tbody>
<tr><td>Mandant</td><td><b>${html(mandant.name)}</b></td></tr>
<tr><td>Stand</td><td>${datumCH(heute)}</td></tr>
${bearbeiter ? `<tr><td>Bearbeitet von</td><td>${html(bearbeiter)}</td></tr>` : ''}
</tbody></table></div><div style="text-align:right">${logoUrl ? `<img src="${html(logoUrl)}" alt="">` : ''}<div class="absender">${html(absender)}</div></div></div>
<table class="liste"><thead><tr><th style="width:68px">Datum</th><th>Projekt / Teilaufgabe / was wurde erledigt</th><th style="width:96px">Status</th><th style="width:58px" class="zahl">Zeit</th><th style="width:78px">Verrechnung</th></tr></thead>
<tbody>${zeilen || '<tr><td colspan="5" class="leer">Keine offenen oder kürzlich erledigten Pendenzen.</td></tr>'}</tbody></table>
${summen.minuten ? `<table class="summen"><tbody><tr><td>Total Zeitaufwand</td><td class="zahl">${stundenCH(summen.minuten)}</td></tr><tr><td>davon Pauschal</td><td class="zahl">${stundenCH(summen.pauschal) || '0:00 h'}</td></tr><tr><td>davon Extra</td><td class="zahl">${stundenCH(summen.extra) || '0:00 h'}</td></tr></tbody></table>` : ''}
<div class="bemerkungen"><b>Bemerkungen / Vereinbarungen</b><div class="zeile"></div><div class="zeile"></div><div class="zeile"></div></div>
<div class="unterschriften">
<div><div class="titel">Für den Mandanten</div><div>${html(mandant.name)}</div><div class="linie"></div><div class="klein">Ort, Datum, Name und Unterschrift</div></div>
<div><div class="titel">Für ${html(firma.firma || 'den Treuhänder')}</div><div>${html(bearbeiter)}</div><div class="linie"></div><div class="klein">Ort, Datum, Unterschrift</div></div>
</div>
</body></html>`;
}

export { dateiname, listeAufbauen, pendenzenlisteBlaetter, pendenzenlisteXlsx, protokollHtml, stundenCH, ERLEDIGT_TAGE };
