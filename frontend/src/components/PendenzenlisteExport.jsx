import { useState } from 'react';
import api from '../api.js';
import { useAblageGrund } from '../hooks.js';
import { relativerOrdner } from '../lib/ablage.js';
import { unterstuetzt, grundOrdnerHolen, dateiAblegen, herunterladen } from '../lib/ablageOrdner.js';
import { pendenzenlisteXlsx, ERLEDIGT_TAGE } from '../lib/pendenzenliste.js';
import { heutigesDatumISO } from '../format.js';

const minusTage = (iso, tage) => {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t - tage)).toISOString().slice(0, 10);
};

// Pendenzenliste des Mandanten als Excel erstellen und direkt im Ablage-Ordner des Mandanten
// speichern (20261117_Pendenzenliste_Mandant.xlsx). Ohne verbundenen Ordner: Download.
export default function PendenzenlisteExport({ mandant, klein = false }) {
  const grund = useAblageGrund();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState(null);
  if (!mandant) return null;

  async function erstellen(e) {
    e.stopPropagation();
    setLaeuft(true);
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
      const pendenzen = await api.pendenzen.fuerListe(mandant.id, minusTage(heute, ERLEDIGT_TAGE));
      const { blob, name, anzahlOffen } = pendenzenlisteXlsx(mandant, pendenzen, heute);
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
      setLaeuft(false);
    }
  }

  return (
    <span className="pl-export">
      <button type="button" className={klein ? 'btn-klein' : 'btn'} onClick={erstellen} disabled={laeuft}
        title="Offene (und in den letzten 90 Tagen erledigte) Pendenzen als Excel im Ordner des Mandanten ablegen">
        {laeuft ? 'Erstellt…' : '📊 Pendenzenliste Excel'}
      </button>
      {meldung && <span className={`pl-meldung ${meldung.ok ? 'ok' : 'fehler'}`}>{meldung.text}</span>}
    </span>
  );
}
