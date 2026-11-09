import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { meldeMitarbeitendeAenderung } from '../events.js';
import { unterstuetzt, grundOrdnerHolen, grundOrdnerWaehlen, grundOrdnerVergessen } from '../lib/ablageOrdner.js';

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

// Grundordner der Mandantenablage (fuer alle gleich) plus die Freigabe des lokalen
// OneDrive-Ordners auf diesem Geraet (zum direkten Ablegen von Dateien).
function AblageEinstellung() {
  const [f, setF] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [lokal, setLokal] = useState(null);

  useEffect(() => {
    api.buero.lesen('ablage').then((w) => setF({ grundPfad: w.grundPfad ?? '', grundLink: w.grundLink ?? '', unterordnerMail: w.unterordnerMail ?? '' }))
      .catch((e) => setFehler(e.message));
    grundOrdnerHolen().then((h) => setLokal(h?.name ?? null));
  }, []);

  async function speichern(e) {
    e.preventDefault();
    setMeldung(null);
    setFehler(null);
    try {
      await api.buero.speichern('ablage', {
        grundPfad: f.grundPfad.trim().replace(/^"|"$/g, ''), grundLink: f.grundLink.trim(), unterordnerMail: f.unterordnerMail.trim(),
      });
      window.dispatchEvent(new Event('ablage-geaendert'));
      setMeldung('Gespeichert.');
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function lokalWaehlen() {
    setFehler(null);
    try {
      const h = await grundOrdnerWaehlen();
      setLokal(h.name);
    } catch (err) {
      if (err?.name !== 'AbortError') setFehler(err.message);
    }
  }

  if (!f) return fehler ? <div className="hinweis-fehler">{fehler}</div> : null;
  const setze = (name) => (e) => setF((alt) => ({ ...alt, [name]: e.target.value }));

  return (
    <>
      <h2 className="abschnitt-titel">Ablage (OneDrive)</h2>
      <p className="seiten-untertitel">
        Grundordner der Mandantenablage. Beim Mandanten wird nur noch der Ordnername eingetragen – Pfad und Link setzen sich daraus zusammen.
      </p>
      <form className="karte" style={{ maxWidth: 760 }} onSubmit={speichern}>
        <div className="modal-koerper">
          <div className="feld">
            <label htmlFor="ablage-grundpfad">Grundordner im Windows Explorer</label>
            <input id="ablage-grundpfad" value={f.grundPfad} onChange={setze('grundPfad')} placeholder="C:\Users\…\EST Controlling GmbH\EST – Mandantenablage - 00_Treuhand" />
            <p className="feld-hinweis">Im Explorer den Ordner wählen, Adresszeile anklicken und den Pfad kopieren.</p>
          </div>
          <div className="feld">
            <label htmlFor="ablage-grundlink">Adresse des Grundordners in SharePoint (optional)</label>
            <input id="ablage-grundlink" value={f.grundLink} onChange={setze('grundLink')} placeholder="https://estcontrollinggmbh.sharepoint.com/sites/ESTMandantenablage/…" />
            <p className="feld-hinweis">Den Ordner im Browser öffnen und die Adresse aus der Adresszeile kopieren (kein Freigabe-Link).</p>
          </div>
          <div className="feld">
            <label htmlFor="ablage-unterordner">Unterordner für Mail-Anhänge (optional)</label>
            <input id="ablage-unterordner" value={f.unterordnerMail} onChange={setze('unterordnerMail')} placeholder="z.B. 01_Korrespondenz – leer = direkt im Mandantenordner" />
          </div>
          <div className="feld">
            <label>Direkt ablegen auf diesem Gerät</label>
            {unterstuetzt() ? (
              <div className="ablage-lokal">
                <span>{lokal ? <>Verbunden mit dem Ordner <strong>{lokal}</strong></> : 'Noch nicht verbunden.'}</span>
                <button type="button" className="btn-klein" onClick={lokalWaehlen}>{lokal ? 'Anderen Ordner wählen' : 'OneDrive-Grundordner verbinden'}</button>
                {lokal && <button type="button" className="btn-klein" onClick={async () => { await grundOrdnerVergessen(); setLokal(null); }}>Trennen</button>}
              </div>
            ) : (
              <p className="feld-hinweis">Dieser Browser kann nicht direkt in Ordner schreiben – Dateien werden heruntergeladen (direkt ablegen geht mit Edge oder Chrome am PC).</p>
            )}
            <p className="feld-hinweis">Denselben Grundordner wählen wie oben. Danach legt «In Ablage speichern» Dateien direkt im Ordner des Mandanten ab; OneDrive synchronisiert sie.</p>
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

      <AblageEinstellung />

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
