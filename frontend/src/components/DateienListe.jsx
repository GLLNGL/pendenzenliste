import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { useAblageGrund } from '../hooks.js';
import { relativerOrdner, segmente } from '../lib/ablage.js';
import { unterstuetzt, herunterladen, zielOrdnerWaehlen, dateiInOrdnerSchreiben, leseZugriffErlauben } from '../lib/ablageOrdner.js';
import BelegVorschau from './BelegVorschau.jsx';

function groesseText(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Dateien einer Pendenz (inkl. ihrer Teilschritte) bzw. eines Mandanten: oeffnen, in den
// OneDrive-Ordner des Mandanten ablegen (Edge/Chrome direkt, sonst Download), loeschen und
// optional neue Dateien hochladen.
//   pendenzIds: Dateien dieser Pendenzen   mandantId: oder alle Dateien des Mandanten
//   mandant:    fuer die Ablage            hochladenFuer: { pendenzId, mandantId } -> Upload-Knopf
export default function DateienListe({ pendenzIds, mandantId, mandant, hochladenFuer, titel = 'Dateien', leerAusblenden = false }) {
  const [dateien, setDateien] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [beschaeftigt, setBeschaeftigt] = useState(null);
  const [meldung, setMeldung] = useState(null);
  // Belege (z.B. PDF-Schreiben des Steueramts) per Drag & Drop anhaengen.
  const [ziehen, setZiehen] = useState(false);
  // Beleg in der App ansehen (PDF/Bild), statt in einem neuen Browserfenster.
  const [ansicht, setAnsicht] = useState(null);
  const grund = useAblageGrund();
  const eingabeRef = useRef(null);
  const schluessel = pendenzIds ? pendenzIds.join(',') : `m${mandantId}`;

  const laden = useCallback(() => {
    const filter = pendenzIds ? { pendenzIds } : { mandantId };
    api.dateien.liste(filter).then(setDateien).catch((e) => { setDateien([]); setFehler(e.message); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel]);
  useEffect(() => { laden(); }, [laden]);

  if (dateien == null) return null;
  if (fehler && /schema cache|does not exist|relation/i.test(fehler)) {
    return leerAusblenden ? null : <div className="dateien-liste dateien-leer">Dateien: noch nicht eingerichtet – bitte <code>supabase/mandanten-onboarding-v7.sql</code> ausführen.</div>;
  }
  if (leerAusblenden && dateien.length === 0 && !hochladenFuer) return null;

  const ordner = relativerOrdner(mandant, grund);
  // Ablage: Ordnerauswahl (startet im Ordner des Mandanten) -- du bestimmst jedes Mal den Ort.
  const direkt = unterstuetzt();

  async function ablegen(d) {
    setFehler(null);
    setMeldung(null);
    try {
      // Ordnerauswahl zuerst -- der Browser erlaubt sie nur direkt nach dem Klick.
      let zielOrdner = null;
      if (direkt) {
        const unter = d.quelle === 'mail' ? segmente(grund.unterordnerMail) : [];
        zielOrdner = await zielOrdnerWaehlen([...(ordner ?? []), ...unter]);
        if (!zielOrdner) return;
      }
      setBeschaeftigt(d.id);
      const blob = await api.dateien.blob(d);
      if (zielOrdner) {
        const ziel = await dateiInOrdnerSchreiben(blob, d.dateiname, zielOrdner);
        // Liegt sicher im OneDrive-Ordner -> aus dem Speicher der App entfernen.
        await api.dateien.abgelegt(d, { ziel, entfernen: true });
        setMeldung(`Abgelegt: ${ziel}`);
      } else {
        herunterladen(blob, d.dateiname);
        await api.dateien.abgelegt(d);
        setMeldung(`«${d.dateiname}» heruntergeladen – bitte in die Ablage des Mandanten verschieben. Danach mit × aus der App entfernen.`);
      }
      laden();
    } catch (err) {
      if (err?.name !== 'AbortError') setFehler(err.message);
    } finally {
      setBeschaeftigt(null);
    }
  }

  // Abgelegter Beleg: Lesezugriff gleich im Klick erlauben lassen (spaeter blockiert der Browser
  // die Rueckfrage), dann anzeigen.
  async function belegAnsehen(d) {
    try { await leseZugriffErlauben(); } catch { /* das Ansichtsfenster bietet die Erlaubnis nochmals an */ }
    setAnsicht(d);
  }

  async function loeschen(d) {
    if (!window.confirm(d.speicherpfad ? `«${d.dateiname}» aus der App löschen? (Bereits abgelegte Kopien bleiben in OneDrive.)` : `Eintrag «${d.dateiname}» entfernen? Die Datei in OneDrive bleibt.`)) return;
    try { await api.dateien.loeschen(d); laden(); } catch (err) { setFehler(err.message); }
  }

  async function hochladen(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    await dateienHochladen(files);
  }

  async function dateienHochladen(files) {
    if (!files.length || !hochladenFuer) return;
    setBeschaeftigt('upload');
    setFehler(null);
    try {
      for (const f of files) await api.dateien.hochladen(f, hochladenFuer);
      laden();
    } catch (err) { setFehler(err.message); } finally { setBeschaeftigt(null); }
  }

  const ablageTitel = direkt
    ? `Ablageordner wählen und dort speichern${ordner?.length ? ` (startet in ${ordner.join('\\')})` : ''}`
    : 'Herunterladen (direkt ablegen: Edge/Chrome am PC)';

  return (
    <div
      className={`dateien-liste ${ziehen ? 'dateien-ziehen' : ''}`}
      onClick={(e) => e.stopPropagation()}
      onDragOver={hochladenFuer ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setZiehen(true); } : undefined}
      onDragLeave={hochladenFuer ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setZiehen(false); } : undefined}
      onDrop={hochladenFuer ? (e) => { e.preventDefault(); setZiehen(false); dateienHochladen([...(e.dataTransfer?.files ?? [])]); } : undefined}
    >
      <div className="dateien-kopf">
        <span className="dateien-titel">📎 {titel}{dateien.length > 0 && ` (${dateien.length})`}</span>
        {hochladenFuer && (
          <>
            <button type="button" className="btn-klein" onClick={() => eingabeRef.current?.click()} disabled={beschaeftigt === 'upload'}>
              {beschaeftigt === 'upload' ? 'Lädt hoch…' : '+ Beleg anhängen'}
            </button>
            <input ref={eingabeRef} type="file" multiple hidden onChange={hochladen} />
          </>
        )}
      </div>
      {dateien.length === 0 && <div className="dateien-leer">{hochladenFuer ? 'Noch keine Belege – PDF (z.B. Schreiben des Steueramts) hierher ziehen oder «+ Beleg anhängen».' : 'Keine Dateien.'}</div>}
      {ziehen && <div className="dateien-ablegen-hinweis">Loslassen, um anzuhängen</div>}
      {dateien.map((d) => (d.abgelegt_am && !d.speicherpfad ? (
        <div key={d.id} className="dateien-zeile dateien-zeile-abgelegt">
          {d.abgelegt_in
            ? <button type="button" className="link-knopf dateien-name" onClick={() => belegAnsehen(d)} title={`Ansehen (aus ${d.abgelegt_in})`}>{d.dateiname}</button>
            : <span className="dateien-name">{d.dateiname}</span>}
          <span className="dateien-abgelegt">✓ abgelegt am {new Date(d.abgelegt_am).toLocaleDateString('de-CH')}</span>
          {d.abgelegt_in && <span className="dateien-info dateien-ort">{d.abgelegt_in.split('\\').slice(0, -1).join('\\')}</span>}
          <span className="dateien-aktionen">
            <button type="button" className="btn-klein btn-gefahr-text" onClick={() => loeschen(d)} title="Eintrag entfernen (die Datei in OneDrive bleibt)">×</button>
          </span>
        </div>
      ) : (
        <div key={d.id} className="dateien-zeile">
          <button type="button" className="link-knopf dateien-name" onClick={() => setAnsicht(d)} title="Ansehen">{d.dateiname}</button>
          <span className="dateien-info">{groesseText(d.groesse)}</span>
          {d.abgelegt_am && <span className="dateien-abgelegt" title={`abgelegt am ${new Date(d.abgelegt_am).toLocaleString('de-CH')}`}>✓ abgelegt</span>}
          <span className="dateien-aktionen">
            <button type="button" className="btn-klein" onClick={() => ablegen(d)} disabled={beschaeftigt === d.id} title={ablageTitel}>
              {beschaeftigt === d.id ? '…' : direkt ? 'In Ablage speichern…' : 'Herunterladen'}
            </button>
            <button type="button" className="btn-klein btn-gefahr-text" onClick={() => loeschen(d)} title="Aus der App löschen">×</button>
          </span>
        </div>
      )))}
      {meldung && <div className="hinweis-erfolg">{meldung}</div>}
      {ansicht && <BelegVorschau datei={ansicht} onSchliessen={() => setAnsicht(null)} />}
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
    </div>
  );
}
