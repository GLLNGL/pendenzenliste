// HTML-Element (A4-Dokument, 794 px breit) als PDF -- fuer Download und E-Mail-Anhang.
// Bibliotheken werden erst bei Bedarf geladen, damit die App beim Start nicht groesser wird.
// Die App skaliert per CSS-zoom (AuthGate); fuer die Aufnahme wird der Zoom kurz aufgehoben,
// sonst stimmen Masse und Schaerfe nicht.
async function elementZuPdf(element) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const html = document.documentElement;
  const zoomVorher = html.style.zoom;
  // Die Vorschau ist verkleinert (transform: scale) -- aufgenommen wird eine unskalierte Kopie
  // ausserhalb des sichtbaren Bereichs, damit das PDF die volle Aufloesung hat.
  const huelle = document.createElement('div');
  huelle.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;';
  const kopie = element.cloneNode(true);
  kopie.style.transform = 'none';
  kopie.style.boxShadow = 'none';
  huelle.appendChild(kopie);
  document.body.appendChild(huelle);
  html.style.zoom = '1';
  let canvas;
  try {
    canvas = await html2canvas(kopie, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 794 });
  } finally {
    html.style.zoom = zoomVorher;
    huelle.remove();
  }
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const breite = 210;
  const seitenHoehe = 297;
  const bildHoehe = (canvas.height * breite) / canvas.width;
  const bild = canvas.toDataURL('image/jpeg', 0.92);
  // Laenger als eine Seite: dasselbe Bild verschoben auf Folgeseiten.
  for (let y = 0; y < bildHoehe - 1; y += seitenHoehe) {
    if (y > 0) pdf.addPage();
    pdf.addImage(bild, 'JPEG', 0, -y, breite, bildHoehe);
  }
  const blob = pdf.output('blob');
  const base64 = pdf.output('datauristring').split(',')[1];
  return { blob, base64 };
}

function herunterladen(blob, dateiname) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export { elementZuPdf, herunterladen };
