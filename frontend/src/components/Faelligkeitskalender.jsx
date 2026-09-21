import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api.js';
import PendenzListe from './PendenzListe.jsx';
import PendenzVorschau from './PendenzVorschau.jsx';
import { OFFENE_STATUS } from '../constants.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';
import { aufAenderungHoeren } from '../events.js';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function isoAus(datum) {
  const jahr = datum.getFullYear();
  const monat = String(datum.getMonth() + 1).padStart(2, '0');
  const tag = String(datum.getDate()).padStart(2, '0');
  return `${jahr}-${monat}-${tag}`;
}

// ISO-8601-Kalenderwoche: Woche 1 ist die Woche mit dem ersten Donnerstag des Jahres.
function isoWoche(datum) {
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()));
  const montagVersatz = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - montagVersatz + 3); // auf den Donnerstag derselben Woche springen
  const jahresBeginn = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - jahresBeginn) / 86400000) + 1) / 7);
}

// Liefert immer volle Wochen (Montag - Sonntag), auch mit Tagen aus dem Vor-/Folgemonat --
// sonst haette der Monat mal 4, mal 5, mal 6 Zeilen und das Raster wuerde springen.
function baueRaster(jahr, monatIndex) {
  const ersterTag = new Date(jahr, monatIndex, 1);
  const letzterTag = new Date(jahr, monatIndex + 1, 0);
  const versatzStart = (ersterTag.getDay() + 6) % 7; // Montag = 0
  const versatzEnde = (7 - ((letzterTag.getDay() + 6) % 7) - 1) % 7;

  const tage = [];
  const anzahlTage = versatzStart + letzterTag.getDate() + versatzEnde;
  for (let i = 0; i < anzahlTage; i++) {
    tage.push(new Date(jahr, monatIndex, 1 - versatzStart + i));
  }
  return tage;
}

// Ersetzt die fruehere "Naechste 7 Tage"-Liste: ein Monatskalender, dessen Tage fett
// erscheinen, sobald eine offene Pendenz an diesem Tag faellig ist. Anklicken zeigt die
// Pendenzen des Tages darunter -- ueberfaellig/heute/morgen bleiben eigene Listen im Cockpit.
export default function Faelligkeitskalender({ onOeffnen, onStatusAendern }) {
  const heuteISO = heutigesDatumISO();
  const jetzt = useMemo(() => new Date(), []);
  const [ansicht, setAnsicht] = useState({ jahr: jetzt.getFullYear(), monatIndex: jetzt.getMonth() });
  const [pendenzenNachTag, setPendenzenNachTag] = useState(new Map());
  const [ausgewaehlterTag, setAusgewaehlterTag] = useState(null);
  const [vorschauPendenz, setVorschauPendenz] = useState(null);
  const [fehler, setFehler] = useState(null);

  const tage = useMemo(() => baueRaster(ansicht.jahr, ansicht.monatIndex), [ansicht]);
  const von = isoAus(tage[0]);
  const bis = isoAus(tage[tage.length - 1]);

  // baueRaster liefert immer volle Wochen -- in 7er-Bloecke teilen, damit pro Zeile die
  // Kalenderwoche des jeweiligen Montags ausgewiesen werden kann.
  const wochen = useMemo(() => {
    const gruppen = [];
    for (let i = 0; i < tage.length; i += 7) gruppen.push(tage.slice(i, i + 7));
    return gruppen;
  }, [tage]);

  const laden = useCallback(() => {
    api.pendenzen.liste({ status: OFFENE_STATUS.join(','), von, bis, sort: 'faelligkeit_asc' })
      .then((liste) => {
        const nachTag = new Map();
        for (const p of liste) {
          const eintrag = nachTag.get(p.faelligkeit) || [];
          eintrag.push(p);
          nachTag.set(p.faelligkeit, eintrag);
        }
        setPendenzenNachTag(nachTag);
      })
      .catch((e) => setFehler(e.message));
  }, [von, bis]);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  // Beim Monatswechsel macht eine Auswahl aus dem vorherigen Monat keinen Sinn mehr.
  useEffect(() => { setAusgewaehlterTag(null); }, [ansicht.jahr, ansicht.monatIndex]);

  function monatWechseln(delta) {
    setAnsicht((a) => {
      const d = new Date(a.jahr, a.monatIndex + delta, 1);
      return { jahr: d.getFullYear(), monatIndex: d.getMonth() };
    });
  }

  function zuHeute() {
    setAnsicht({ jahr: jetzt.getFullYear(), monatIndex: jetzt.getMonth() });
  }

  const gesamtAnzahl = [...pendenzenNachTag.values()].reduce((summe, liste) => summe + liste.length, 0);
  const ausgewaehlteListe = ausgewaehlterTag ? (pendenzenNachTag.get(ausgewaehlterTag) || []) : [];
  // Frischen Datensatz nachschlagen statt das alte vorschauPendenz-Objekt weiterzuverwenden --
  // sonst zeigt die Vorschau nach einer Aenderung (z.B. im Bearbeiten-Fenster gespeichert)
  // weiter den veralteten Stand. Ist die Pendenz nicht mehr am aktuellen Tag, blendet sie sich
  // aus, ohne dass dafuer ein Effekt noetig ist.
  const angezeigtePendenz = vorschauPendenz
    ? ausgewaehlteListe.find((p) => p.id === vorschauPendenz.id) ?? null
    : null;

  return (
    <div className="karte karte-kalender">
      <div className="karte-kopf">
        <span>Weitere Pendenzen</span>
        <span className="zaehler-pille">{gesamtAnzahl}</span>
      </div>

      <div className="kalender-layout">
        <div className="kalender">
          <div className="kalender-nav">
            <button type="button" className="btn-klein" onClick={() => monatWechseln(-1)} aria-label="Vorheriger Monat">‹</button>
            <span className="kalender-monat">{MONATSNAMEN[ansicht.monatIndex]} {ansicht.jahr}</span>
            <button type="button" className="btn-klein" onClick={() => monatWechseln(1)} aria-label="Nächster Monat">›</button>
            <button type="button" className="btn-klein kalender-heute" onClick={zuHeute}>Heute</button>
          </div>

          {fehler && <div className="hinweis-fehler">{fehler}</div>}

          {/* Leere Zelle statt "KW"-Beschriftung -- wie im iPhone-Kalender braucht die
              Wochennummer keine eigene Spaltenueberschrift. */}
          <div className="kalender-wochentage">
            <div aria-hidden="true"></div>
            {WOCHENTAGE.map((w) => <div key={w}>{w}</div>)}
          </div>

          <div className="kalender-raster">
            {wochen.map((woche) => (
              <Fragment key={isoAus(woche[0])}>
                <div className="kalender-kw">{isoWoche(woche[0])}</div>
                {woche.map((tag) => {
                  const iso = isoAus(tag);
                  const imMonat = tag.getMonth() === ansicht.monatIndex;
                  const anzahl = (pendenzenNachTag.get(iso) || []).length;
                  const klassen = [
                    'kalender-tag',
                    !imMonat && 'ausserhalb',
                    anzahl > 0 && 'hat-pendenzen',
                    iso === heuteISO && 'heute',
                    iso === ausgewaehlterTag && 'ausgewaehlt',
                  ].filter(Boolean).join(' ');
                  return (
                    <button
                      type="button"
                      key={iso}
                      className={klassen}
                      onClick={() => setAusgewaehlterTag(iso === ausgewaehlterTag ? null : iso)}
                      title={anzahl > 0 ? `${anzahl} Pendenz${anzahl === 1 ? '' : 'en'} fällig` : undefined}
                    >
                      <span className="kalender-tag-zahl">{tag.getDate()}</span>
                      {anzahl > 0 && <span className="kalender-tag-punkt" />}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="kalender-tagesliste">
          {ausgewaehlterTag ? (
            <>
              <div className="kalender-tagesliste-titel">{formatiereDatum(ausgewaehlterTag)}</div>
              <PendenzListe
                pendenzen={ausgewaehlteListe}
                onOeffnen={onOeffnen}
                onStatusAendern={onStatusAendern}
                leerText="Keine Pendenzen an diesem Tag."
                ohneAbhaken
                onVorschau={setVorschauPendenz}
                vorschauId={angezeigtePendenz?.id}
              />
            </>
          ) : (
            <div className="leer-hinweis">Tag anklicken, um die Pendenzen dieses Tages zu sehen.</div>
          )}
        </div>

        <PendenzVorschau pendenz={angezeigtePendenz} onOeffnen={onOeffnen} onStatusAendern={onStatusAendern} />
      </div>
    </div>
  );
}
