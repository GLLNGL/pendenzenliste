import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import PendenzListe from '../components/PendenzListe.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import PendenzVorschau from '../components/PendenzVorschau.jsx';
import Faelligkeitskalender from '../components/Faelligkeitskalender.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';

const REIHENFOLGE = ['ueberfaellig', 'heuteFaellig', 'morgenFaellig', 'nachfassen'];

// Ausserhalb von Cockpit definiert, damit React sie nicht bei jedem Render neu montiert (sonst
// wuerde PendenzListe ihren Einklapp-Zustand fuer Teilaufgaben staendig verlieren). Links die
// Kategorien (wie Ordner in einem Mail-Programm), in der Mitte die Liste der gewaehlten
// Kategorie -- Klick auf eine Zeile zeigt rechts die Vorschau, erst ein Klick darin oeffnet
// wie gehabt das Bearbeiten-Fenster.
function FaelligkeitsUebersicht({ bloecke, aktiveKategorie, onKategorieWaehlen, onOeffnen, onStatusAendern }) {
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

      <div className="uebersicht-layout">
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
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

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
    <div>
      <h1 className="seiten-titel">Cockpit</h1>
      <p className="seiten-untertitel">Überfällige und anstehende Pendenzen auf einen Blick.</p>

      <FaelligkeitsUebersicht
        bloecke={bloecke}
        aktiveKategorie={gewaehlteKategorie}
        onKategorieWaehlen={setAktiveKategorie}
        onOeffnen={setAktivePendenz}
        onStatusAendern={statusAendern}
      />

      <Faelligkeitskalender onOeffnen={setAktivePendenz} onStatusAendern={statusAendern} className="kalender-fixiert" />

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
