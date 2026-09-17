// Datumsformatierung Schweiz: TT.MM.JJJJ. Eingabefelder verwenden weiterhin ISO (yyyy-mm-dd),
// wie es <input type="date"> vorschreibt.

function formatiereDatum(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Fuer volle ISO-Zeitstempel (z.B. gesendet_am, erstellt_am) statt reiner Datumsfelder --
// Date-Parsing rechnet UTC automatisch in die lokale Zeitzone der Nutzerin um.
function formatiereZeitstempel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tag = String(d.getDate()).padStart(2, '0');
  const monat = String(d.getMonth() + 1).padStart(2, '0');
  const stunde = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${tag}.${monat}.${d.getFullYear()} ${stunde}:${minute}`;
}

function heutigesDatumISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function datumPlusTage(iso, tage) {
  const [y, m, d] = iso.split('-').map(Number);
  const datum = new Date(y, m - 1, d);
  datum.setDate(datum.getDate() + tage);
  const mm = String(datum.getMonth() + 1).padStart(2, '0');
  const dd = String(datum.getDate()).padStart(2, '0');
  return `${datum.getFullYear()}-${mm}-${dd}`;
}

function istUeberfaellig(iso) {
  return iso < heutigesDatumISO();
}

export { formatiereDatum, formatiereZeitstempel, heutigesDatumISO, datumPlusTage, istUeberfaellig };
