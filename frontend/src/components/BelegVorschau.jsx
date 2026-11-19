import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api.js';
import { dateiLesen, herunterladen, leseZugriffErlauben } from '../lib/ablageOrdner.js';

// Typ aus dem Dateinamen, falls die Datei keinen (oder einen allgemeinen) Typ mitbringt.
function typVon(datei, blob) {
  const t = blob?.type && blob.type !== 'application/octet-stream' ? blob.type : datei.typ;
  if (t && t !== 'application/octet-stream') return t;
  const endung = String(datei.dateiname).split('.').pop().toLowerCase();
  return {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain', csv: 'text/plain',
  }[endung] ?? 'application/octet-stream';
}

// Beleg direkt in der App ansehen (ueber der Pendenz): PDF, Bilder und Text. Noch in der App
// gespeicherte Belege kommen aus dem Speicher, bereits abgelegte aus dem verbundenen
// OneDrive-Ordner. Andere Formate (z.B. Word, Outlook-Mail) lassen sich herunterladen.
export default function BelegVorschau({ datei, onSchliessen }) {
  const [inhalt, setInhalt] = useState(null);
  const [fehler, setFehler] = useState(null);
  // Nach einem Neustart fragt der Browser einmal nach dem Lesezugriff auf den Ablageordner.
  const [zugriffNoetig, setZugriffNoetig] = useState(false);
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    let url = null;
    let aktiv = true;
    (async () => {
      try {
        const roh = datei.speicherpfad ? await api.dateien.blob(datei) : await dateiLesen(datei.abgelegt_in);
        const typ = typVon(datei, roh);
        const blob = new Blob([roh], { type: typ });
        url = URL.createObjectURL(blob);
        if (aktiv) setInhalt({ url, typ, blob });
      } catch (err) {
        if (!aktiv) return;
        if (err?.code === 'ZUGRIFF') setZugriffNoetig(true);
        else setFehler(err.message);
      }
    })();
    return () => { aktiv = false; if (url) URL.revokeObjectURL(url); };
  }, [datei, versuch]);

  async function zugriffErlauben() {
    try {
      if (await leseZugriffErlauben()) { setZugriffNoetig(false); setFehler(null); setVersuch((n) => n + 1); }
      else setFehler('Kein Zugriff auf den Ablageordner erteilt.');
    } catch {
      setFehler('Der Zugriff auf den Ablageordner konnte nicht erteilt werden.');
    }
  }

  useEffect(() => {
    const taste = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onSchliessen(); } };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [onSchliessen]);

  const anzeigbar = inhalt && (inhalt.typ === 'application/pdf' || inhalt.typ.startsWith('image/') || inhalt.typ.startsWith('text/'));

  return createPortal(
    <div className="beleg-hintergrund" onMouseDown={(e) => { if (e.target === e.currentTarget) onSchliessen(); }}>
      <div className="beleg-fenster" role="dialog" aria-modal="true" aria-label={`Beleg ${datei.dateiname}`}>
        <div className="beleg-kopf">
          <span className="beleg-name" title={datei.abgelegt_in || datei.dateiname}>📄 {datei.dateiname}</span>
          {inhalt && (
            <>
              <button type="button" className="btn-klein" onClick={() => window.open(inhalt.url, '_blank', 'noopener')}>In neuem Fenster</button>
              <button type="button" className="btn-klein" onClick={() => herunterladen(inhalt.blob, datei.dateiname)}>Herunterladen</button>
            </>
          )}
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen" autoFocus>×</button>
        </div>
        <div className="beleg-inhalt">
          {fehler && <div className="hinweis-fehler beleg-meldung">{fehler}</div>}
          {zugriffNoetig && !fehler && (
            <div className="beleg-meldung">
              Der Beleg liegt im Ablageordner. Der Browser braucht einmal deine Erlaubnis, ihn zu lesen.
              <button type="button" className="btn btn-primary" onClick={zugriffErlauben}>Zugriff erlauben und anzeigen</button>
            </div>
          )}
          {!fehler && !inhalt && !zugriffNoetig && <div className="beleg-meldung">Beleg wird geladen…</div>}
          {inhalt?.typ === 'application/pdf' && <iframe title={datei.dateiname} src={inhalt.url} className="beleg-rahmen" />}
          {inhalt?.typ.startsWith('image/') && <div className="beleg-bild"><img src={inhalt.url} alt={datei.dateiname} /></div>}
          {inhalt?.typ.startsWith('text/') && <iframe title={datei.dateiname} src={inhalt.url} className="beleg-rahmen beleg-text" />}
          {inhalt && !anzeigbar && (
            <div className="beleg-meldung">
              Dieses Format ({datei.dateiname.split('.').pop()}) kann hier nicht angezeigt werden.
              <button type="button" className="btn" onClick={() => herunterladen(inhalt.blob, datei.dateiname)}>Herunterladen und öffnen</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
