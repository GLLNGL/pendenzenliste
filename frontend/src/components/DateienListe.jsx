import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { useAblageGrund } from '../hooks.js';
import { relativerOrdner, segmente } from '../lib/ablage.js';
import { unterstuetzt, dateiAblegen, herunterladen } from '../lib/ablageOrdner.js';

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
  const direkt = unterstuetzt() && ordner?.length;

  async function oeffnen(d) {
    try {
      window.open(await api.dateien.link(d), '_blank', 'noopener');
    } catch (err) { setFehler(err.message); }
  }

  async function ablegen(d) {
    setBeschaeftigt(d.id);
    setFehler(null);
    setMeldung(null);
    try {
      const blob = await api.dateien.blob(d);
      if (direkt) {
        const unter = d.quelle === 'mail' ? segmente(grund.unterordnerMail) : [];
        const ziel = await dateiAblegen(blob, d.dateiname, [...ordner, ...unter]);
        setMeldung(`Abgelegt: ${ziel}`);
      } else {
        herunterladen(blob, d.dateiname);
        setMeldung(`«${d.dateiname}» heruntergeladen – bitte in die Ablage des Mandanten verschieben.`);
      }
      await api.dateien.abgelegt(d.id, true);
      laden();
    } catch (err) {
      if (err?.name !== 'AbortError') setFehler(err.message);
    } finally {
      setBeschaeftigt(null);
    }
  }

  async function loeschen(d) {
    if (!window.confirm(`«${d.dateiname}» aus der App löschen? (Bereits abgelegte Kopien bleiben in OneDrive.)`)) return;
    try { await api.dateien.loeschen(d); laden(); } catch (err) { setFehler(err.message); }
  }

  async function hochladen(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    setBeschaeftigt('upload');
    setFehler(null);
    try {
      for (const f of files) await api.dateien.hochladen(f, hochladenFuer);
      laden();
    } catch (err) { setFehler(err.message); } finally { setBeschaeftigt(null); }
  }

  const ablageTitel = direkt
    ? `Direkt in den Ordner «${ordner.join('\\')}» legen`
    : mandant ? 'Herunterladen (direkt ablegen: Grundordner in den Einstellungen verbinden, Edge/Chrome)' : 'Herunterladen (kein Mandant zugeordnet)';

  return (
    <div className="dateien-liste" onClick={(e) => e.stopPropagation()}>
      <div className="dateien-kopf">
        <span className="dateien-titel">📎 {titel}{dateien.length > 0 && ` (${dateien.length})`}</span>
        {hochladenFuer && (
          <>
            <button type="button" className="btn-klein" onClick={() => eingabeRef.current?.click()} disabled={beschaeftigt === 'upload'}>
              {beschaeftigt === 'upload' ? 'Lädt hoch…' : '+ Datei'}
            </button>
            <input ref={eingabeRef} type="file" multiple hidden onChange={hochladen} />
          </>
        )}
      </div>
      {dateien.length === 0 && <div className="dateien-leer">Keine Dateien.</div>}
      {dateien.map((d) => (
        <div key={d.id} className="dateien-zeile">
          <button type="button" className="link-knopf dateien-name" onClick={() => oeffnen(d)} title="Öffnen">{d.dateiname}</button>
          <span className="dateien-info">{groesseText(d.groesse)}</span>
          {d.abgelegt_am && <span className="dateien-abgelegt" title={`abgelegt am ${new Date(d.abgelegt_am).toLocaleString('de-CH')}`}>✓ abgelegt</span>}
          <span className="dateien-aktionen">
            <button type="button" className="btn-klein" onClick={() => ablegen(d)} disabled={beschaeftigt === d.id} title={ablageTitel}>
              {beschaeftigt === d.id ? '…' : direkt ? 'In Ablage speichern' : 'Herunterladen'}
            </button>
            <button type="button" className="btn-klein btn-gefahr-text" onClick={() => loeschen(d)} title="Aus der App löschen">×</button>
          </span>
        </div>
      ))}
      {meldung && <div className="hinweis-erfolg">{meldung}</div>}
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
    </div>
  );
}
