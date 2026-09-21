import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api.js';
import PendenzListe from '../components/PendenzListe.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import PendenzVorschau from '../components/PendenzVorschau.jsx';
import Faelligkeitskalender from '../components/Faelligkeitskalender.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';

const REIHENFOLGE = ['ueberfaellig', 'heuteFaellig', 'morgenFaellig', 'nachfassen'];

const HOEHE_SPEICHER_SCHLUESSEL = 'cockpit-faelligkeiten-hoehe';
const HOEHE_MIN = 140; // Mindesthoehe der Faelligkeiten-Liste
const KALENDER_MIN = 200; // Mindesthoehe der Kalender-Karte

function gespeicherteHoeheLesen() {
  const wert = Number(localStorage.getItem(HOEHE_SPEICHER_SCHLUESSEL));
  return Number.isFinite(wert) && wert > 0 ? wert : null;
}

// Ausserhalb von Cockpit definiert, damit React sie nicht bei jedem Render neu montiert (sonst
// wuerde PendenzListe ihren Einklapp-Zustand fuer Teilaufgaben staendig verlieren). Links die
// Kategorien (wie Ordner in einem Mail-Programm), in der Mitte die Liste der gewaehlten
// Kategorie -- Klick auf eine Zeile zeigt rechts die Vorschau, erst ein Klick darin oeffnet
// wie gehabt das Bearbeiten-Fenster.
function FaelligkeitsUebersicht({ bloecke, aktiveKategorie, onKategorieWaehlen, onOeffnen, onStatusAendern, layoutRef, hoehe }) {
  const [vorschauPendenz, setVorschauPendenz] = useState(null);
  const gesamtAnzahl = bloecke.reduce((summe, b) => summe + b.items.length, 0);
  const aktuelle = bloecke.find((b) => b.key === aktiveKategorie) || bloecke[0];
  // Den aktuellen Datensatz aus der (frisch geladenen) Liste nachschlagen statt das alte
  // vorschauPendenz-Objekt weiterzuverwenden -- sonst zeigt die Vorschau nach einer Aenderung
  // (z.B. im Bearbeiten-Fenster gespeichert) weiter den veralteten Stand. Ist die Pendenz nicht
  // mehr in der aktuellen Kategorie -- z.B. nach Kategoriewechsel oder weil sie erledigt wurde --
  // blendet sie sich aus, ohne dass dafuer ein Effekt noetig ist.
  const angezeigtePendenz = vorschauPendenz
    ? aktuelle.items.find((p) => p.id === vorschauPendenz.id) ?? null
    : null;

  return (
    <div className="karte karte-kalender">
      <div className="karte-kopf">
        <span>Fälligkeiten</span>
        <span className="zaehler-pille">{gesamtAnzahl}</span>
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
          <PendenzListe
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
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const [aktiveKategorie, setAktiveKategorie] = useState(null);
  const [faelligkeitenHoehe, setFaelligkeitenHoehe] = useState(gespeicherteHoeheLesen);
  const [ziehtGerade, setZiehtGerade] = useState(false);
  const layoutRef = useRef(null);
  const kalenderRef = useRef(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  // Ziehgriff zwischen Faelligkeiten-Karte und Kalender (aehnlich dem Spalten-Ziehgriff im
  // Supabase SQL-Editor). Das eigentliche "nie ueberlaufen"-Versprechen kommt NICHT aus einer
  // JS-Berechnung, sondern aus dem Flexbox-Layout selbst (siehe .cockpit-resizable/
  // .cockpit-kalender-wrapper in index.css): die Kalender-Karte hat flex:1 und fuellt darum
  // IMMER exakt den nach der Faelligkeiten-Karte verbleibenden Platz, egal wie hoch diese ist
  // -- eine echte Browser-Berechnung statt einer angenaeherten. Hier wird waehrend des Ziehens
  // nur noch geprueft, ob die Kalender-Karte dabei unter ihre Mindesthoehe faellt (reine
  // Messung des tatsaechlichen Ergebnisses, keine Vorausberechnung).
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
    api.pendenzen.cockpit().then(setDaten).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  async function statusAendern(pendenz, neuerStatus) {
    await api.pendenzen.statusAendern(pendenz.id, neuerStatus);
    meldeAenderung();
    laden();
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;
  if (!daten) return <div className="ladeindikator">Lade Cockpit…</div>;

  const bloecke = [
    { key: 'ueberfaellig', titel: 'Überfällig', klasse: 'ueberfaellig', items: daten.ueberfaellig, leer: 'Keine überfälligen Pendenzen.' },
    { key: 'heuteFaellig', titel: 'Heute fällig', items: daten.heuteFaellig, leer: 'Heute nichts fällig.' },
    { key: 'morgenFaellig', titel: 'Morgen fällig', items: daten.morgenFaellig, leer: 'Morgen nichts fällig.' },
    { key: 'nachfassen', titel: 'Nachfassen', klasse: 'nachfassen', items: daten.nachfassen, leer: 'Nichts zum Nachfassen.' },
  ];

  // Beim ersten Laden automatisch die erste nicht-leere Kategorie zeigen (typischerweise
  // Ueberfaellig); eine bereits getroffene Auswahl der Nutzerin bleibt bei jedem Datenrefresh
  // unangetastet.
  const gewaehlteKategorie = aktiveKategorie
    ?? REIHENFOLGE.find((k) => (daten[k] || []).length > 0)
    ?? 'ueberfaellig';

  return (
    <div className="cockpit-seite">
      <h1 className="seiten-titel">Cockpit</h1>
      <p className="seiten-untertitel">Überfällige und anstehende Pendenzen auf einen Blick.</p>

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
          title="Höhe ziehen, um mehr oder weniger Fälligkeiten zu sehen"
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
    </div>
  );
}
