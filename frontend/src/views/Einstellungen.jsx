import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { meldeMitarbeitendeAenderung } from '../events.js';

// Fokusstunden pro Woche der angemeldeten Person -- Grundlage fuer die Auslastungsanzeige im
// Cockpit (Warnung, sobald mehr als 70 % der naechsten Woche verplant sind).
function Fokusstunden() {
  const { benutzer } = useAuth();
  const [stunden, setStunden] = useState('');
  const [meldung, setMeldung] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    if (!benutzer?.id) return;
    api.mitarbeitende.liste().then((liste) => {
      const ich = liste.find((m) => m.id === benutzer.id);
      if (ich) setStunden(String(ich.fokusstunden_woche ?? 15));
    }).catch(() => {});
  }, [benutzer]);

  async function speichern(e) {
    e.preventDefault();
    setMeldung(null);
    setFehler(null);
    try {
      await api.mitarbeitende.aktualisieren(benutzer.id, { fokusstundenWoche: stunden });
      meldeMitarbeitendeAenderung();
      setMeldung('Gespeichert.');
    } catch (err) {
      setFehler(err.message);
    }
  }

  if (!benutzer?.id) return null;

  return (
    <>
      <h2 className="abschnitt-titel">Fokusstunden</h2>
      <p className="seiten-untertitel">
        Wie viele Stunden pro Woche hast du für konzentrierte Pendenzen-Arbeit (ohne Termine, Telefon, Unterbrüche)?
        Das Cockpit warnt, wenn die nächste Woche zu mehr als 70 % verplant ist.
      </p>
      <form className="karte" style={{ maxWidth: 520 }} onSubmit={speichern}>
        <div className="modal-koerper">
          <div className="feld">
            <label htmlFor="fokusstunden">Fokusstunden pro Woche ({benutzer.name})</label>
            <input id="fokusstunden" type="number" min="1" max="60" step="0.5" value={stunden} onChange={(e) => setStunden(e.target.value)} />
          </div>
          {meldung && <div className="hinweis-erfolg">{meldung}</div>}
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
        </div>
        <div className="modal-fuss">
          <div />
          <button type="submit" className="btn btn-primary">Speichern</button>
        </div>
      </form>
    </>
  );
}

export default function Einstellungen() {
  const [testetGerade, setTestetGerade] = useState(false);
  const [meldung, setMeldung] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [netzwerk, setNetzwerk] = useState(null);

  useEffect(() => {
    api.einstellungen.netzwerk().then(setNetzwerk).catch(() => {});
  }, []);

  async function testen() {
    setTestetGerade(true);
    setFehler(null);
    setMeldung(null);
    try {
      const ergebnis = await api.mail.test();
      setMeldung(`Test-E-Mail wurde an ${ergebnis.an} gesendet. Prüfe dein Postfach.`);
    } catch (err) {
      setFehler('Test fehlgeschlagen: ' + err.message);
    } finally {
      setTestetGerade(false);
    }
  }

  return (
    <div>
      <h1 className="seiten-titel">Einstellungen</h1>

      <Fokusstunden />

      <h2 className="abschnitt-titel">E-Mail-Versand</h2>
      <p className="seiten-untertitel">Läuft über eine zentral eingerichtete Supabase-Funktion, nicht mehr über eine Einstellung hier in der App.</p>

      <div className="karte" style={{ maxWidth: 520 }}>
        <div className="modal-koerper">
          {meldung && <div className="hinweis-erfolg">{meldung}</div>}
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
        </div>
        <div className="modal-fuss">
          <div />
          <button type="button" className="btn btn-primary" onClick={testen} disabled={testetGerade}>
            {testetGerade ? 'Sende Test…' : 'Test-E-Mail senden'}
          </button>
        </div>
      </div>

      <h2 className="abschnitt-titel">Zugriff vom Handy</h2>
      <p className="seiten-untertitel">Der PC muss dafür eingeschaltet und das Auftragsmanagement gestartet sein.</p>

      <div className="karte" style={{ maxWidth: 640 }}>
        <div className="modal-koerper">
          <div>
            <strong>Im gleichen WLAN</strong> (zuhause / Büro) – im Handy-Browser öffnen:
            <ul className="adress-liste">
              {(netzwerk?.lan?.length ? netzwerk.lan : ['(keine Netzwerkadresse gefunden)']).map((a) => (
                <li key={a}><code>{a}</code></li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 12 }}>
            <strong>Unterwegs</strong> (ausserhalb des WLAN) – benötigt Tailscale (kostenlos):
            <ol className="anleitung-liste">
              <li>Auf dem PC <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a> installieren, mit Microsoft-/Google-Konto anmelden.</li>
              <li>Auf dem/den iPhone(s) die Tailscale-App aus dem App Store installieren, mit demselben Konto anmelden.</li>
              <li>In der Tailscale-App den Namen bzw. die Adresse dieses PCs ablesen (Format <code>100.x.x.x</code>).</li>
              {netzwerk?.tailscale?.length ? (
                <li>Erkannte Tailscale-Adresse dieses PCs:{' '}
                  {netzwerk.tailscale.map((a) => <code key={a} style={{ marginRight: 8 }}>{a}</code>)}
                </li>
              ) : (
                <li>Sobald Tailscale auf dem PC läuft, erscheint hier die passende Adresse.</li>
              )}
              <li>Diese Adresse im Safari des iPhones öffnen.</li>
            </ol>
          </div>

          <div style={{ marginTop: 12 }}>
            <strong>Als App auf den Home-Bildschirm</strong> (iPhone): Seite in Safari öffnen →
            Teilen-Symbol → „Zum Home-Bildschirm". Danach startet das Auftragsmanagement mit eigenem Icon
            und ohne Browser-Leiste.
          </div>
        </div>
      </div>
    </div>
  );
}
