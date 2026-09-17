import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { meldeMitarbeitendeAenderung } from '../events.js';

export default function MitarbeiterModal({ mitarbeiter, onSchliessen, onGespeichert, onGeloescht }) {
  const [name, setName] = useState(mitarbeiter?.name ?? '');
  const [email, setEmail] = useState(mitarbeiter?.email ?? '');
  const [aktiv, setAktiv] = useState(mitarbeiter?.aktiv ?? 1);
  const loginAktiv = !!mitarbeiter?.login_aktiv;
  const [fehler, setFehler] = useState(null);
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  async function speichern(e) {
    e.preventDefault();
    if (!name.trim()) { setFehler('Name ist erforderlich'); return; }
    setSpeichertGerade(true);
    setFehler(null);
    try {
      const payload = { name: name.trim(), email: email.trim() || null, aktiv: aktiv ? 1 : 0 };
      const ergebnis = mitarbeiter
        ? await api.mitarbeitende.aktualisieren(mitarbeiter.id, payload)
        : await api.mitarbeitende.erstellen(payload);
      meldeMitarbeitendeAenderung();
      onGespeichert(ergebnis);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  async function loeschen() {
    if (!mitarbeiter) return;
    if (!window.confirm(`"${mitarbeiter.name}" wirklich loeschen?`)) return;
    setSpeichertGerade(true);
    try {
      await api.mitarbeitende.loeschen(mitarbeiter.id);
      meldeMitarbeitendeAenderung();
      onGeloescht(mitarbeiter);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>{mitarbeiter ? 'Mitarbeiter/in bearbeiten' : 'Neue/r Mitarbeiter/in'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>
        <form onSubmit={speichern}>
          <div className="modal-koerper">
            <div className="feld">
              <label htmlFor="mitarbeiter-name">Name *</label>
              <input id="mitarbeiter-name" ref={nameRef} type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="feld">
              <label htmlFor="mitarbeiter-email">E-Mail (Adresse für Pendenz-Zuweisungen)</label>
              <input id="mitarbeiter-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@estcontrolling.ch" />
            </div>
            <div className="feld">
              <label htmlFor="mitarbeiter-status">Status</label>
              <select id="mitarbeiter-status" value={aktiv ? '1' : '0'} onChange={(e) => setAktiv(e.target.value === '1')}>
                <option value="1">Aktiv</option>
                <option value="0">Inaktiv</option>
              </select>
            </div>

            {mitarbeiter && (
              <div className="feld">
                <label>Login</label>
                <span className="teilaufgaben-hinweis">
                  {loginAktiv
                    ? 'Login ist aktiv. Passwort zurücksetzen oder Zugang entfernen: im Supabase-Dashboard unter Authentication → Users.'
                    : 'Kein Login. Ein Konto für diese Person wird im Supabase-Dashboard mit genau dieser E-Mail-Adresse angelegt und automatisch verknüpft.'}
                </span>
              </div>
            )}
            {!mitarbeiter && (
              <p className="teilaufgaben-hinweis">Login-Zugang wird nach dem Speichern im Supabase-Dashboard eingerichtet (Authentication → Users, mit derselben E-Mail-Adresse).</p>
            )}

            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>
          <div className="modal-fuss">
            <div>
              {mitarbeiter && <button type="button" className="btn btn-gefahr" onClick={loeschen} disabled={speichertGerade}>Löschen</button>}
            </div>
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
