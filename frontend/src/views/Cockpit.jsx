import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../api.js';
import PendenzGruppenListe from '../components/PendenzGruppenListe.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import PendenzVorschau from '../components/PendenzVorschau.jsx';
import Faelligkeitskalender from '../components/Faelligkeitskalender.jsx';
import NachfassMails from '../components/NachfassMails.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { useAuth } from '../AuthContext.jsx';
import { BLOECKE, aufwandSumme, formatiereStunden } from '../constants.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { berechneCockpit } from '../lib/cockpit.js';
import { WIP_LIMIT } from '../lib/wip.js';

const REIHENFOLGE = ['faellig', 'inArbeit', 'nachfassen', 'wochenziele', 'heuteBearbeiten', 'unveraendert'];

// Regler zwischen Uebersicht und Kalender: er stellt die Groesse des Kalenders ein (als Faktor
// seiner Originalgroesse), die Uebersicht fuellt per Flexbox immer den Rest. Kleiner gezogen wird
// der Kalender als Ganzes verkleinert (CSS-Zoom, "Zoom-out") statt abgeschnitten.
const KALENDER_ZOOM_SCHLUESSEL = 'cockpit-kalender-zoom';
const BLOCK_SPEICHER_SCHLUESSEL = 'cockpit-block-filter';
const KALENDER_ZOOM_MIN = 0.6; // kleinste Kalendergroesse (60 % der Originalgroesse)

function gespeichertenZoomLesen() {
  try {
    const wert = Number(localStorage.getItem(KALENDER_ZOOM_SCHLUESSEL));
    return Number.isFinite(wert) && wert >= KALENDER_ZOOM_MIN && wert <= 1 ? wert : 1;
  } catch {
    return 1;
  }
}

function begrenzt(wert, min, max) {
  return Math.min(max, Math.max(min, wert));
}

// Originalgroessen in CSS-Pixeln: Kartenkopf und Monatsraster. offsetHeight liefert ungezoomte
// Werte -- unabhaengig vom App-Zoom (AuthGate.jsx) und vom Zoom-out des Rasters selbst.
function kalenderMasse(wrapper) {
  const kopf = wrapper?.querySelector('.kalender-kopf');
  const monat = wrapper?.querySelector('.kalender');
  return kopf && monat ? { kopf: kopf.offsetHeight, monat: monat.offsetHeight, monatElement: monat } : null;
}

// Nur das Monatsraster wird verkleinert ("Zoom-out"); Kopf, Tagesliste und Detailansicht behalten
// ihre normale Groesse. Die Hoehe des Kalender-Bereichs folgt dem verkleinerten Raster.
function kalenderAnwenden(wrapper, masse, zoom) {
  masse.monatElement.style.zoom = String(zoom);
  wrapper.style.height = `${masse.kopf + masse.monat * zoom + 2}px`; // + Kartenrahmen
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

// Kennzahlen als eine schmale Leiste (damit die Uebersicht darunter den meisten Platz bekommt):
// In Arbeit (WIP), Auslastung naechste Woche, Block-Filter fuer das Abarbeiten am Stueck.
// Erklaerungen und Warntexte stehen im Tooltip; eine Warnung zeigt sich zusaetzlich rot.
function Kennzahlen({ inArbeitAnzahl, auslastung, block, onBlockWaehlen }) {
  const prozent = Math.round(auslastung.anteil * 100);
  const wipWarnung = inArbeitAnzahl > WIP_LIMIT;
  const auslastungTipp = [
    `Auslastung ${formatiereDatum(auslastung.wocheVon)}–${formatiereDatum(auslastung.wocheBis)}: `
      + `${stunden(auslastung.minuten)} h von ${stunden(auslastung.fokusMinuten)} h Fokuszeit.`,
    auslastung.warnung ? 'Mehr als 70 % verplant – Pendenzen verschieben, delegieren oder bündeln.' : '',
    auslastung.ohneAufwand > 0 ? `${auslastung.ohneAufwand} Pendenz${auslastung.ohneAufwand === 1 ? '' : 'en'} ohne Aufwand nicht mitgezählt.` : '',
  ].filter(Boolean).join('\n');

  return (
    <div className="cockpit-kennzahlen">
      <div
        className={`kennzahl ${wipWarnung ? 'kennzahl-warnung' : ''}`}
        title={wipWarnung ? 'Zu viel gleichzeitig – zuerst abschliessen oder zurückstellen.' : 'Tagesstart: Top 3 auf «In Arbeit» setzen.'}
      >
        <span className="kennzahl-titel">In Arbeit</span>
        <span className="kennzahl-wert">{inArbeitAnzahl}<span className="kennzahl-einheit"> / {WIP_LIMIT}</span></span>
      </div>

      <div className={`kennzahl ${auslastung.warnung ? 'kennzahl-warnung' : ''}`} title={auslastungTipp}>
        <span className="kennzahl-titel">Nächste Woche</span>
        <span className="kennzahl-wert">{stunden(auslastung.minuten)} h<span className="kennzahl-einheit"> / {stunden(auslastung.fokusMinuten)} h · {prozent} %</span></span>
        <span className="auslastung-balken" aria-hidden="true">
          <span className="auslastung-fuellung" style={{ width: `${Math.min(100, prozent)}%` }} />
          <span className="auslastung-schwelle" />
        </span>
      </div>

      <div className="kennzahl kennzahl-block" title="Block wählen, um z.B. alle Zahlungsläufe am Stück abzuarbeiten">
        <span className="kennzahl-titel">Block</span>
        <div className="block-filter">
          <button type="button" className={`block-chip ${block === '' ? 'aktiv' : ''}`} onClick={() => onBlockWaehlen('')}>Alle</button>
          {BLOECKE.map((b) => (
            <button type="button" key={b} className={`block-chip ${block === b ? 'aktiv' : ''}`} onClick={() => onBlockWaehlen(b)}>{b}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Ausserhalb von Cockpit definiert, damit React sie nicht bei jedem Render neu montiert (sonst
// wuerde PendenzListe ihren Einklapp-Zustand fuer Teilaufgaben staendig verlieren). Links die
// Bereiche (wie Ordner in einem Mail-Programm), in der Mitte die Liste des gewaehlten
// Bereichs -- Klick auf eine Zeile zeigt rechts die Vorschau, erst ein Klick darin oeffnet
// wie gehabt das Bearbeiten-Fenster.
function FaelligkeitsUebersicht({ bloecke, aktiveKategorie, onKategorieWaehlen, onOeffnen, onStatusAendern }) {
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
  const summe = aufwandSumme(aktuelle.items);

  return (
    <div className="karte karte-kalender uebersicht-karte">
      {/* Kopf zeigt den gewaehlten Bereich mit Anzahl und geschaetzter Gesamtzeit, z.B.
          "Heute bearbeiten · 6 Pendenzen · 4.5 h geschätzt". */}
      <div className="karte-kopf uebersicht-kopf">
        <span>Übersicht <span className="uebersicht-kopf-bereich">· {aktuelle.titel}</span></span>
        <span className="uebersicht-kopf-summe">
          {aktuelle.items.length} Pendenz{aktuelle.items.length === 1 ? '' : 'en'}
          {' · '}
          <strong>{formatiereStunden(summe.minuten)}</strong> geschätzt
          {summe.ohne > 0 && <span className="uebersicht-kopf-ohne"> ({summe.ohne} ohne Schätzung)</span>}
        </span>
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
          {aktuelle.hinweis && aktuelle.items.length > 0 && <div className="uebersicht-hinweis">{aktuelle.hinweis}</div>}
          {aktuelle.aktion && aktuelle.items.length > 0 && (
            <div className="uebersicht-aktion">
              <button type="button" className="btn btn-primary" onClick={aktuelle.aktion.onClick}>{aktuelle.aktion.label}</button>
            </div>
          )}
          {/* Gleiches schlichtes Layout wie im Kalender: pro Mandant gruppiert, eine Zeile pro
              Pendenz (nächster Schritt, Frist, Status); Details und Status rechts in der Vorschau. */}
          <PendenzGruppenListe
            pendenzen={aktuelle.items}
            aktiveId={angezeigtePendenz?.id}
            onWaehlen={setVorschauPendenz}
            mitFrist
            speicherSchluessel="cockpit-uebersicht-eingeklappt"
            leerText={aktuelle.leer}
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
  const [kalenderZoom, setKalenderZoom] = useState(gespeichertenZoomLesen);
  const [ziehtGerade, setZiehtGerade] = useState(false);
  const [nachfassOffen, setNachfassOffen] = useState(false);
  const kalenderRef = useRef(null);
  // Aktueller Kalender-Zoom auch waehrend des Ziehens (dort ohne React-Rerender angewendet).
  const zoomRef = useRef(kalenderZoom);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  // Kalendergroesse anwenden -- nach dem Laden, bei jeder Zoom-Aenderung und wenn sich das
  // Monatsraster selbst aendert (Monate mit 5 oder 6 Wochen).
  useLayoutEffect(() => {
    const wrapper = kalenderRef.current;
    const masse = kalenderMasse(wrapper);
    if (!masse) return undefined;
    zoomRef.current = kalenderZoom;
    kalenderAnwenden(wrapper, masse, kalenderZoom);
    const beobachter = new ResizeObserver(() => {
      const neu = kalenderMasse(wrapper);
      if (neu) kalenderAnwenden(wrapper, neu, zoomRef.current);
    });
    beobachter.observe(masse.monatElement);
    return () => beobachter.disconnect();
  }, [kalenderZoom, offene]);

  // Regler zwischen Uebersicht und Kalender. Nach unten ziehen = Kalender kleiner (bis 60 % seiner
  // Originalgroesse), nach oben = groesser (hoechstens Originalgroesse); die Uebersicht fuellt per
  // Flexbox immer den Rest. Fluessig, weil waehrend des Ziehens nichts gemessen und kein
  // React-Rerender ausgeloest wird: der neue Zoom wird direkt aus dem Mausweg berechnet und
  // hoechstens einmal pro Bildschirm-Frame angewendet. Pointer-Capture haelt den Griff fest, auch
  // wenn die Maus beim schnellen Ziehen kurz neben ihm liegt.
  const ziehenStarten = useCallback((e) => {
    const wrapper = kalenderRef.current;
    const masse = kalenderMasse(wrapper);
    if (!masse) return;
    e.preventDefault();
    const griff = e.currentTarget;
    try { griff.setPointerCapture(e.pointerId); } catch { /* ohne Capture funktioniert das Ziehen trotzdem */ }
    // Mausweg kommt in Bildschirmpixeln, die Hoehen sind CSS-Pixel unter dem App-Zoom.
    const appZoom = parseFloat(document.documentElement.style.zoom) || 1;
    const startY = e.clientY;
    const startZoom = zoomRef.current;
    let zielZoom = startZoom;
    let rahmen = 0;
    setZiehtGerade(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    function bewegen(ev) {
      const wegCss = (ev.clientY - startY) / appZoom;
      // Der Griff folgt der Maus 1:1 -- jeder Pixel nach unten verkleinert das Raster um 1 Pixel.
      zielZoom = begrenzt(startZoom - wegCss / masse.monat, KALENDER_ZOOM_MIN, 1);
      if (!rahmen) {
        rahmen = requestAnimationFrame(() => {
          rahmen = 0;
          zoomRef.current = zielZoom;
          kalenderAnwenden(wrapper, masse, zielZoom);
        });
      }
    }
    function loslassen() {
      griff.removeEventListener('pointermove', bewegen);
      griff.removeEventListener('pointerup', loslassen);
      griff.removeEventListener('pointercancel', loslassen);
      if (rahmen) cancelAnimationFrame(rahmen);
      zoomRef.current = zielZoom;
      kalenderAnwenden(wrapper, masse, zielZoom);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setZiehtGerade(false);
      setKalenderZoom(zielZoom);
      try { localStorage.setItem(KALENDER_ZOOM_SCHLUESSEL, String(zielZoom)); } catch { /* ohne Speicher weiter nutzbar */ }
    }
    griff.addEventListener('pointermove', bewegen);
    griff.addEventListener('pointerup', loslassen);
    griff.addEventListener('pointercancel', loslassen);
  }, []);

  // Doppelklick auf den Griff: Kalender wieder in Originalgroesse.
  function kalenderZuruecksetzen() {
    setKalenderZoom(1);
    try { localStorage.removeItem(KALENDER_ZOOM_SCHLUESSEL); } catch { /* ohne Speicher weiter nutzbar */ }
  }

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
      {/* Titel und Arbeitsrhythmus in einer Zeile -- der obere Bereich bleibt schmal. */}
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Cockpit</h1>
        <span className="cockpit-kopf-hinweis">
          {block ? <strong>Block «{block}» · </strong> : null}
          Tagesstart: Fällige ansehen, Top 3 auf «In Arbeit» · Tagesabschluss: Status nachführen, nachfassen
        </span>
      </div>

      <Kennzahlen inArbeitAnzahl={daten.inArbeitAnzahl} auslastung={daten.auslastung} block={block} onBlockWaehlen={blockWaehlen} />

      <div className="cockpit-resizable">
        <FaelligkeitsUebersicht
          bloecke={bloecke}
          aktiveKategorie={gewaehlteKategorie}
          onKategorieWaehlen={setAktiveKategorie}
          onOeffnen={setAktivePendenz}
          onStatusAendern={statusAendern}
        />

        <div
          className={`cockpit-resize-griff ${ziehtGerade ? 'aktiv' : ''}`}
          onPointerDown={ziehenStarten}
          onDoubleClick={kalenderZuruecksetzen}
          title="Ziehen: Kalender verkleinern/vergrössern · Doppelklick: Originalgrösse"
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
