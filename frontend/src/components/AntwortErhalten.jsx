import { useRef, useState } from 'react';
import api from '../api.js';
import { useAblageGrund } from '../hooks.js';
import { relativerOrdner, segmente } from '../lib/ablage.js';
import { unterstuetzt, grundOrdnerHolen, dateiAblegen } from '../lib/ablageOrdner.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';

// Fuer Pendenzen im Status "Warten auf" (z.B. Offerte nachfassen): Antwort des Kunden ablegen
// und das Ganze neu terminieren. Die E-Mail (aus Outlook hierher ziehen oder als Datei waehlen)
// haengt an der Pendenz und wird -- wenn der Grundordner verbunden ist -- gleich im Mail-Ordner
// des Mandanten abgelegt. Notiz und neues Nachfassdatum werden zusammen gespeichert.
export default function AntwortErhalten({ pendenz, mandant, onGeaendert }) {
  const grund = useAblageGrund();
  const [text, setText] = useState('');
  const [datum, setDatum] = useState('');
  const [ziehen, setZiehen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState(null);
  const eingabeRef = useRef(null);
  const heute = heutigesDatumISO();

  async function dateienAblegen(files) {
    if (!files.length) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      // Schreibrecht fuer den Ablage-Ordner gleich zu Beginn (Benutzeraktion) anfragen.
      const ordner = relativerOrdner(mandant, grund);
      let handle = null;
      if (unterstuetzt() && ordner?.length) {
        handle = await grundOrdnerHolen();
        if (handle && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
          && (await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')) !== 'granted') handle = null;
      }
      const namen = [];
      for (const f of files) {
        const datei = await api.dateien.hochladen(f, { pendenzId: pendenz.id, mandantId: pendenz.mandant_id, quelle: 'mail' });
        if (handle) {
          const ziel = await dateiAblegen(f, f.name, [...ordner, ...segmente(grund.unterordnerMail)], handle);
          await api.dateien.abgelegt(datei, { ziel, entfernen: true });
          namen.push(`${f.name} → ${ziel}`);
        } else {
          namen.push(f.name);
        }
      }
      setMeldung({ ok: true, text: handle ? `Abgelegt: ${namen.join(', ')}` : `An die Pendenz gehängt: ${namen.join(', ')} (Ablage-Ordner nicht verbunden – unter «Dateien» ablegen).` });
      onGeaendert?.();
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
    } finally {
      setLaeuft(false);
    }
  }

  async function terminieren() {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(datum) || datum < heute) { setMeldung({ ok: false, text: 'Bitte ein neues Nachfassdatum (heute oder später) wählen.' }); return; }
    setLaeuft(true);
    setMeldung(null);
    try {
      if (text.trim()) await api.pendenzen.notizErstellen(pendenz.id, `Antwort erhalten: ${text.trim()}`);
      await api.pendenzen.aktualisieren(pendenz.id, {
        status: 'Warten auf', wartenAufPerson: pendenz.warten_auf_person || mandant?.name || 'Kunde', wiedervorlage: datum, warteSeit: pendenz.warte_seit,
      });
      setText('');
      setDatum('');
      setMeldung({ ok: true, text: `Neu terminiert: nachfassen am ${formatiereDatum(datum)}.` });
      onGeaendert?.();
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="antwort-box" aria-label="Antwort erhalten">
      <div className="antwort-kopf">
        <span className="antwort-titel">↩ Antwort erhalten?</span>
        <span className="antwort-info">wartet auf {pendenz.warten_auf_person || '–'}{pendenz.wiedervorlage ? ` · nachfassen ${formatiereDatum(pendenz.wiedervorlage)}` : ''}</span>
      </div>
      <div
        className={`antwort-ablage ${ziehen ? 'aktiv' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
        onDragLeave={() => setZiehen(false)}
        onDrop={(e) => { e.preventDefault(); setZiehen(false); dateienAblegen([...(e.dataTransfer?.files ?? [])]); }}
      >
        {laeuft ? 'Wird abgelegt…' : <>E-Mail aus Outlook hierher ziehen oder <button type="button" className="link-knopf" onClick={() => eingabeRef.current?.click()}>Datei wählen</button></>}
        <input ref={eingabeRef} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; dateienAblegen(f); }} />
      </div>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Was wurde vereinbart? z.B. «Kunde gibt bis Ende Monat Bescheid»" aria-label="Antwort / Vereinbarung" />
      <div className="antwort-aktion">
        <label>Neu nachfassen am <input type="date" value={datum} min={heute} onChange={(e) => setDatum(e.target.value)} /></label>
        <button type="button" className="btn btn-primary" onClick={terminieren} disabled={laeuft || !datum}>Neu terminieren</button>
      </div>
      {meldung && <div className={meldung.ok ? 'hinweis-erfolg' : 'hinweis-fehler'}>{meldung.text}</div>}
    </section>
  );
}
