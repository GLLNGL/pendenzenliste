import { useRef, useState } from 'react';
import api from '../api.js';
import { useAblageGrund } from '../hooks.js';
import { relativerOrdner, segmente } from '../lib/ablage.js';
import { unterstuetzt, zielOrdnerWaehlen, dateiInOrdnerSchreiben } from '../lib/ablageOrdner.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';

// Fuer Pendenzen im Status "Warten auf" (z.B. Offerte nachfassen): Antwort des Kunden ablegen
// und das Ganze neu terminieren. Die E-Mail (aus Outlook hierher ziehen oder als Datei waehlen)
// haengt an der Pendenz; mit «Im Laufwerk ablegen…» waehlst du den Ablageordner (Start im
// Mail-Ordner des Mandanten). Notiz und neues Nachfassdatum werden zusammen gespeichert.
export default function AntwortErhalten({ pendenz, mandant, onGeaendert }) {
  const grund = useAblageGrund();
  const [text, setText] = useState('');
  const [datum, setDatum] = useState('');
  const [ziehen, setZiehen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState(null);
  // Angehaengte, noch nicht im Laufwerk abgelegte Mails ({ datei, file }).
  const [abzulegen, setAbzulegen] = useState([]);
  const eingabeRef = useRef(null);
  const heute = heutigesDatumISO();

  // Zuerst an die Pendenz haengen (beim Hineinziehen erlaubt der Browser keine Ordnerauswahl);
  // danach waehlst du mit «Im Laufwerk ablegen…» den Ablageordner.
  async function dateienAnhaengen(files) {
    if (!files.length) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      const neu = [];
      for (const f of files) {
        const datei = await api.dateien.hochladen(f, { pendenzId: pendenz.id, mandantId: pendenz.mandant_id, quelle: 'mail' });
        neu.push({ datei, file: f });
      }
      setAbzulegen((alt) => [...alt, ...neu]);
      setMeldung({ ok: true, text: `An die Pendenz gehängt: ${neu.map((n) => n.file.name).join(', ')}.` });
      onGeaendert?.();
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
    } finally {
      setLaeuft(false);
    }
  }

  async function imLaufwerkAblegen() {
    setMeldung(null);
    try {
      const vorschlag = [...(relativerOrdner(mandant, grund) ?? []), ...segmente(grund.unterordnerMail)];
      const ziel = await zielOrdnerWaehlen(vorschlag);
      if (!ziel) return;
      setLaeuft(true);
      const pfade = [];
      for (const { datei, file } of abzulegen) {
        const pfad = await dateiInOrdnerSchreiben(file, file.name, ziel);
        await api.dateien.abgelegt(datei, { ziel: pfad, entfernen: true });
        pfade.push(pfad);
      }
      setAbzulegen([]);
      setMeldung({ ok: true, text: `Abgelegt: ${pfade.join(', ')}` });
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
        onDrop={(e) => { e.preventDefault(); setZiehen(false); dateienAnhaengen([...(e.dataTransfer?.files ?? [])]); }}
      >
        {laeuft ? 'Wird abgelegt…' : <>E-Mail aus Outlook hierher ziehen oder <button type="button" className="link-knopf" onClick={() => eingabeRef.current?.click()}>Datei wählen</button></>}
        <input ref={eingabeRef} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; dateienAnhaengen(f); }} />
      </div>
      {abzulegen.length > 0 && unterstuetzt() && (
        <div className="antwort-ablegen">
          <span>{abzulegen.length === 1 ? '1 Mail' : `${abzulegen.length} Mails`} noch nicht im Laufwerk.</span>
          <button type="button" className="btn-klein" onClick={imLaufwerkAblegen} disabled={laeuft}>Im Laufwerk ablegen…</button>
        </div>
      )}
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Was wurde vereinbart? z.B. «Kunde gibt bis Ende Monat Bescheid»" aria-label="Antwort / Vereinbarung" />
      <div className="antwort-aktion">
        <label>Neu nachfassen am <input type="date" value={datum} min={heute} onChange={(e) => setDatum(e.target.value)} /></label>
        <button type="button" className="btn btn-primary" onClick={terminieren} disabled={laeuft || !datum}>Neu terminieren</button>
      </div>
      {meldung && <div className={meldung.ok ? 'hinweis-erfolg' : 'hinweis-fehler'}>{meldung.text}</div>}
    </section>
  );
}
