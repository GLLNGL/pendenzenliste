import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { meldeMandantenAenderung } from '../events.js';

export default function MandantModal({ mandant, onSchliessen, onGespeichert }) {
  const [formular, setFormular] = useState(() => ({
    name: mandant?.name ?? '',
    kuerzel: mandant?.kuerzel ?? '',
    email: mandant?.email ?? '',
    geschaeftsfuehrungEmail: mandant?.geschaeftsfuehrung_email ?? '',
    aktiv: mandant?.aktiv ?? 1,
    notizen: mandant?.notizen ?? '',
  }));
  const [fehler, setFehler] = useState(null);
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onSchliessen();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  function feldAendern(name, wert) {
    setFormular((f) => ({ ...f, [name]: wert }));
  }

  async function speichern(e) {
    e.preventDefault();
    if (!formular.name.trim()) { setFehler('Name ist erforderlich'); return; }
    setSpeichertGerade(true);
    setFehler(null);
    try {
      const payload = {
        name: formular.name.trim(),
        kuerzel: formular.kuerzel.trim() || null,
        email: formular.email.trim() || null,
        geschaeftsfuehrungEmail: formular.geschaeftsfuehrungEmail.trim() || null,
        aktiv: formular.aktiv ? 1 : 0,
        notizen: formular.notizen.trim() || null,
      };
      const ergebnis = mandant
        ? await api.mandanten.aktualisieren(mandant.id, payload)
        : await api.mandanten.erstellen(payload);
      meldeMandantenAenderung();
      onGespeichert(ergebnis);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>{mandant ? 'Mandant bearbeiten' : 'Neuer Mandant'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>

        <form onSubmit={speichern}>
          <div className="modal-koerper">
            <div className="feld">
              <label htmlFor="mandant-name">Name *</label>
              <input id="mandant-name" ref={nameRef} type="text" value={formular.name} onChange={(e) => feldAendern('name', e.target.value)} required />
            </div>
            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="mandant-kuerzel">Kürzel</label>
                <input id="mandant-kuerzel" type="text" value={formular.kuerzel} onChange={(e) => feldAendern('kuerzel', e.target.value)} maxLength={10} />
              </div>
              <div className="feld">
                <label htmlFor="mandant-status">Status</label>
                <select id="mandant-status" value={formular.aktiv ? '1' : '0'} onChange={(e) => feldAendern('aktiv', e.target.value === '1')}>
                  <option value="1">Aktiv</option>
                  <option value="0">Inaktiv</option>
                </select>
              </div>
            </div>
            <div className="feld">
              <label htmlFor="mandant-email">Ansprechpartner/in E-Mail</label>
              <input id="mandant-email" type="email" value={formular.email} onChange={(e) => feldAendern('email', e.target.value)} placeholder="kontakt@mandant.ch" />
              <p className="feld-hinweis">Für die laufende Kommunikation – wird beim E-Mail-Versand automatisch vorausgefüllt.</p>
            </div>
            <div className="feld">
              <label htmlFor="mandant-email-gf">E-Mail Geschäftsführung / Inhaber</label>
              <input
                id="mandant-email-gf"
                type="email"
                value={formular.geschaeftsfuehrungEmail}
                onChange={(e) => feldAendern('geschaeftsfuehrungEmail', e.target.value)}
                placeholder="inhaber@mandant.ch"
              />
              <p className="feld-hinweis">Optional, nur für grundsätzliche Fragen – muss beim Versand manuell ausgewählt werden.</p>
            </div>
            <div className="feld">
              <label htmlFor="mandant-notizen">Notizen</label>
              <textarea id="mandant-notizen" value={formular.notizen} onChange={(e) => feldAendern('notizen', e.target.value)} />
            </div>
            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>
          <div className="modal-fuss">
            <div />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
              <button type="submit" className="btn btn-primary" disabled={speichertGerade}>Speichern</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
