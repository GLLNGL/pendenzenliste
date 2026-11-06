import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import PendenzArbeitsliste from '../components/PendenzArbeitsliste.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import MandantModal from '../components/MandantModal.jsx';
import PauschalenModal from '../components/PauschalenModal.jsx';
import { aktivePauschalen, pauschalenSumme, formatiereCHF } from '../lib/preise.js';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { OFFENE_STATUS, ZAHLUNGSLAUF_RHYTHMEN } from '../constants.js';
import { heutigesDatumISO } from '../format.js';

const AUSWAHL_SCHLUESSEL = 'mandanten-auswahl';
const MONATE = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];

function gespeicherteAuswahlLesen() {
  try { return localStorage.getItem(AUSWAHL_SCHLUESSEL) || 'alle'; } catch { return 'alle'; }
}

// Mandats-Eckdaten als kurze Zeile ueber der Liste (nur erfasste Angaben).
function eckdatenText(m) {
  const teile = [];
  if (m.kunden_nr) teile.push(m.kunden_nr);
  if (m.kuerzel) teile.push(`Kürzel ${m.kuerzel}`);
  if (m.mwst_periode) teile.push(m.mwst_periode === 'keine' ? 'keine MWST' : `MWST ${m.mwst_periode}`);
  if (m.lohnzahltag) teile.push(`Lohnzahltag ${m.lohnzahltag}.`);
  const zahlung = ZAHLUNGSLAUF_RHYTHMEN.find((r) => r.wert === m.zahlungslauf_rhythmus);
  if (zahlung) teile.push(`Zahlungslauf: ${zahlung.label}`);
  if (m.abschluss_wunsch_tag && m.abschluss_wunsch_monat) teile.push(`Abschluss bis ${m.abschluss_wunsch_tag}. ${MONATE[m.abschluss_wunsch_monat - 1]}`);
  return teile.length ? teile.join(' · ') : 'Noch keine Mandats-Eckdaten erfasst.';
}

// Gleiches Muster wie im Cockpit: links die Mandanten (statt Bereichen) mit Anzahl offener und
// ueberfaelliger Pendenzen, in der Mitte die Pendenzen des gewaehlten Mandanten, rechts die
// Detailansicht. "Alle Mandanten" zeigt alles, nach Mandant gruppiert und einklappbar.
export default function Mandanten() {
  const [uebersicht, setUebersicht] = useState([]);
  const [offenePendenzen, setOffenePendenzen] = useState([]);
  const [auswahl, setAuswahl] = useState(gespeicherteAuswahlLesen);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const [bearbeiteterMandant, setBearbeiteterMandant] = useState(null);
  const [neuerMandantOffen, setNeuerMandantOffen] = useState(false);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [pauschalen, setPauschalen] = useState([]);
  const [pauschalenMandant, setPauschalenMandant] = useState(null);
  const mandanten = useMandanten();
  const navigate = useNavigate();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    // Volle Mandanten-Zeilen (inkl. Adresse/Status, v7) statt mandanten_uebersicht() -- die
    // Zaehler werden ohnehin unten aus der Pendenzenliste berechnet.
    Promise.all([
      api.mandanten.liste(),
      api.pendenzen.liste({ status: OFFENE_STATUS.join(','), sort: 'faelligkeit_asc' }),
    ]).then(([u, p]) => {
      setUebersicht(u);
      setOffenePendenzen(p);
    }).catch((e) => setFehler(e.message));
    // Pauschalen separat: fehlt die Schema-Erweiterung noch, bleibt die Ansicht trotzdem nutzbar.
    api.pauschalen.liste().then(setPauschalen).catch(() => setPauschalen([]));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  async function statusAendern(pendenz, neuerStatus) {
    try {
      await api.pendenzen.statusAendern(pendenz.id, neuerStatus);
      meldeAenderung();
    } catch (err) {
      window.alert(err.message);
    }
  }

  function waehlen(wert) {
    setAuswahl(wert);
    try { localStorage.setItem(AUSWAHL_SCHLUESSEL, wert); } catch { /* ohne Speicher weiter nutzbar */ }
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  const sichtbareMandanten = uebersicht.filter((m) => zeigeInaktive || m.aktiv);
  const interne = offenePendenzen.filter((p) => p.mandant_id == null);
  const gewaehlt = sichtbareMandanten.find((m) => String(m.id) === auswahl) || null;
  const aktuelleAuswahl = gewaehlt ? auswahl : (auswahl === 'intern' ? 'intern' : 'alle');
  const liste = aktuelleAuswahl === 'alle'
    ? offenePendenzen
    : aktuelleAuswahl === 'intern'
      ? interne
      : offenePendenzen.filter((p) => p.mandant_id === gewaehlt.id);
  // Zaehler links aus derselben Liste wie in der Mitte berechnet (Projekt-Koepfe zaehlen nicht,
  // nur konkrete Pendenzen/Schritte) -- so stimmen Spalte, Gruppen- und Kartenkopf ueberein.
  const heute = heutigesDatumISO();
  const zaehler = new Map();
  let ueberfaelligGesamt = 0;
  let offenGesamt = 0;
  for (const p of offenePendenzen) {
    if (p.teilaufgaben_gesamt > 0) continue;
    const z = zaehler.get(p.mandant_id) || { offen: 0, ueberfaellig: 0 };
    z.offen += 1;
    offenGesamt += 1;
    if (p.faelligkeit < heute) { z.ueberfaellig += 1; ueberfaelligGesamt += 1; }
    zaehler.set(p.mandant_id, z);
  }
  const zaehlerVon = (id) => zaehler.get(id) || { offen: 0, ueberfaellig: 0 };

  const mandantenSpalte = (
    <div className="uebersicht-kategorien mandanten-spalte">
      <button type="button" className={`uebersicht-kategorie ${aktuelleAuswahl === 'alle' ? 'aktiv' : ''}`} onClick={() => waehlen('alle')}>
        <span>Alle Mandanten</span>
        <span className="mandanten-zaehler">
          {ueberfaelligGesamt > 0 && <span className="zaehler-pille ueberfaellig" title="überfällig">{ueberfaelligGesamt}</span>}
          <span className="zaehler-pille">{offenGesamt}</span>
        </span>
      </button>
      {sichtbareMandanten.map((m) => (
        <button
          type="button"
          key={m.id}
          className={`uebersicht-kategorie ${aktuelleAuswahl === String(m.id) ? 'aktiv' : ''} ${m.aktiv ? '' : 'inaktiv'}`}
          onClick={() => waehlen(String(m.id))}
          title={m.aktiv ? m.name : `${m.name} (inaktiv)`}
        >
          <span className="mandanten-name">{m.name}{m.potenziell && <> <span className="tag-potenziell" title="Potenzieller Mandant (Interessent)">pot.</span></>}</span>
          <span className="mandanten-zaehler">
            {zaehlerVon(m.id).ueberfaellig > 0 && <span className="zaehler-pille ueberfaellig" title="überfällig">{zaehlerVon(m.id).ueberfaellig}</span>}
            <span className="zaehler-pille">{zaehlerVon(m.id).offen}</span>
          </span>
        </button>
      ))}
      {interne.length > 0 && (
        <button type="button" className={`uebersicht-kategorie ${aktuelleAuswahl === 'intern' ? 'aktiv' : ''}`} onClick={() => waehlen('intern')}>
          <span>Intern (eigenes Büro)</span>
          <span className="mandanten-zaehler"><span className="zaehler-pille">{zaehlerVon(null).offen}</span></span>
        </button>
      )}
    </div>
  );

  const pauschaleMonat = gewaehlt
    ? pauschalenSumme(aktivePauschalen(pauschalen.filter((p) => p.mandant_id === gewaehlt.id), heute))
    : 0;
  const eckdaten = gewaehlt && (
    <div className="mandant-eckdaten">
      <span>
        {eckdatenText(gewaehlt)}
        {gewaehlt.potenziell && <strong> · potenziell</strong>}
        {!gewaehlt.aktiv && <strong> · inaktiv</strong>}
        {' · '}{pauschaleMonat > 0 ? `Pauschale CHF ${formatiereCHF(pauschaleMonat)}/Mt.` : 'keine Pauschale'}
      </span>
      <span className="mandant-eckdaten-aktionen">
        <button type="button" className="btn-klein" onClick={() => navigate(`/offerten/neu?mandant=${gewaehlt.id}`)}>Offerte erstellen</button>
        <button type="button" className="btn-klein" onClick={() => navigate(`/rapporte/neu?mandant=${gewaehlt.id}`)}>Rapport</button>
        <button type="button" className="btn-klein" onClick={() => setPauschalenMandant(gewaehlt)}>Pauschalen</button>
        <button type="button" className="btn-klein" onClick={() => setBearbeiteterMandant(gewaehlt)}>Mandant bearbeiten</button>
      </span>
    </div>
  );

  return (
    <div className="arbeitsseite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Mandanten</h1>
        <span className="cockpit-kopf-hinweis">Offene Pendenzen pro Mandant – links wählen, Klick auf eine Pendenz zeigt rechts die Details.</span>
        <span className="kopfzeile-aktionen">
          <label className="kopfzeile-checkbox">
            <input type="checkbox" checked={zeigeInaktive} onChange={(e) => setZeigeInaktive(e.target.checked)} />
            Inaktive anzeigen
          </label>
          <button type="button" className="btn-klein" onClick={() => setNeuerMandantOffen(true)}>+ Neuer Mandant</button>
        </span>
      </div>

      <PendenzArbeitsliste
        titel={<>Pendenzen <span className="uebersicht-kopf-bereich">· {gewaehlt ? gewaehlt.name : aktuelleAuswahl === 'intern' ? 'Intern (eigenes Büro)' : 'Alle Mandanten'}</span></>}
        pendenzen={liste}
        leerText="Keine offenen Pendenzen."
        speicherSchluessel="mandanten-eingeklappt"
        onOeffnen={setAktivePendenz}
        onStatusAendern={statusAendern}
        links={mandantenSpalte}
        oben={eckdaten}
      />

      {aktivePendenz && (
        <PendenzModal
          key={aktivePendenz.id}
          pendenz={aktivePendenz}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setAktivePendenz(null)}
          onGespeichert={() => setAktivePendenz(null)}
          onGeloescht={() => setAktivePendenz(null)}
        />
      )}

      {bearbeiteterMandant && (
        <MandantModal
          mandant={bearbeiteterMandant}
          alleMandanten={uebersicht}
          onSchliessen={() => setBearbeiteterMandant(null)}
          onGespeichert={() => { setBearbeiteterMandant(null); laden(); }}
        />
      )}

      {pauschalenMandant && (
        <PauschalenModal
          mandant={pauschalenMandant}
          onSchliessen={() => setPauschalenMandant(null)}
          onGeaendert={() => api.pauschalen.liste().then(setPauschalen).catch(() => {})}
        />
      )}

      {neuerMandantOffen && (
        <MandantModal
          mandant={null}
          alleMandanten={uebersicht}
          onSchliessen={() => setNeuerMandantOffen(false)}
          onGespeichert={() => { setNeuerMandantOffen(false); laden(); }}
        />
      )}
    </div>
  );
}
