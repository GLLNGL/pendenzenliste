import { useState } from 'react';
import api from '../api.js';
import { useAblageGrund } from '../hooks.js';
import { relativerOrdner } from '../lib/ablage.js';
import { unterstuetzt, grundOrdnerHolen, dateiAblegen, herunterladen } from '../lib/ablageOrdner.js';
import { pendenzenlisteXlsx, listeAufbauen, protokollHtml, ERLEDIGT_TAGE } from '../lib/pendenzenliste.js';
import { heutigesDatumISO } from '../format.js';

const minusTage = (iso, tage) => {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t - tage)).toISOString().slice(0, 10);
};

// HTML-Dokument in einem unsichtbaren Rahmen drucken -- im Druckdialog auch "Als PDF speichern".
function htmlDrucken(dokument) {
  const rahmen = document.createElement('iframe');
  rahmen.setAttribute('aria-hidden', 'true');
  rahmen.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(rahmen);
  rahmen.onload = () => {
    const fenster = rahmen.contentWindow;
    const fertig = () => setTimeout(() => rahmen.remove(), 1000);
    fenster.addEventListener('afterprint', fertig);
    // Logo zuerst laden lassen, sonst fehlt es im Ausdruck.
    const bilder = [...rahmen.contentDocument.images];
    Promise.all(bilder.map((b) => (b.complete ? null : new Promise((ok) => { b.onload = ok; b.onerror = ok; }))))
      .then(() => { fenster.focus(); fenster.print(); });
  };
  rahmen.srcdoc = dokument;
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
      // Schreibrecht im Klick selbst anfragen -- nach dem Laden der Daten blockiert der Browser die Rueckfrage.
      let handle = null;
      if (unterstuetzt() && ordner?.length) {
        handle = await grundOrdnerHolen();
        if (handle && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
          && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') handle = null;
      }
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

  async function protokoll(e) {
    e.stopPropagation();
    setLaeuft('protokoll');
    setMeldung(null);
    try {
      const heute = heutigesDatumISO();
      const [{ pendenzen, zeiten, notizen, bearbeiter }, firma] = await Promise.all([datenLaden(heute), api.buero.lesen('firma')]);
      const liste = listeAufbauen(pendenzen, heute, zeiten, notizen);
      const logoUrl = new URL(`${import.meta.env.BASE_URL}logo-est-controlling.png`, window.location.href).href;
      htmlDrucken(protokollHtml({ mandant, liste, heute, firma, bearbeiter, logoUrl }));
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
        title="Protokoll mit Projekten, Teilaufgaben und erledigten Arbeiten drucken – mit Unterschriftsfeldern für den Mandanten (im Druckdialog auch als PDF speicherbar)">
        {laeuft === 'protokoll' ? 'Bereitet vor…' : '🖨 Protokoll drucken'}
      </button>
      {meldung && <span className={`pl-meldung ${meldung.ok ? 'ok' : 'fehler'}`}>{meldung.text}</span>}
    </span>
  );
}
