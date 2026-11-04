import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api.js';
import PendenzVorschau from './PendenzVorschau.jsx';
import { OFFENE_STATUS, statusSlug } from '../constants.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';
import { aufAenderungHoeren } from '../events.js';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WOCHENTAG_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// Pendenzen eines Tages pro Mandant gruppiert (alphabetisch, "Intern" zuletzt), innerhalb einer
// Gruppe nach Projekt bzw. Titel -- Schritte desselben Projekts stehen so beieinander.
function gruppiertNachMandant(liste) {
  const gruppen = new Map();
  for (const p of liste) {
    const schluessel = p.mandant_id ?? 'intern';
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, { schluessel, name: p.mandant_name || 'Intern (eigenes Büro)', items: [] });
    gruppen.get(schluessel).items.push(p);
  }
  return [...gruppen.values()]
    .sort((a, b) => (a.schluessel === 'intern') - (b.schluessel === 'intern') || a.name.localeCompare(b.name, 'de-CH'))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => (a.eltern_titel || a.titel).localeCompare(b.eltern_titel || b.titel, 'de-CH')) }));
}
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
export default function Faelligkeitskalender({ onOeffnen, onStatusAendern, mitVorschau = true }) {
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
  // sonst zeigt die Vorschau nach einer Aenderung weiter den veralteten Stand. Ist die Pendenz
  // nicht mehr am gewaehlten Tag, blendet sie sich aus.
  const angezeigtePendenz = vorschauPendenz
    ? ausgewaehlteListe.find((p) => p.id === vorschauPendenz.id) ?? null
    : null;

  // Kompakter Mini-Kalender: Monatsnavigation im Kartenkopf (keine eigene Zeile), rechts daneben
  // nur die Liste des angeklickten Tages -- ein Klick auf eine Pendenz oeffnet sie direkt (keine
  // zusaetzliche Vorschau-Spalte, damit die Tagesliste die ganze Breite bekommt).
  return (
    <div className="karte karte-kalender">
      <div className="karte-kopf kalender-kopf">
        <span>Kalender <span className="zaehler-pille">{gesamtAnzahl}</span></span>
        <div className="kalender-nav">
          <button type="button" className="kalender-nav-knopf" onClick={() => monatWechseln(-1)} aria-label="Vorheriger Monat">‹</button>
          <span className="kalender-monat">{MONATSNAMEN[ansicht.monatIndex]} {ansicht.jahr}</span>
          <button type="button" className="kalender-nav-knopf" onClick={() => monatWechseln(1)} aria-label="Nächster Monat">›</button>
          <button type="button" className="btn-klein kalender-heute" onClick={zuHeute}>Heute</button>
        </div>
      </div>

      <div className="kalender-layout">
        <div className="kalender">
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

        {/* Schlichte Tagesliste: eine Zeile pro Pendenz (Mandant · nächster Schritt · Status),
            Klick öffnet sie. Scrollt für sich allein -- der Kalender daneben bleibt stehen. */}
        <div className="kalender-tagesliste">
          {ausgewaehlterTag ? (
            <>
              <div className="kalender-tagesliste-titel">
                {WOCHENTAG_LANG[new Date(`${ausgewaehlterTag}T00:00:00`).getDay()]}, {formatiereDatum(ausgewaehlterTag)}
                <span className="kalender-tagesliste-anzahl">
                  {ausgewaehlteListe.length} Pendenz{ausgewaehlteListe.length === 1 ? '' : 'en'}
                </span>
              </div>
              {ausgewaehlteListe.length === 0 && <div className="leer-hinweis">Keine Pendenzen an diesem Tag.</div>}
              {gruppiertNachMandant(ausgewaehlteListe).map((gruppe) => (
                <div key={gruppe.schluessel} className="tagesliste-gruppe">
                  <div className="tagesliste-gruppe-titel">
                    {gruppe.name}
                    <span className="tagesliste-gruppe-anzahl">{gruppe.items.length}</span>
                  </div>
                  <ul className="tagesliste">
                    {gruppe.items.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={`tagesliste-eintrag ${angezeigtePendenz?.id === p.id ? 'aktiv' : ''}`}
                          onClick={() => (mitVorschau ? setVorschauPendenz(p) : onOeffnen(p))}
                          title={p.titel}
                        >
                          <span className="tagesliste-titel">
                            {p.eltern_titel && <span className="tagesliste-eltern">{p.eltern_titel} › </span>}
                            {p.titel}
                          </span>
                          <span className={`tagesliste-status status-${statusSlug(p.status)}`}>{p.status}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          ) : (
            <div className="leer-hinweis">Tag anklicken, um die Pendenzen dieses Tages zu sehen.</div>
          )}
        </div>

        {/* Detailansicht wie oben in der Übersicht (gleiche Komponente, gleiche Breite) --
            Klick darauf öffnet das Bearbeiten-Fenster. Auf dem Handy (mitVorschau=false) öffnet
            ein Tipp auf die Pendenz direkt das Bearbeiten-Fenster. */}
        {mitVorschau && <PendenzVorschau pendenz={angezeigtePendenz} onOeffnen={onOeffnen} onStatusAendern={onStatusAendern} />}
      </div>
    </div>
  );
}
