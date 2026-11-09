// Direktes Ablegen in den lokal synchronisierten OneDrive-Ordner (Edge/Chrome am PC): Der
// Grundordner wird einmal pro Geraet freigegeben (Ordnerauswahl des Browsers); die App merkt
// sich die Freigabe im Browser (IndexedDB) und schreibt Dateien danach direkt in den Ordner des
// Mandanten -- OneDrive synchronisiert sie wie gewohnt. Ohne diese Moeglichkeit (Firefox, Handy)
// wird die Datei normal heruntergeladen.

const DB_NAME = 'auftragsmanagement';
const STORE = 'ordner';
const SCHLUESSEL = 'ablage-grund';

function unterstuetzt() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function db() {
  return new Promise((resolve, reject) => {
    const anfrage = indexedDB.open(DB_NAME, 1);
    anfrage.onupgradeneeded = () => anfrage.result.createObjectStore(STORE);
    anfrage.onsuccess = () => resolve(anfrage.result);
    anfrage.onerror = () => reject(anfrage.error);
  });
}

async function speicherZugriff(modus, fn) {
  const verbindung = await db();
  return new Promise((resolve, reject) => {
    const tx = verbindung.transaction(STORE, modus);
    const anfrage = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(anfrage?.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function grundOrdnerHolen() {
  if (!unterstuetzt()) return null;
  try { return (await speicherZugriff('readonly', (s) => s.get(SCHLUESSEL))) ?? null; } catch { return null; }
}

// Ordnerauswahl oeffnen (braucht einen Klick der Person) und die Freigabe merken.
async function grundOrdnerWaehlen() {
  const handle = await window.showDirectoryPicker({ id: 'ablage-grund', mode: 'readwrite' });
  await speicherZugriff('readwrite', (s) => s.put(handle, SCHLUESSEL));
  return handle;
}

async function grundOrdnerVergessen() {
  try { await speicherZugriff('readwrite', (s) => s.delete(SCHLUESSEL)); } catch { /* nichts gemerkt */ }
}

// Schreibrecht sicherstellen (nach einem Neustart fragt der Browser einmal nach).
async function berechtigt(handle) {
  const optionen = { mode: 'readwrite' };
  if ((await handle.queryPermission(optionen)) === 'granted') return true;
  return (await handle.requestPermission(optionen)) === 'granted';
}

// Freien Dateinamen finden: "Vertrag.pdf" -> "Vertrag (2).pdf", falls schon vorhanden.
async function freierName(ordner, name) {
  const punkt = name.lastIndexOf('.');
  const stamm = punkt > 0 ? name.slice(0, punkt) : name;
  const endung = punkt > 0 ? name.slice(punkt) : '';
  for (let i = 1; i < 100; i += 1) {
    const versuch = i === 1 ? name : `${stamm} (${i})${endung}`;
    try { await ordner.getFileHandle(versuch); } catch { return versuch; }
  }
  return `${stamm} (${Date.now()})${endung}`;
}

// Ordner eines Mandanten per Ordnerauswahl waehlen (startet im Grundordner). Gibt die
// Unterordner relativ zum Grundordner zurueck, z.B. ['Muster AG'].
async function unterordnerWaehlen() {
  let grund = await grundOrdnerHolen();
  if (!grund) grund = await grundOrdnerWaehlen();
  if (!(await berechtigt(grund))) throw new Error('Kein Zugriff auf den Ablage-Ordner erteilt.');
  const gewaehlt = await window.showDirectoryPicker({ id: 'ablage-mandant', startIn: grund, mode: 'readwrite' });
  const teile = await grund.resolve(gewaehlt);
  if (teile == null) throw new Error(`Der gewählte Ordner liegt nicht im Grundordner «${grund.name}». Bitte einen Ordner darin wählen (oder in den Einstellungen einen anderen Grundordner verbinden).`);
  if (!teile.length) throw new Error('Das ist der Grundordner selbst – bitte den Ordner des Mandanten darin wählen.');
  return { teile, grundName: grund.name };
}

// Ordner <Grundordner>/<Mandantenordner> anlegen (falls noch nicht vorhanden).
async function ordnerAnlegen(ordnerTeile) {
  let grund = await grundOrdnerHolen();
  if (!grund) grund = await grundOrdnerWaehlen();
  if (!(await berechtigt(grund))) throw new Error('Kein Schreibrecht auf den Ablage-Ordner erteilt.');
  let ordner = grund;
  for (const teil of ordnerTeile) ordner = await ordner.getDirectoryHandle(teil, { create: true });
  return [grund.name, ...ordnerTeile].join('\\');
}

// Datei in <Grundordner>/<Mandantenordner>/<Unterordner> schreiben. Gibt den Ablagepfad
// (relativ zum Grundordner) zurueck. Fehlende Unterordner werden angelegt.
async function dateiAblegen(blob, dateiname, ordnerTeile, grundHandle = null) {
  let grund = grundHandle ?? await grundOrdnerHolen();
  if (!grund) grund = await grundOrdnerWaehlen();
  if (!(await berechtigt(grund))) throw new Error('Kein Schreibrecht auf den Ablage-Ordner erteilt.');
  let ordner = grund;
  for (const teil of ordnerTeile) ordner = await ordner.getDirectoryHandle(teil, { create: true });
  const name = await freierName(ordner, dateiname);
  const datei = await ordner.getFileHandle(name, { create: true });
  const schreiber = await datei.createWritable();
  await schreiber.write(blob);
  await schreiber.close();
  return [grund.name, ...ordnerTeile, name].join('\\');
}

// Datei aus dem verbundenen OneDrive-Ordner lesen. pfad wie von dateiAblegen zurueckgegeben
// ("Grundordner\Unterordner\Datei.pdf"). Gibt ein File zurueck.
async function dateiLesen(pfad) {
  const grund = await grundOrdnerHolen();
  if (!grund) throw new Error('OneDrive ist auf diesem Gerät nicht verbunden (Einstellungen › Ablage).');
  if ((await grund.queryPermission({ mode: 'read' })) !== 'granted'
    && (await grund.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('Kein Zugriff auf den OneDrive-Ordner erteilt.');
  const teile = String(pfad).split(/[\\/]+/).filter(Boolean);
  if (teile[0] === grund.name) teile.shift();
  const name = teile.pop();
  let ordner = grund;
  try {
    for (const teil of teile) ordner = await ordner.getDirectoryHandle(teil);
    return await (await ordner.getFileHandle(name)).getFile();
  } catch {
    throw new Error(`Beleg nicht gefunden: ${pfad} – verschoben oder umbenannt?`);
  }
}

// Normaler Download als Rueckfallebene.
function herunterladen(blob, dateiname) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export { unterstuetzt, grundOrdnerHolen, grundOrdnerWaehlen, grundOrdnerVergessen, unterordnerWaehlen, ordnerAnlegen, dateiAblegen, dateiLesen, herunterladen };
