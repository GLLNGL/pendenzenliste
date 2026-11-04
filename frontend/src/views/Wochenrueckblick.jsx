import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api.js';
import NachfassMails from '../components/NachfassMails.jsx';
import { useAuth } from '../AuthContext.jsx';
import { useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { datumPlusTage, formatiereDatum, formatiereZeitstempel, heutigesDatumISO } from '../format.js';
import { berechneCockpit, naechsteWoche } from '../lib/cockpit.js';
import {
  RUECKBLICK_CHECKLISTE, WOCHENZIELE_MIN, WOCHENZIELE_MAX, montagDerWoche, fortschritt,
} from '../lib/wochenrueckblick.js';

// Wochenrückblick (Etappe 5) am Freitag: abhakbare Checkliste (beginnt jede Woche leer),
// Wochenziele für die nächste Woche markieren und zwei Fragen als Freitext, die mit Datum
// gespeichert bleiben. Zu jedem Punkt steht, was die App dazu weiss (z.B. "3 Notizen im
// Eingang"), damit man nicht erst suchen muss.
export default function Wochenrueckblick() {
  const { benutzer } = useAuth();
  const mitarbeitende = useMitarbeitende();
  const heute = heutigesDatumISO();
  const woche = montagDerWoche(heute);
  const zielwoche = naechsteWoche(heute).von;

  const [eintrag, setEintrag] = useState(null);
  const [offene, setOffene] = useState([]);
  const [eingangAnzahl, setEingangAnzahl] = useState(0);
  const [verlauf, setVerlauf] = useState([]);
  const [antworten, setAntworten] = useState({ liegenGeblieben: '', andersMachen: '' });
  const [gespeichertAm, setGespeichertAm] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [nachfassOffen, setNachfassOffen] = useState(false);
  const [erzeugeGerade, setErzeugeGerade] = useState(false);
  const [erzeugtMeldung, setErzeugtMeldung] = useState(null);

  const ladeDaten = useCallback(() => {
    api.pendenzen.offene().then(setOffene).catch((e) => setFehler(e.message));
    api.pendenzen.eingangAnzahl().then(setEingangAnzahl).catch(() => {});
  }, []);

  useEffect(() => {
    api.wochenrueckblick.holen(woche).then((e) => {
      setEintrag(e);
      setAntworten({ liegenGeblieben: e.liegen_geblieben ?? '', andersMachen: e.anders_machen ?? '' });
      setGespeichertAm(e.aktualisiert_am ?? null);
    }).catch((e) => setFehler(e.message));
    api.wochenrueckblick.verlauf(woche).then(setVerlauf).catch(() => {});
  }, [woche]);

  useEffect(() => {
    ladeDaten();
    return aufAenderungHoeren(ladeDaten);
  }, [ladeDaten]);

  async function punktUmschalten(key) {
    const checkliste = { ...eintrag.checkliste, [key]: !eintrag.checkliste?.[key] };
    setEintrag((e) => ({ ...e, checkliste }));
    try {
      const gespeichert = await api.wochenrueckblick.speichern(woche, { checkliste });
      setGespeichertAm(gespeichert.aktualisiert_am);
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function antwortenSpeichern(e) {
    e.preventDefault();
    try {
      const gespeichert = await api.wochenrueckblick.speichern(woche, antworten);
      setGespeichertAm(gespeichert.aktualisiert_am);
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function wochenzielUmschalten(pendenz) {
    try {
      await api.pendenzen.wochenzielSetzen(pendenz.id, pendenz.wochenziel_woche === zielwoche ? null : zielwoche);
      meldeAenderung();
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function wiederkehrendeErzeugen() {
    setErzeugeGerade(true);
    try {
      const neu = await api.regeln.erzeugen(naechsteWoche(heute).bis);
      meldeAenderung();
      setErzeugtMeldung(neu.length ? `${neu.length} Pendenz${neu.length === 1 ? '' : 'en'} erzeugt.` : 'Alles bereits vorhanden.');
    } catch (err) {
      setErzeugtMeldung(`Fehler: ${err.message}`);
    } finally {
      setErzeugeGerade(false);
    }
  }

  if (fehler) return <div className="fehleranzeige">Fehler: {fehler}</div>;
  if (!eintrag) return <div className="ladeindikator">Lade Wochenrückblick…</div>;

  const ich = mitarbeitende.find((m) => m.id === benutzer?.id);
  const cockpit = berechneCockpit(offene, {
    heute, jetzt: new Date(), ichId: benutzer?.id ?? null, fokusstunden: ich?.fokusstunden_woche ?? 15,
  });
  const eigeneSchritte = offene.filter((p) => !(p.teilaufgaben_gesamt > 0)
    && (p.bearbeiter_id == null || p.bearbeiter_id === benutzer?.id));
  const in4Wochen = datumPlusTage(heute, 28);
  const fristen4Wochen = eigeneSchritte.filter((p) => p.faelligkeit <= in4Wochen && p.status !== 'Später');
  const ohneAufwand = eigeneSchritte.filter((p) => p.aufwand_minuten == null);
  const zielKandidaten = eigeneSchritte
    .filter((p) => p.wochenziel_woche === zielwoche || (p.faelligkeit <= in4Wochen && p.status !== 'Später'))
    .sort((a, b) => (a.faelligkeit < b.faelligkeit ? -1 : 1));
  const zieleAnzahl = eigeneSchritte.filter((p) => p.wochenziel_woche === zielwoche).length;
  const auslastungProzent = Math.round(cockpit.auslastung.anteil * 100);
  const { erledigt, gesamt } = fortschritt(eintrag.checkliste);

  // Was die App zu den einzelnen Punkten weiss -- Hinweis bzw. Abkuerzung neben dem Haken.
  const hilfe = {
    notizen: <><Link to="/eingang">Eingang</Link>: {eingangAnzahl} Notiz{eingangAnzahl === 1 ? '' : 'en'}</>,
    naechster_schritt: <>{cockpit.unveraendert.length} seit über 14 Tagen unverändert · {ohneAufwand.length} ohne Aufwand</>,
    nachgefasst: cockpit.nachfassen.length
      ? <button type="button" className="btn-klein" onClick={() => setNachfassOffen(true)}>{cockpit.nachfassen.length} fällig – Erinnerungen vorbereiten</button>
      : <>nichts fällig</>,
    fristen: <>{fristen4Wochen.length} Pendenz{fristen4Wochen.length === 1 ? '' : 'en'} bis {formatiereDatum(in4Wochen)} – <Link to="/pendenzen">Alle Pendenzen</Link></>,
    wiederkehrende: (
      <>
        <button type="button" className="btn-klein" onClick={wiederkehrendeErzeugen} disabled={erzeugeGerade}>
          {erzeugeGerade ? 'Erzeuge…' : 'Für nächste Woche erzeugen'}
        </button>
        {erzeugtMeldung && <span> {erzeugtMeldung}</span>}
      </>
    ),
    wochenziele: (
      <span className={zieleAnzahl >= WOCHENZIELE_MIN && zieleAnzahl <= WOCHENZIELE_MAX ? 'text-ok' : 'text-warnung'}>
        {zieleAnzahl} markiert (Ziel {WOCHENZIELE_MIN}–{WOCHENZIELE_MAX}, unten)
      </span>
    ),
    auslastung: (
      <span className={cockpit.auslastung.warnung ? 'text-warnung' : 'text-ok'}>
        {auslastungProzent} % verplant ({formatiereDatum(cockpit.auslastung.wocheVon)}–{formatiereDatum(cockpit.auslastung.wocheBis)})
      </span>
    ),
  };

  return (
    <div className="wochenrueckblick">
      <h1 className="seiten-titel">
        Wochenrückblick
        <span className={`zaehler-pille seiten-titel-pille ${erledigt === gesamt ? 'zaehler-ok' : ''}`}>{erledigt}/{gesamt}</span>
      </h1>
      <p className="seiten-untertitel">
        Woche vom {formatiereDatum(woche)} – am Freitag durchgehen. Die Checkliste beginnt jede Woche leer.
        {gespeichertAm ? ` Zuletzt gespeichert ${formatiereZeitstempel(gespeichertAm)}.` : ''}
      </p>

      <div className="rueckblick-raster">
        <div className="karte">
          {RUECKBLICK_CHECKLISTE.map((gruppe) => (
            <div key={gruppe.gruppe} className="rueckblick-gruppe">
              <div className="feld-gruppe-titel">{gruppe.gruppe}</div>
              {gruppe.punkte.map((punkt) => (
                <div key={punkt.key} className={`rueckblick-punkt ${eintrag.checkliste?.[punkt.key] ? 'erledigt' : ''}`}>
                  <label>
                    <input type="checkbox" checked={!!eintrag.checkliste?.[punkt.key]} onChange={() => punktUmschalten(punkt.key)} />
                    <span>{punkt.text}</span>
                  </label>
                  {hilfe[punkt.key] && <div className="rueckblick-hilfe">{hilfe[punkt.key]}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="karte">
          <div className="karte-kopf">
            <span>Wochenziele {formatiereDatum(zielwoche)}–{formatiereDatum(naechsteWoche(heute).bis)}</span>
            <span className="zaehler-pille">{zieleAnzahl}</span>
          </div>
          <p className="feld-hinweis" style={{ padding: '8px 12px 0' }}>
            Die {WOCHENZIELE_MIN}–{WOCHENZIELE_MAX} wichtigsten Ergebnisse der nächsten Woche mit ☆ markieren – sie erscheinen
            dann im Cockpit unter «Wochenziele». Vorgeschlagen: deine Pendenzen mit Frist in den nächsten 4 Wochen.
          </p>
          <div className="wochenziel-liste">
            {zielKandidaten.length === 0 && <div className="leer-hinweis">Keine Pendenzen mit Frist in den nächsten 4 Wochen.</div>}
            {zielKandidaten.map((p) => {
              const markiert = p.wochenziel_woche === zielwoche;
              return (
                <div key={p.id} className={`wochenziel-zeile ${markiert ? 'markiert' : ''}`}>
                  <button
                    type="button"
                    className="wochenziel-stern"
                    aria-label={markiert ? 'Wochenziel aufheben' : 'Als Wochenziel markieren'}
                    title={markiert ? 'Wochenziel aufheben' : 'Als Wochenziel markieren'}
                    onClick={() => wochenzielUmschalten(p)}
                  >
                    {markiert ? '★' : '☆'}
                  </button>
                  <span className="wochenziel-titel">{p.mandant_name ? `${p.mandant_name}: ` : ''}{p.titel}</span>
                  <span className="wochenziel-frist">{formatiereDatum(p.faelligkeit)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <form className="karte rueckblick-fragen" onSubmit={antwortenSpeichern}>
        <div className="modal-koerper">
          <div className="feld">
            <label htmlFor="liegen-geblieben">Was ist liegen geblieben und warum?</label>
            <textarea id="liegen-geblieben" rows={3} value={antworten.liegenGeblieben}
              onChange={(e) => setAntworten((a) => ({ ...a, liegenGeblieben: e.target.value }))} />
          </div>
          <div className="feld">
            <label htmlFor="anders-machen">Was mache ich nächste Woche anders?</label>
            <textarea id="anders-machen" rows={3} value={antworten.andersMachen}
              onChange={(e) => setAntworten((a) => ({ ...a, andersMachen: e.target.value }))} />
          </div>
        </div>
        <div className="modal-fuss">
          <div />
          <button type="submit" className="btn btn-primary">Antworten speichern</button>
        </div>
      </form>

      {verlauf.length > 0 && (
        <div className="karte rueckblick-verlauf">
          <div className="karte-kopf"><span>Frühere Wochen</span></div>
          {verlauf.map((v) => (
            <div key={v.woche} className="rueckblick-verlauf-eintrag">
              <div className="rueckblick-verlauf-datum">Woche vom {formatiereDatum(v.woche)}</div>
              {v.liegen_geblieben && <p><strong>Liegen geblieben:</strong> {v.liegen_geblieben}</p>}
              {v.anders_machen && <p><strong>Anders machen:</strong> {v.anders_machen}</p>}
            </div>
          ))}
        </div>
      )}

      {nachfassOffen && <NachfassMails pendenzen={cockpit.nachfassen} onSchliessen={() => setNachfassOffen(false)} />}
    </div>
  );
}
