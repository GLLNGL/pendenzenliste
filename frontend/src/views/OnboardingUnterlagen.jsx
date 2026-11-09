import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api.js';
import FormularModal from '../components/FormularModal.jsx';

const PLATZHALTER = '{mandant}, {ansprechperson}, {unterlagen}, {bearbeiter}, {firma}';

// Programm "Onboarding-Unterlagen" (Kundenstamm): welche Dokumente ein neuer Mandant erhaelt
// (DL-Vertrag, Vollmacht, EBICS-Bestellung ...), je mit Vorlage zum Mitsenden, plus Text der
// Onboarding-Mail. Die Liste laesst sich jederzeit ergaenzen.
export default function OnboardingUnterlagen() {
  const [liste, setListe] = useState(null);
  const [texte, setTexte] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [bearbeitet, setBearbeitet] = useState(null); // Unterlage oder {} fuer neu
  const [ladeFuer, setLadeFuer] = useState(null);
  const dateiRef = useRef(null);
  const zielRef = useRef(null);

  const laden = useCallback(() => {
    api.onboarding.unterlagen.liste().then((l) => { setListe(l); setFehler(null); }).catch((e) => { setListe([]); setFehler(e.message); });
    api.buero.lesen('onboarding').then((w) => setTexte({ mailBetreff: w.mailBetreff ?? '', mailText: w.mailText ?? '' })).catch(() => setTexte({ mailBetreff: '', mailText: '' }));
  }, []);
  useEffect(() => { laden(); }, [laden]);

  function vorlageWaehlen(u) {
    zielRef.current = u;
    dateiRef.current?.click();
  }
  async function vorlageHochladen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const u = zielRef.current;
    if (!file || !u) return;
    setLadeFuer(u.id);
    setFehler(null);
    try {
      await api.onboarding.unterlagen.vorlageSetzen(u, file);
      setMeldung(`Vorlage für «${u.name}» gespeichert.`);
      laden();
    } catch (err) { setFehler(err.message); } finally { setLadeFuer(null); }
  }
  async function vorlageOeffnen(d) {
    try { window.open(await api.dateien.link(d), '_blank', 'noopener'); } catch (err) { setFehler(err.message); }
  }
  async function texteSpeichern(e) {
    e.preventDefault();
    try {
      await api.buero.speichern('onboarding', texte);
      setMeldung('Mailtext gespeichert.');
    } catch (err) { setFehler(err.message); }
  }

  if (liste == null) return null;
  const nichtEingerichtet = fehler && /relation|does not exist|schema cache/i.test(fehler);

  return (
    <div>
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Onboarding-Unterlagen</h1>
        <span className="cockpit-kopf-hinweis">Dokumente, die ein neuer Mandant nach der Annahme der Offerte erhält.</span>
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn btn-primary" onClick={() => setBearbeitet({})} disabled={nichtEingerichtet}>+ Unterlage</button>
        </span>
      </div>
      {nichtEingerichtet && <div className="hinweis-fehler">Noch nicht eingerichtet – bitte zuerst <code>supabase/mandanten-onboarding-v7.sql</code> in Supabase ausführen.</div>}
      {fehler && !nichtEingerichtet && <div className="hinweis-fehler">{fehler}</div>}
      {meldung && <div className="hinweis-erfolg">{meldung}</div>}

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr><th>Unterlage</th><th>Beschreibung</th><th>Zurück</th><th>Vorlage zum Mitsenden</th><th>Aktiv</th><th></th></tr>
          </thead>
          <tbody>
            {liste.map((u) => (
              <tr key={u.id} className={u.aktiv ? '' : 'inaktiv'}>
                <td><strong>{u.name}</strong></td>
                <td className="text-gedaempft">{u.beschreibung}</td>
                <td>{u.zurueck ? 'unterschrieben' : '–'}</td>
                <td>
                  {u.datei
                    ? <button type="button" className="link-knopf" onClick={() => vorlageOeffnen(u.datei)}>{u.datei.dateiname}</button>
                    : <span className="text-gedaempft">keine</span>}
                  {' '}
                  <button type="button" className="btn-klein" onClick={() => vorlageWaehlen(u)} disabled={ladeFuer === u.id}>
                    {ladeFuer === u.id ? 'Lädt…' : u.datei ? 'Ersetzen' : 'Hochladen'}
                  </button>
                </td>
                <td>{u.aktiv ? 'ja' : 'nein'}</td>
                <td><button type="button" className="btn-klein" onClick={() => setBearbeitet(u)}>Bearbeiten</button></td>
              </tr>
            ))}
            {liste.length === 0 && !nichtEingerichtet && <tr><td colSpan={6} className="leer-hinweis">Noch keine Unterlagen.</td></tr>}
          </tbody>
        </table>
        <input ref={dateiRef} type="file" hidden onChange={vorlageHochladen} accept=".pdf,.doc,.docx,.xls,.xlsx" />
      </div>

      {texte && (
        <>
          <h2 className="abschnitt-titel">Onboarding-Mail</h2>
          <form className="karte" style={{ maxWidth: 760 }} onSubmit={texteSpeichern}>
            <div className="modal-koerper">
              <div className="feld">
                <label htmlFor="onb-betreff">Betreff</label>
                <input id="onb-betreff" value={texte.mailBetreff} onChange={(e) => setTexte((t) => ({ ...t, mailBetreff: e.target.value }))} />
              </div>
              <div className="feld">
                <label htmlFor="onb-text">Text</label>
                <textarea id="onb-text" rows={10} value={texte.mailText} onChange={(e) => setTexte((t) => ({ ...t, mailText: e.target.value }))} />
                <p className="feld-hinweis">Platzhalter: {PLATZHALTER}. {'{unterlagen}'} wird zur Liste der mitgesendeten Dokumente.</p>
              </div>
            </div>
            <div className="modal-fuss">
              <div />
              <button type="submit" className="btn btn-primary">Speichern</button>
            </div>
          </form>
        </>
      )}

      {bearbeitet && (
        <FormularModal
          titel={bearbeitet.id ? `Unterlage «${bearbeitet.name}»` : 'Neue Unterlage'}
          startwerte={{
            name: bearbeitet.name ?? '', beschreibung: bearbeitet.beschreibung ?? '', zurueck: bearbeitet.zurueck ?? true,
            aktiv: bearbeitet.aktiv ?? true, reihenfolge: String(bearbeitet.reihenfolge ?? (liste.length + 1) * 10),
          }}
          felder={[
            { name: 'name', label: 'Name', typ: 'text', pflicht: true, platzhalter: 'z.B. Dienstleistungsvertrag' },
            { name: 'beschreibung', label: 'Beschreibung', typ: 'text' },
            { name: 'zurueck', label: 'Muss unterschrieben zurückkommen', typ: 'checkbox' },
            { name: 'aktiv', label: 'Aktiv (wird bei neuen Onboardings vorgeschlagen)', typ: 'checkbox' },
            { name: 'reihenfolge', label: 'Reihenfolge', typ: 'zahl', halb: true },
          ]}
          onSpeichern={async (f) => {
            await api.onboarding.unterlagen.speichern(bearbeitet.id ?? null, f);
            setBearbeitet(null);
            laden();
          }}
          onLoeschen={bearbeitet.id ? async () => {
            await api.onboarding.unterlagen.loeschen(bearbeitet);
            setBearbeitet(null);
            laden();
          } : undefined}
          loeschenText={`«${bearbeitet.name}» aus dem Katalog löschen? Bereits laufende Onboardings behalten ihre Checkliste.`}
          onSchliessen={() => setBearbeitet(null)}
        />
      )}
    </div>
  );
}
