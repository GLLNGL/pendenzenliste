// Excel-Datei (.xlsx) im Browser schreiben -- ohne Bibliothek. Eine .xlsx ist ein ZIP mit
// einigen XML-Dateien (Office Open XML). Hier: Eintraege unkomprimiert ("stored") mit CRC-32,
// Texte als inlineStr, Datumswerte als Excel-Seriennummer mit Datumsformat.
//
// blaetter: [{ name, spalten: [{ breite }], zeilen: [[zelle, ...]], fixiereZeilen, filter: 'A4:H20' }]
// zelle: null | string | number | { wert, stil } -- stil: 'kopf' | 'titel' | 'fett' | 'datum' | 'text'
// Datum: String 'YYYY-MM-DD' mit stil 'datum' (oder { datum: 'YYYY-MM-DD' }).

const STILE = {
  standard: 0, kopf: 1, titel: 2, fett: 3, datum: 4, text: 5, datumText: 6,
  // Gegliederte Listen: Projekt- und Teilaufgaben-Zeilen hinterlegt, Taetigkeiten eingerueckt.
  projekt: 7, projektDatum: 8, projektZahl: 9, schritt: 10, schrittDatum: 11, schrittZahl: 12, schrittText: 13,
  taetigkeit: 14, zahl: 15, summe: 16,
  // Status farbig, Eingabefeld fuer den Mandanten hell hinterlegt, Arbeiten klein und grau.
  statusOffen: 17, statusArbeit: 18, statusWarten: 19, statusErledigt: 20, eingabe: 21, arbeiten: 22, untertitel: 23,
};
const DATUM_STILE = new Set([STILE.datum, STILE.datumText, STILE.projektDatum, STILE.schrittDatum]);

function xml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // In XML 1.0 unzulaessige Steuerzeichen entfernen (Tab, Zeilenumbruch bleiben).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function spaltenName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Excel-Seriennummer (1900-System) fuer ein ISO-Datum.
function seriennummer(iso) {
  const [j, m, t] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(j, m - 1, t) - Date.UTC(1899, 11, 30)) / 86400000);
}

function zelleXml(zelle, ref) {
  if (zelle == null || zelle === '') return '';
  const z = typeof zelle === 'object' ? zelle : { wert: zelle };
  if (z.datum) z.wert = z.datum;
  const stil = STILE[z.stil ?? (z.datum ? 'datum' : 'standard')] ?? 0;
  const s = stil ? ` s="${stil}"` : '';
  if (z.wert == null || z.wert === '') return stil ? `<c r="${ref}"${s}/>` : '';
  if (DATUM_STILE.has(stil) && /^\d{4}-\d{2}-\d{2}/.test(String(z.wert))) return `<c r="${ref}"${s}><v>${seriennummer(z.wert)}</v></c>`;
  if (typeof z.wert === 'number' && Number.isFinite(z.wert)) return `<c r="${ref}"${s}><v>${z.wert}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(z.wert)}</t></is></c>`;
}

function blattXml(blatt) {
  const spalten = (blatt.spalten ?? []).map((sp, i) => `<col min="${i + 1}" max="${i + 1}" width="${sp.breite ?? 12}" customWidth="1"/>`).join('');
  const zeilen = blatt.zeilen.map((zeile, r) => {
    const zellen = zeile.map((zelle, c) => zelleXml(zelle, `${spaltenName(c)}${r + 1}`)).join('');
    return `<row r="${r + 1}">${zellen}</row>`;
  }).join('');
  const fix = blatt.fixiereZeilen
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${blatt.fixiereZeilen}" topLeftCell="A${blatt.fixiereZeilen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = blatt.filter ? `<autoFilter ref="${blatt.filter}"/>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${fix}<sheetFormatPr defaultRowHeight="15"/>${spalten ? `<cols>${spalten}</cols>` : ''}<sheetData>${zeilen}</sheetData>${filter}`
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts>'
  + '<fonts count="5"><font><sz val="10"/><name val="Arial"/></font>'
  + '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>'
  + '<font><b/><sz val="13"/><name val="Arial"/></font>'
  + '<font><b/><sz val="10"/><name val="Arial"/></font>'
  + '<font><sz val="9"/><color rgb="FF4A5563"/><name val="Arial"/></font></fonts>'
  + '<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F8"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE9EDF2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD6E4FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE7C2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9F2DD"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFBE6"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFC8CDD3"/></left><right style="thin"><color rgb="FFC8CDD3"/></right><top style="thin"><color rgb="FFC8CDD3"/></top><bottom style="thin"><color rgb="FFC8CDD3"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="24">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>'
  + '<xf numFmtId="2" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="1"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>'
  + '<xf numFmtId="2" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="2"/></xf>'
  + '<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '<xf numFmtId="2" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function dateien(blaetter) {
  const namen = blaetter.map((b, i) => xml(String(b.name || `Blatt${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)));
  return [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + blaetter.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${namen.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + (blaetter.some((b) => b.filter)
        ? `<definedNames>${blaetter.map((b, i) => (b.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${namen[i].replace(/'/g, "''")}'!${b.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '')).join('')}</definedNames>`
        : '')
      + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${blaetter.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'],
    ['xl/styles.xml', STYLES],
    ...blaetter.map((b, i) => [`xl/worksheets/sheet${i + 1}.xml`, blattXml(b)]),
  ];
}

// ---- ZIP (stored) ----
const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABELLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(eintraege, jetzt = new Date()) {
  const enc = new TextEncoder();
  const dosZeit = (jetzt.getHours() << 11) | (jetzt.getMinutes() << 5) | Math.floor(jetzt.getSeconds() / 2);
  const dosDatum = ((jetzt.getFullYear() - 1980) << 9) | ((jetzt.getMonth() + 1) << 5) | jetzt.getDate();
  const teile = [];
  const zentral = [];
  let versatz = 0;
  for (const [name, inhalt] of eintraege) {
    const n = enc.encode(name);
    const d = typeof inhalt === 'string' ? enc.encode(inhalt) : inhalt;
    const crc = crc32(d);
    const kopf = new DataView(new ArrayBuffer(30));
    kopf.setUint32(0, 0x04034b50, true); kopf.setUint16(4, 20, true); kopf.setUint16(6, 0x0800, true);
    kopf.setUint16(8, 0, true); kopf.setUint16(10, dosZeit, true); kopf.setUint16(12, dosDatum, true);
    kopf.setUint32(14, crc, true); kopf.setUint32(18, d.length, true); kopf.setUint32(22, d.length, true);
    kopf.setUint16(26, n.length, true); kopf.setUint16(28, 0, true);
    teile.push(new Uint8Array(kopf.buffer), n, d);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true); z.setUint16(4, 20, true); z.setUint16(6, 20, true); z.setUint16(8, 0x0800, true);
    z.setUint16(10, 0, true); z.setUint16(12, dosZeit, true); z.setUint16(14, dosDatum, true);
    z.setUint32(16, crc, true); z.setUint32(20, d.length, true); z.setUint32(24, d.length, true);
    z.setUint16(28, n.length, true); z.setUint32(42, versatz, true);
    zentral.push(new Uint8Array(z.buffer), n);
    versatz += 30 + n.length + d.length;
  }
  const zentralGroesse = zentral.reduce((s, b) => s + b.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, eintraege.length, true); ende.setUint16(10, eintraege.length, true);
  ende.setUint32(12, zentralGroesse, true); ende.setUint32(16, versatz, true);
  const alle = [...teile, ...zentral, new Uint8Array(ende.buffer)];
  const gesamt = new Uint8Array(alle.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of alle) { gesamt.set(b, p); p += b.length; }
  return gesamt;
}

const XLSX_TYP = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Bytes der .xlsx-Datei (fuer Tests und Blob).
function xlsxBytes(blaetter, jetzt) {
  return zip(dateien(blaetter), jetzt);
}

function xlsxBlob(blaetter) {
  return new Blob([xlsxBytes(blaetter)], { type: XLSX_TYP });
}

export { xlsxBytes, xlsxBlob, crc32, seriennummer, spaltenName, XLSX_TYP };
