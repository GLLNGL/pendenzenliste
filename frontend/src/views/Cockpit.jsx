import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api.js';
import PendenzListeNachKunde from '../components/PendenzListeNachKunde.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import PendenzVorschau from '../components/PendenzVorschau.jsx';
import Faelligkeitskalender from '../components/Faelligkeitskalender.jsx';
import NachfassMails from '../components/NachfassMails.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { useAuth } from '../AuthContext.jsx';
import { BLOECKE } from '../constants.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { berechneCockpit } from '../lib/cockpit.js';
import { WIP_LIMIT } from '../lib/wip.js';

const REIHENFOLGE = ['faellig', 'inArbeit', 'nachfassen', 'wochenziele', 'heuteBearbeiten', 'unveraendert'];

const HOEHE_SPEICHER_SCHLUESSEL = 'cockpit-faelligkeiten-hoehe';
const BLOCK_SPEICHER_SCHLUESSEL = 'cockpit-block-filter';
const HOEHE_MIN = 140; // Mindesthoehe der Faelligkeiten-Liste
const KALENDER_MIN = 200; // Mindesthoehe der Kalender-Karte

function gespeicherteHoeheLesen() {
  const wert = Number(localStorage.getItem(HOEHE_SPEICHER_SCHLUESSEL));
  return Number.isFinite(wert) && wert > 0 ? wert : null;
}

function gespeichertenBlockLesen() {
  try {
    const wert = localStorage.getItem(BLOCK_SPEICHER_SCHLUESSEL) || '';
    return BLOECKE.includes(wert) ? wert : '';
  } catch {
    return '';
  }
}

function stunden(minuten) {
  return (minuten / 60).toLocaleString('de-CH', { maximumFractionDigits: 1 });
}

// Kennzahlen oben: In Arbeit (WIP), Auslastung naechste Woche, Block-Filter fuer das
// Abarbeiten am Stueck (z.B. alle Zahlungslaeufe nacheinander).
function Kennzahlen({ inArbeitAnzahl, auslastung, block, onBlockWaehlen }) {
  const prozent = Math.round(auslastung.anteil * 100);
  return (
    <div className="cockpit-kennzahlen">
      <div className={`kennzahl ${inArbeitAnzahl > WIP_LIMIT ? 'kennzahl-warnung' : ''}`}>
        <div className="kennzahl-titel">In Arbeit (du)</div>
        <div className="kennzahl-wert">{inArbeitAnzahl} <span className="kennzahl-einheit">/ {WIP_LIMIT}</span></div>
        <div className="kennzahl-hinweis">
          {inArbeitAnzahl > WIP_LIMIT ? 'Zu viel gleichzeitig – zuerst abschliessen oder zurückstellen.' : 'Tagesstart: Top 3 auf «In Arbeit» setzen.'}
        </div>
      </div>

      <div className={`kennzahl kennzahl-breit ${auslastung.warnung ? 'kennzahl-warnung' : ''}`}>
        <div className="kennzahl-titel">
          Auslastung nächste Woche ({formatiereDatum(auslastung.wocheVon)}–{formatiereDatum(auslastung.wocheBis)})
        </div>
        <div className="kennzahl-wert">
          {stunden(auslastung.minuten)} h <span className="kennzahl-einheit">von {stunden(auslastung.fokusMinuten)} h Fokuszeit · {prozent} %</span>
        </div>
        <div className="auslastung-balken" aria-hidden="true">
          <span className="auslastung-fuellung" style={{ width: `${Math.min(100, prozent)}%` }} />
          <span className="auslastung-schwelle" />
        </div>
        <div className="kennzahl-hinweis">
          {auslastung.warnung ? 'Mehr als 70 % verplant – Pendenzen verschieben, delegieren oder bündeln. ' : ''}
          {auslastung.ohneAufwand > 0 ? `${auslastung.ohneAufwand} Pendenz${auslastung.ohneAufwand === 1 ? '' : 'en'} ohne Aufwand nicht mitgezählt.` : ''}
        </div>
      </div>

      <div className="kennzahl kennzahl-breit">
        <div className="kennzahl-titel">Block (am Stück abarbeiten)</div>
        <div className="block-filter">
          <button type="button" className={`block-chip ${block === '' ? 'aktiv' : ''}`} onClick={() => onBlockWaehlen('')}>Alle</button>
          {BLOECKE.map((b) => (
            <button type="button" key={b} className={`block-chip ${block === b ? 'aktiv' : ''}`} onClick={() => onBlockWaehlen(b)}>{b}</button>
          ))}
        </div>
        <div className="kennzahl-hinweis">Tagesabschluss: Status nachführen, «Nachfassen» abarbeiten.</div>
      </div>
    </div>
  );
}

// Ausserhalb von Cockpit definiert, damit React sie nicht bei jedem Render neu montiert (sonst
// wuerde PendenzListe ihren Einklapp-Zustand fuer Teilaufgaben staendig verlieren). Links die
// Bereiche (wie Ordner in einem Mail-Programm), in der Mitte die Liste des gewaehlten
// Bereichs -- Klick auf eine Zeile zeigt rechts die Vorschau, erst ein Klick darin oeffnet
// wie gehabt das Bearbeiten-Fenster.
function FaelligkeitsUebersicht({ bloecke, aktiveKategorie, onKategorieWaehlen, onOeffnen, onStatusAendern, layoutRef, hoehe }) {
  const [vorschauPendenz, setVorschauPendenz] = useState(null);
  const aktuelle = bloecke.find((b) => b.key === aktiveKategorie) || bloecke[0];
  // Den aktuellen Datensatz aus der (frisch geladenen) Liste nachschlagen statt das alte
  // vorschauPendenz-Objekt weiterzuverwenden -- sonst zeigt die Vorschau nach einer Aenderung
  // (z.B. im Bearbeiten-Fenster gespeichert) weiter den veralteten Stand. Ist die Pendenz nicht
  // mehr im aktuellen Bereich -- z.B. nach Bereichswechsel oder weil sie erledigt wurde --
  // blendet sie sich aus, ohne dass dafuer ein Effekt noetig ist.
  const angezeigtePendenz = vorschauPendenz
    ? aktuelle.items.find((p) => p.id === vorschauPendenz.id) ?? null
    : null;

  return (
    <div className="karte karte-kalender">
      <div className="karte-kopf">
        <span>Übersicht</span>
        <span className="zaehler-pille">{bloecke[0].items.length} fällig</span>
      </div>

      <div
        className="uebersicht-layout"
        ref={layoutRef}
        style={hoehe ? { '--faelligkeiten-hoehe': `${hoehe}px` } : undefined}
      >
        <div className="uebersicht-kategorien">
          {bloecke.map((b) => (
            <button
              type="button"
              key={b.key}
              className={`uebersicht-kategorie ${b.klasse || ''} ${b.key === aktuelle.key ? 'aktiv' : ''}`}
              onClick={() => onKategorieWaehlen(b.key)}
            >
              <span>{b.titel}</span>
              <span className="zaehler-pille">{b.items.length}</span>
            </button>
          ))}
        </div>

        <div className="uebersicht-liste">
          {aktuelle.hinweis && aktuelle.items.length > 0 && <div className="uebersicht-hinweis">{aktuelle.hinweis}</div>}
          {aktuelle.aktion && aktuelle.items.length > 0 && (
            <div className="uebersicht-aktion">
              <button type="button" className="btn btn-primary" onClick={aktuelle.aktion.onClick}>{aktuelle.aktion.label}</button>
            </div>
          )}
          <PendenzListeNachKunde
            speicherSchluessel="cockpit-eingeklappt"
            pendenzen={aktuelle.items}
            onOeffnen={onOeffnen}
            onStatusAendern={onStatusAendern}
            leerText={aktuelle.leer}
            ohneAbhaken
            onVorschau={setVorschauPendenz}
            vorschauId={angezeigtePendenz?.id}
          />
        </div>

        <PendenzVorschau pendenz={angezeigtePendenz} onOeffnen={onOeffnen} onStatusAendern={onStatusAendern} />
      </div>
    </div>
  );
}

export default function Cockpit() {
  const { benutzer } = useAuth();
  const [offene, setOffene] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const [aktiveKategorie, setAktiveKategorie] = useState(null);
  const [block, setBlock] = useState(gespeichertenBlockLesen);
  const [faelligkeitenHoehe, setFaelligkeitenHoehe] = useState(gespeicherteHoeheLesen);
  const [ziehtGerade, setZiehtGerade] = useState(false);
  const [nachfassOffen, setNachfassOffen] = useState(false);
  const layoutRef = useRef(null);
  const kalenderRef = useRef(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  // Ziehgriff zwischen Uebersicht und Kalender (aehnlich dem Spalten-Ziehgriff im
  // Supabase SQL-Editor). Das eigentliche "nie ueberlaufen"-Versprechen kommt NICHT aus einer
  // JS-Berechnung, sondern aus dem Flexbox-Layout selbst (siehe .cockpit-resizable/
  // .cockpit-kalender-wrapper in index.css): die Kalender-Karte hat flex:1 und fuellt darum
  // IMMER exakt den nach der Uebersicht verbleibenden Platz, egal wie hoch diese ist -- eine
  // echte Browser-Berechnung statt einer angenaeherten. Hier wird waehrend des Ziehens nur noch
  // geprueft, ob die Kalender-Karte dabei unter ihre Mindesthoehe faellt (reine Messung des
  // tatsaechlichen Ergebnisses, keine Vorausberechnung).
  const ziehenStarten = useCallback((e) => {
    e.preventDefault();
    if (!layoutRef.current || !kalenderRef.current) return;
    const startY = e.clientY;
    const startHoehe = layoutRef.current.getBoundingClientRect().height;
    let letzteHoehe = startHoehe;
    let angefragt = false;
    setZiehtGerade(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    // Waehrend des Ziehens direkt am DOM-Element setzen statt bei jeder Mausbewegung den
    // kompletten React-Baum (inkl. der ggf. langen Pendenzliste) neu zu rendern -- das war
    // spuerbar ruckelig. React-State wird erst beim Loslassen einmalig aktualisiert.
    function anwenden(kandidat) {
      angefragt = false;
      layoutRef.current.style.setProperty('--faelligkeiten-hoehe', `${kandidat}px`);
      const kalenderHoehe = kalenderRef.current.getBoundingClientRect().height;
      if (kalenderHoehe < KALENDER_MIN) {
        // Kalender-Karte waere zu klein geworden -- die Differenz ist bei einem echten
        // Flexbox-flex:1-Element exakt (keine Naeherung), darum reicht eine einzelne
        // Korrektur ohne Iteration.
        const korrigiert = Math.max(HOEHE_MIN, kandidat - (KALENDER_MIN - kalenderHoehe));
        layoutRef.current.style.setProperty('--faelligkeiten-hoehe', `${korrigiert}px`);
        letzteHoehe = korrigiert;
      } else {
        letzteHoehe = kandidat;
      }
    }
    function bewegen(ev) {
      const kandidat = Math.max(HOEHE_MIN, startHoehe + (ev.clientY - startY));
      if (!angefragt) {
        angefragt = true;
        requestAnimationFrame(() => anwenden(kandidat));
      }
    }
    function loslassen() {
      window.removeEventListener('mousemove', bewegen);
      window.removeEventListener('mouseup', loslassen);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setZiehtGerade(false);
      setFaelligkeitenHoehe(letzteHoehe);
      localStorage.setItem(HOEHE_SPEICHER_SCHLUESSEL, String(letzteHoehe));
    }
    window.addEventListener('mousemove', bewegen);
    window.addEventListener('mouseup', loslassen);
  }, []);

  const laden = useCallback(() => {
    api.pendenzen.offene().then(setOffene).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  function blockWaehlen(neu) {
    setBlock(neu);
    try { localStorage.setItem(BLOCK_SPEICHER_SCHLUESSEL, neu); } catch { /* ohne Speicher weiter nutzbar */ }
  }

  async function statusAendern(pendenz, neuerStatus) {
    try {
      await api.pendenzen.statusAendern(pendenz.id, neuerStatus);
      meldeAenderung();
      laden();
    } catch (err) {
      window.alert(err.message);
    }
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;
  if (!offene) return <div className="ladeindikator">Lade Cockpit…</div>;

  const ich = mitarbeitende.find((m) => m.id === benutzer?.id);
  const daten = berechneCockpit(offene, {
    heute: heutigesDatumISO(),
    jetzt: new Date(),
    ichId: benutzer?.id ?? null,
    fokusstunden: ich?.fokusstunden_woche ?? 15,
    block,
  });

  const bloecke = [
    { key: 'faellig', titel: 'Fällig ≤ 5 Arbeitstage', klasse: 'ueberfaellig', items: daten.faellig, leer: 'In den nächsten 5 Arbeitstagen ist nichts fällig.' },
    { key: 'inArbeit', titel: 'In Arbeit', klasse: daten.inArbeitAnzahl > WIP_LIMIT ? 'ueberfaellig' : 'bearbeiten', items: daten.inArbeit, leer: 'Nichts in Arbeit – Tagesstart: Top 3 der fälligen Pendenzen auf «In Arbeit» setzen.' },
    {
      key: 'nachfassen', titel: 'Nachfassen', klasse: 'nachfassen', items: daten.nachfassen, leer: 'Nichts zum Nachfassen.',
      aktion: { label: `✉ Erinnerungs-Mails vorbereiten (${daten.nachfassen.length})`, onClick: () => setNachfassOffen(true) },
    },
    { key: 'wochenziele', titel: 'Wochenziele', klasse: 'bearbeiten', items: daten.wochenziele, leer: 'Keine Wochenziele markiert – im Wochenrückblick die 3–5 wichtigsten Ergebnisse festlegen.' },
    { key: 'heuteBearbeiten', titel: 'Heute bearbeiten', klasse: 'bearbeiten', items: daten.heuteBearbeiten, leer: 'Nichts zum Bearbeiten geplant.' },
    {
      key: 'unveraendert', titel: 'Unverändert > 14 Tage', items: daten.unveraendert, leer: 'Keine liegengebliebenen Pendenzen.',
      hinweis: 'Seit über 14 Tagen nicht angefasst – aufteilen, umformulieren (konkreter nächster Schritt) oder streichen.',
    },
  ];

  // Beim ersten Laden automatisch den ersten nicht-leeren Bereich zeigen (typischerweise
  // "Fällig"); eine bereits getroffene Auswahl bleibt bei jedem Datenrefresh unangetastet.
  const gewaehlteKategorie = aktiveKategorie
    ?? REIHENFOLGE.find((k) => bloecke.find((b) => b.key === k).items.length > 0)
    ?? 'faellig';

  return (
    <div className="cockpit-seite">
      <h1 className="seiten-titel">Cockpit</h1>
      <p className="seiten-untertitel">
        {block ? `Gefiltert auf Block «${block}». ` : ''}Tagesstart: Fällige ansehen, Top 3 auf «In Arbeit». Tagesabschluss: Status nachführen, nachfassen.
      </p>

      <Kennzahlen inArbeitAnzahl={daten.inArbeitAnzahl} auslastung={daten.auslastung} block={block} onBlockWaehlen={blockWaehlen} />

      <div className="cockpit-resizable">
        <FaelligkeitsUebersicht
          bloecke={bloecke}
          aktiveKategorie={gewaehlteKategorie}
          onKategorieWaehlen={setAktiveKategorie}
          onOeffnen={setAktivePendenz}
          onStatusAendern={statusAendern}
          layoutRef={layoutRef}
          hoehe={faelligkeitenHoehe}
        />

        <div
          className={`cockpit-resize-griff ${ziehtGerade ? 'aktiv' : ''}`}
          onMouseDown={ziehenStarten}
          title="Höhe ziehen, um mehr oder weniger Pendenzen zu sehen"
        />

        <div ref={kalenderRef} className="cockpit-kalender-wrapper">
          <Faelligkeitskalender onOeffnen={setAktivePendenz} onStatusAendern={statusAendern} />
        </div>
      </div>

      {aktivePendenz && (
        <PendenzModal
          key={aktivePendenz.id}
          pendenz={aktivePendenz}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setAktivePendenz(null)}
          onGespeichert={() => { setAktivePendenz(null); laden(); }}
          onGeloescht={() => { setAktivePendenz(null); laden(); }}
        />
      )}

      {nachfassOffen && <NachfassMails pendenzen={daten.nachfassen} onSchliessen={() => setNachfassOffen(false)} />}
    </div>
  );
}
