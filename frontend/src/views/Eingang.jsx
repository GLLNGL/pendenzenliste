import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api.js';
import PendenzModal from '../components/PendenzModal.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { formatiereZeitstempel, formatiereDatum, heutigesDatumISO } from '../format.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';

// Sammelbecken fuer noch nicht eingeplante Notizen -- sowohl unterwegs erfasst (siehe
// MobilErfassen.jsx) als auch direkt hier am PC (Schnellerfassung unten, gleiches Prinzip:
// geplant:false). Diese Pendenzen tauchen bewusst noch NICHT in Cockpit/Alle Pendenzen/
// Mandanten auf, bis sie hier geoeffnet und im vollen Formular gespeichert (= eingeplant)
// wurden.
function Schnellerfassung({ onErfasst }) {
  const [titel, setTitel] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [fehler, setFehler] = useState(null);
  const titelRef = useRef(null);

  async function speichern(e) {
    e.preventDefault();
    if (!titel.trim()) return;
    setSpeichertGerade(true);
    setFehler(null);
    try {
      await api.pendenzen.erstellen({
        titel: titel.trim(),
        beschreibung: bemerkung.trim() || null,
        faelligkeit: heutigesDatumISO(),
        prioritaet: 'B',
        status: 'Offen',
        geplant: false,
      });
      meldeAenderung();
      setTitel('');
      setBemerkung('');
      titelRef.current?.focus();
      onErfasst();
    } catch (err) {
      setFehler(err.message);
    } finally {
      setSpeichertGerade(false);
    }
  }

  return (
    <form className="eingang-schnellerfassung" onSubmit={speichern}>
      <input
        ref={titelRef}
        type="text"
        value={titel}
        onChange={(e) => setTitel(e.target.value)}
        placeholder="Neue Notiz -- Titel…"
      />
      <textarea
        value={bemerkung}
        onChange={(e) => setBemerkung(e.target.value)}
        placeholder="Bemerkung (optional)…"
        rows={2}
      />
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
      <button type="submit" className="btn btn-primary" disabled={!titel.trim() || speichertGerade}>
        {speichertGerade ? 'Speichert…' : '+ Erfassen'}
      </button>
    </form>
  );
}

// Triage fuer jeden Eingang (Arbeitsprozess): Aktion noetig? -> unter 2 Minuten? -> wartet auf
// Dritte? -> mehrere Schritte? -> sonst als Pendenz einplanen. Die Knoepfe stehen in genau
// dieser Reihenfolge. "Keine Aktion" und "Sofort erledigt" legen die Notiz als erledigt ab (mit
// begruendender Fortschrittsnotiz, nichts wird geloescht); die anderen oeffnen das
// Bearbeiten-Fenster passend vorbereitet.
function TriageKnoepfe({ eintrag, onAblegen, onOeffnen, onLoeschen }) {
  function klick(ev, aktion) {
    ev.stopPropagation();
    aktion();
  }
  return (
    <div className="triage-knoepfe">
      <button type="button" className="btn-klein btn-gefahr" title="Gar nicht behalten – endgültig löschen (z.B. Werbung, Irrläufer)" onClick={(ev) => klick(ev, () => onLoeschen(eintrag))}>
        Löschen
      </button>
      <button type="button" className="btn-klein" title="Keine Aktion nötig – als erledigt ablegen" onClick={(ev) => klick(ev, () => onAblegen(eintrag, 'keine'))}>
        Keine Aktion
      </button>
      <button type="button" className="btn-klein" title="In unter 2 Minuten erledigt – gleich jetzt machen und abhaken" onClick={(ev) => klick(ev, () => onAblegen(eintrag, 'sofort'))}>
        ✓ Sofort erledigt (&lt; 2 Min.)
      </button>
      <button type="button" className="btn-klein" title="Wartet auf Dritte – Person und Nachfassdatum erfassen" onClick={(ev) => klick(ev, () => onOeffnen({ ...eintrag, status: 'Warten auf' }, false, true))}>
        Warten auf …
      </button>
      <button type="button" className="btn-klein" title="Mehrere Schritte – als Projekt mit Schritten einplanen" onClick={(ev) => klick(ev, () => onOeffnen(eintrag, true))}>
        Projekt …
      </button>
      <button type="button" className="btn-klein btn-klein-primaer" title="Als Pendenz einplanen (Mandant, Frist, Aufwand, Priorität)" onClick={(ev) => klick(ev, () => onOeffnen(eintrag, false))}>
        Einplanen →
      </button>
    </div>
  );
}

export default function Eingang() {
  const [alleEintraege, setEintraege] = useState([]);
  // Teilschritte (z.B. aus E-Mails herausgelesene To-dos) erscheinen unter ihrem Eintrag, nicht einzeln.
  const eintraege = alleEintraege.filter((e) => e.uebergeordnete_pendenz_id == null);
  const schritteVon = (id) => alleEintraege.filter((e) => e.uebergeordnete_pendenz_id === id).sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
  const [fehler, setFehler] = useState(null);
  const [aktion, setAktion] = useState(null); // { pendenz, projektModus }
  const [abruf, setAbruf] = useState({ laeuft: false, meldung: null, fehler: null });

  // Auftraege aus dem Outlook-Ordner "Auftraege" abholen -- beim Oeffnen und per Knopf.
  const mailsAbholen = useCallback(async () => {
    setAbruf({ laeuft: true, meldung: null, fehler: null });
    try {
      const r = await api.mail.eingangAbholen();
      setAbruf({ laeuft: false, fehler: null, meldung: r?.hinweis || (r?.neu ? `${r.neu} neue${r.neu === 1 ? 'r Auftrag' : ' Aufträge'} aus E-Mail übernommen.` : 'Keine neuen Aufträge im Ordner «Aufträge».') });
      if (r?.neu) meldeAenderung();
    } catch (err) {
      setAbruf({ laeuft: false, meldung: null, fehler: err.message });
    }
  }, []);
  useEffect(() => {
    const zeitgeber = setTimeout(mailsAbholen, 0);
    return () => clearTimeout(zeitgeber);
  }, [mailsAbholen]);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    api.pendenzen.eingang().then(setEintraege).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  async function ablegen(eintrag, art) {
    try {
      await api.pendenzen.triageAblegen(eintrag.id, art);
      meldeAenderung();
      laden();
    } catch (err) {
      setFehler(err.message);
    }
  }

  // Endgueltig loeschen (mit Rueckfrage) -- fuer Eintraege, die gar nicht behalten werden sollen.
  // Teilschritte (To-dos) werden mitgeloescht.
  async function loeschen(eintrag) {
    const schritte = schritteVon(eintrag.id).length;
    const zusatz = schritte ? ` samt ${schritte} To-do${schritte === 1 ? '' : 's'}` : '';
    if (!window.confirm(`«${eintrag.titel}»${zusatz} endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
    try {
      await api.pendenzen.loeschen(eintrag.id);
      meldeAenderung();
      laden();
    } catch (err) {
      setFehler(err.message);
    }
  }

  function oeffnen(pendenz, projektModus, detail = false) {
    setAktion({ pendenz, projektModus, detail });
  }

  if (fehler) return <div className="fehleranzeige">Fehler: {fehler}</div>;

  return (
    <div>
      <h1 className="seiten-titel">
        Eingang
        {eintraege.length > 0 && <span className="zaehler-pille seiten-titel-pille">{eintraege.length}</span>}
      </h1>
      <p className="seiten-untertitel">
        Triage für jeden Eintrag: Aktion nötig? → unter 2 Minuten? → wartet auf Dritte? → mehrere Schritte? → sonst einplanen.
      </p>
      <div className="eingang-mail">
        <button type="button" className="btn" onClick={mailsAbholen} disabled={abruf.laeuft}>{abruf.laeuft ? 'Holt E-Mails…' : '✉ E-Mails abholen'}</button>
        <span className="eingang-mail-text">
          {abruf.fehler ? <span className="text-ueberfaellig">{abruf.fehler}</span> : (abruf.meldung || 'Aufträge per E-Mail: in Outlook in den Ordner «Aufträge» ziehen.')}
        </span>
      </div>

      <div className="karte">
        <Schnellerfassung onErfasst={laden} />
        {eintraege.length === 0 && <div className="leer-hinweis" style={{ padding: 24 }}>Eingang ist leer.</div>}
        {eintraege.map((e) => (
          <div
            key={e.id}
            className="eingang-eintrag"
            role="button"
            tabIndex={0}
            onClick={() => oeffnen(e, false)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') oeffnen(e, false); }}
          >
            <div className="eingang-eintrag-kopf">
              <span className="eingang-eintrag-titel">{e.email_message_id && <span className="eingang-mail-marke" title={`E-Mail von ${e.email_von ?? ''}`}>✉ </span>}{e.titel}</span>
              <span className="eingang-eintrag-datum">{formatiereZeitstempel(e.erstellt_am)}</span>
            </div>
            {e.beschreibung && <p className="eingang-eintrag-text">{e.beschreibung}</p>}
            {schritteVon(e.id).length > 0 && (
              <div className="eingang-todos">
                <div className="eingang-todos-titel">To-dos</div>
                <ul>
                  {schritteVon(e.id).map((s) => (
                    <li key={s.id}>{s.titel}{s.faelligkeit ? <span className="eingang-todo-frist"> · bis {formatiereDatum(s.faelligkeit)}</span> : null}</li>
                  ))}
                </ul>
              </div>
            )}
            <TriageKnoepfe eintrag={e} onAblegen={ablegen} onOeffnen={oeffnen} onLoeschen={loeschen} />
          </div>
        ))}
      </div>

      {aktion && (
        <PendenzModal
          key={aktion.pendenz.id}
          pendenz={aktion.pendenz}
          projektModus={aktion.projektModus}
          detail={aktion.detail}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setAktion(null)}
          onGespeichert={() => { setAktion(null); laden(); }}
          onGeloescht={() => { setAktion(null); laden(); }}
        />
      )}
    </div>
  );
}
