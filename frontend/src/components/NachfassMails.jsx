import { useEffect, useState } from 'react';
import api from '../api.js';
import { meldeAenderung } from '../events.js';
import { useAuth } from '../AuthContext.jsx';
import { datumPlusTage, formatiereDatum, heutigesDatumISO } from '../format.js';
import { baueErinnerung, NACHFASS_ABSTAND_TAGE } from '../lib/wochenrueckblick.js';

// Nachfassen (Etappe 5): fuer alle "Warten auf" mit faelligem Nachfassdatum eine
// Erinnerungs-Mail VORBEREITEN. Nichts wird automatisch gesendet -- jede Mail wird geprueft
// und einzeln per Klick verschickt (ueber die bestehende Mail-Funktion, mit Protokoll an der
// Pendenz) oder im eigenen Mailprogramm geoeffnet. Danach wird das naechste Nachfassdatum
// gesetzt (Standard: in 7 Tagen) und im Fortschritt vermerkt.
function Entwurf({ pendenz, absender, onErledigt }) {
  const [mail, setMail] = useState(() => baueErinnerung(pendenz, absender));
  const [naechstesDatum, setNaechstesDatum] = useState(() => datumPlusTage(heutigesDatumISO(), NACHFASS_ABSTAND_TAGE));
  const [zustand, setZustand] = useState('offen'); // offen | sendet | erledigt
  const [fehler, setFehler] = useState(null);
  const [mailprogrammGeoeffnet, setMailprogrammGeoeffnet] = useState(false);

  function feld(name, wert) {
    setMail((m) => ({ ...m, [name]: wert }));
  }

  async function abschliessen(wie) {
    await api.pendenzen.nachgefasst(pendenz.id, naechstesDatum, wie);
    setZustand('erledigt');
    onErledigt();
  }

  async function senden() {
    if (!mail.an.trim()) { setFehler('Bitte eine Empfänger-Adresse eingeben.'); return; }
    setZustand('sendet');
    setFehler(null);
    try {
      await api.mail.senden({ an: mail.an.trim(), betreff: mail.betreff, text: mail.text, pendenzId: pendenz.id });
      await abschliessen(`E-Mail an ${mail.an.trim()}`);
    } catch (err) {
      setFehler(err.message);
      setZustand('offen');
    }
  }

  async function ohneMailMarkieren(wie) {
    try {
      await abschliessen(wie);
    } catch (err) {
      setFehler(err.message);
    }
  }

  const mailtoLink = `mailto:${encodeURIComponent(mail.an.trim())}?subject=${encodeURIComponent(mail.betreff)}&body=${encodeURIComponent(mail.text)}`;

  return (
    <div className={`nachfass-entwurf ${zustand === 'erledigt' ? 'erledigt' : ''}`}>
      <div className="nachfass-kopf">
        <strong>{pendenz.mandant_name ? `${pendenz.mandant_name}: ` : ''}{pendenz.titel}</strong>
        <span className="nachfass-meta">
          wartet auf {pendenz.warten_auf_person} · Nachfassen fällig seit {formatiereDatum(pendenz.wiedervorlage)}
        </span>
      </div>

      {zustand === 'erledigt' ? (
        <div className="hinweis-erfolg">Nachgefasst – nächstes Nachfassen am {formatiereDatum(naechstesDatum)}.</div>
      ) : (
        <>
          <input type="email" placeholder="Empfänger-E-Mail" value={mail.an} onChange={(e) => feld('an', e.target.value)} />
          <input type="text" value={mail.betreff} onChange={(e) => feld('betreff', e.target.value)} />
          <textarea rows={7} value={mail.text} onChange={(e) => feld('text', e.target.value)} />
          <div className="nachfass-aktionen">
            <label className="nachfass-datum">
              Nächstes Nachfassen
              <input type="date" value={naechstesDatum} onChange={(e) => setNaechstesDatum(e.target.value)} />
            </label>
            <div className="nachfass-knoepfe">
              <a className="btn" href={mailtoLink} onClick={() => setMailprogrammGeoeffnet(true)}>Im Mailprogramm öffnen</a>
              {mailprogrammGeoeffnet ? (
                <button type="button" className="btn" onClick={() => ohneMailMarkieren('E-Mail aus dem Mailprogramm')}>Ist gesendet – als nachgefasst markieren</button>
              ) : (
                <button type="button" className="btn" onClick={() => ohneMailMarkieren('telefonisch/anderweitig')}>Anders nachgefasst</button>
              )}
              <button type="button" className="btn btn-primary" onClick={senden} disabled={zustand === 'sendet'}>
                {zustand === 'sendet' ? 'Sende…' : 'Senden'}
              </button>
            </div>
          </div>
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
        </>
      )}
    </div>
  );
}

export default function NachfassMails({ pendenzen, onSchliessen }) {
  const { benutzer } = useAuth();
  // Liste beim Oeffnen einfrieren -- sonst verschwindet ein Entwurf (samt Bestaetigung) aus dem
  // Fenster, sobald sein Nachfassdatum verschoben und die Liste neu geladen wurde.
  const [liste] = useState(pendenzen);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className="modal modal-breit" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>Erinnerungen vorbereiten ({liste.length})</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>
        <div className="modal-koerper">
          <p className="feld-hinweis">
            Entwürfe für alle «Warten auf» mit fälligem Nachfassdatum. Nichts wird automatisch gesendet –
            jede Mail prüfen, anpassen und einzeln senden.
          </p>
          {liste.length === 0 && <div className="leer-hinweis">Nichts zum Nachfassen.</div>}
          {liste.map((p) => (
            <Entwurf key={p.id} pendenz={p} absender={benutzer?.name} onErledigt={meldeAenderung} />
          ))}
        </div>
        <div className="modal-fuss">
          <div />
          <button type="button" className="btn" onClick={onSchliessen}>Schliessen</button>
        </div>
      </div>
    </div>
  );
}
