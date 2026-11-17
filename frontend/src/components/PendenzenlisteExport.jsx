import { useState } from 'react';
import api from '../api.js';
import { useAblageGrund } from '../hooks.js';
import { relativerOrdner } from '../lib/ablage.js';
import { unterstuetzt, grundOrdnerHolen, dateiAblegen, herunterladen } from '../lib/ablageOrdner.js';
import { pendenzenlisteXlsx, listeAufbauen, ERLEDIGT_TAGE } from '../lib/pendenzenliste.js';
import { protokollPdf } from '../lib/protokollPdf.js';
import { heutigesDatumISO } from '../format.js';

const minusTage = (iso, tage) => {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t - tage)).toISOString().slice(0, 10);
};

// Logo als Data-URL mit Abmessungen (fuer das PDF).
async function logoLaden() {
  try {
    const antwort = await fetch(`${import.meta.env.BASE_URL}logo-est-controlling.png`);
    const blob = await antwort.blob();
    const daten = await new Promise((ok, fehler) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fehler; r.readAsDataURL(blob); });
    const bild = await new Promise((ok, fehler) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fehler; i.src = daten; });
    return { daten, breite: bild.naturalWidth, hoehe: bild.naturalHeight };
  } catch {
    return null;
  }
}

// Schreibrecht fuer den Ablage-Ordner im Klick selbst anfragen -- nach dem Laden der Daten
// blockiert der Browser die Rueckfrage.
async function ordnerHandle(ordner) {
  if (!unterstuetzt() || !ordner?.length) return null;
  const handle = await grundOrdnerHolen();
  if (handle && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
    && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return null;
  return handle;
}

// Pendenzenliste des Mandanten: als Excel direkt im Ablage-Ordner des Mandanten
// (20261117_Pendenzenliste_Mandant.xlsx; ohne verbundenen Ordner: Download) oder als
// Protokoll zum Ausdrucken und Unterzeichnen.
export default function PendenzenlisteExport({ mandant, klein = false }) {
  const grund = useAblageGrund();
  const [laeuft, setLaeuft] = useState(null);
  const [meldung, setMeldung] = useState(null);
  if (!mandant) return null;

  const datenLaden = (heute) => api.pendenzen.listeDaten(mandant.id, minusTage(heute, ERLEDIGT_TAGE));

  async function excel(e) {
    e.stopPropagation();
    setLaeuft('excel');
    setMeldung(null);
    try {
      const ordner = relativerOrdner(mandant, grund);
      const handle = await ordnerHandle(ordner);
      const heute = heutigesDatumISO();
      const { pendenzen, zeiten, notizen } = await datenLaden(heute);
      const { blob, name, anzahlOffen } = pendenzenlisteXlsx(mandant, pendenzen, heute, zeiten, notizen);
      if (handle) {
        const pfad = await dateiAblegen(blob, name, ordner, handle);
        setMeldung({ ok: true, text: `${anzahlOffen} offene Pendenzen · abgelegt: ${pfad}` });
      } else {
        herunterladen(blob, name);
        setMeldung({ ok: true, text: `${anzahlOffen} offene Pendenzen · heruntergeladen (kein Ablage-Ordner verbunden).` });
      }
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
    } finally {
      setLaeuft(null);
    }
  }

  // Protokoll als PDF mit ausfuellbaren Bemerkungsfeldern -- im Ordner des Mandanten abgelegt
  // (20261117_Protokoll_Mandant.pdf), ohne verbundenen Ordner als Download.
  async function protokoll(e) {
    e.stopPropagation();
    setLaeuft('protokoll');
    setMeldung(null);
    try {
      const ordner = relativerOrdner(mandant, grund);
      const handle = await ordnerHandle(ordner);
      const heute = heutigesDatumISO();
      const [{ pendenzen, zeiten, notizen, bearbeiter }, firma, logo, jspdf] = await Promise.all([
        datenLaden(heute), api.buero.lesen('firma'), logoLaden(), import('jspdf'),
      ]);
      const liste = listeAufbauen(pendenzen, heute, zeiten, notizen);
      const { doc, name, seiten } = protokollPdf(jspdf, { mandant, liste, heute, firma, bearbeiter, logo });
      const blob = doc.output('blob');
      if (handle) {
        const pfad = await dateiAblegen(blob, name, ordner, handle);
        setMeldung({ ok: true, text: `PDF-Protokoll (${seiten} Seite${seiten === 1 ? '' : 'n'}) abgelegt: ${pfad}` });
      } else {
        herunterladen(blob, name);
        setMeldung({ ok: true, text: `PDF-Protokoll heruntergeladen (kein Ablage-Ordner verbunden).` });
      }
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
    } finally {
      setLaeuft(null);
    }
  }

  const knopf = klein ? 'btn-klein' : 'btn';
  return (
    <span className="pl-export">
      <button type="button" className={knopf} onClick={excel} disabled={!!laeuft}
        title="Offene (und in den letzten 90 Tagen erledigte) Pendenzen nach Projekt gegliedert als Excel im Ordner des Mandanten ablegen">
        {laeuft === 'excel' ? 'Erstellt…' : '📊 Pendenzenliste Excel'}
      </button>
      <button type="button" className={knopf} onClick={protokoll} disabled={!!laeuft}
        title="Protokoll als PDF im Ordner des Mandanten ablegen – mit Feldern, in die der Mandant elektronisch Bemerkungen schreiben kann, und Unterschriftsfeldern">
        {laeuft === 'protokoll' ? 'Erstellt…' : '📄 PDF-Protokoll'}
      </button>
      {meldung && <span className={`pl-meldung ${meldung.ok ? 'ok' : 'fehler'}`}>{meldung.text}</span>}
    </span>
  );
}
