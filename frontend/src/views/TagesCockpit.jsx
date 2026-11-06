import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api.js';
import PendenzModal from '../components/PendenzModal.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { useAuth } from '../AuthContext.jsx';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';
import { formatiereAufwand, formatiereStunden } from '../constants.js';
import { tagesplan, zuPlanen, morgenTitel } from '../lib/tagesplan.js';
import { montagDerWoche } from '../lib/wochenrueckblick.js';

const WOCHENTAG_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function tagText(iso) {
  const [j, m, t] = iso.split('-').map(Number);
  return `${WOCHENTAG_KURZ[new Date(Date.UTC(j, m - 1, t)).getUTCDay()]} ${formatiereDatum(iso).slice(0, 6)}`;
}

function minutenSumme(liste) {
  return liste.reduce((s, p) => s + (p.aufwand_minuten || 0), 0);
}

// Pendenzen pro Mandant (alphabetisch, "Intern" zuletzt) -- offene vor erledigten.
function nachMandant(offen, erledigt) {
  const gruppen = new Map();
  for (const [p, istErledigt] of [...offen.map((x) => [x, false]), ...erledigt.map((x) => [x, true])]) {
    const schluessel = p.mandant_id ?? 'intern';
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, { schluessel, name: p.mandant_name || 'Intern (eigenes Büro)', zeilen: [] });
    gruppen.get(schluessel).zeilen.push({ p, erledigt: istErledigt });
  }
  return [...gruppen.values()].sort((a, b) => (a.schluessel === 'intern') - (b.schluessel === 'intern') || a.name.localeCompare(b.name, 'de-CH'));
}

// Eine Zeile: abhaken, Titel (Projekt darueber), Hinweise, Aufwand; rechts kurze Planen-Knoepfe.
function Zeile({ p, heute, erledigt, aktionen, onOeffnen, onAbhaken, inProjekt = false }) {
  const ueberfaellig = !erledigt && p.faelligkeit && p.faelligkeit < heute;
  const nachfassen = !erledigt && p.status === 'Warten auf';
  return (
    <li className={`tp-zeile ${erledigt ? 'erledigt' : ''} ${inProjekt ? 'tp-teilaufgabe' : ''}`}>
      <button
        type="button"
        className={`tp-haken ${erledigt ? 'aktiv' : ''}`}
        onClick={() => onAbhaken(p, !erledigt)}
        aria-label={erledigt ? 'Wieder öffnen' : 'Erledigt'}
        title={erledigt ? 'Wieder öffnen' : 'Erledigt'}
      >
        {erledigt ? '✓' : ''}
      </button>
      <button type="button" className="tp-text" onClick={() => onOeffnen(p)}>
        {p.eltern_titel && !inProjekt && <span className="tp-projekt">{p.eltern_titel}</span>}
        <span className="tp-titel">{inProjekt && <span className="tp-teil-marke" aria-label="Teilaufgabe">↳ </span>}{p.titel}</span>
        {(nachfassen || ueberfaellig || (p.faelligkeit && p.harte_frist)) && (
          <span className="tp-info">
            {nachfassen && `nachfassen bei ${p.warten_auf_person}`}
            {ueberfaellig && <span className="tp-ueberfaellig">{nachfassen ? ' · ' : ''}Frist {formatiereDatum(p.faelligkeit)}</span>}
            {!ueberfaellig && p.faelligkeit && p.harte_frist && `${nachfassen ? ' · ' : ''}harte Frist ${formatiereDatum(p.faelligkeit)}`}
          </span>
        )}
      </button>
      <span className="tp-aufwand">{p.aufwand_minuten ? formatiereAufwand(p.aufwand_minuten) : ''}</span>
      {!erledigt && aktionen?.length > 0 && (
        <span className="tp-aktionen">
          {aktionen.map((a) => (
            <button key={a.label} type="button" className="tp-aktion" onClick={() => a.ausfuehren(p)} title={a.titel}>{a.label}</button>
          ))}
        </span>
      )}
    </li>
  );
}

// Zeilen eines Mandanten: einzelne Pendenzen und Projekte (mit ihren Teilaufgaben) in der
// Reihenfolge ihres ersten Auftretens.
function nachProjekt(zeilen) {
  const bloecke = [];
  const projekte = new Map();
  for (const z of zeilen) {
    const id = z.p.uebergeordnete_pendenz_id;
    if (!id) { bloecke.push({ art: 'einzeln', z }); continue; }
    if (!projekte.has(id)) {
      const block = { art: 'projekt', id, titel: z.p.eltern_titel || 'Projekt', zeilen: [] };
      projekte.set(id, block);
      bloecke.push(block);
    }
    projekte.get(id).zeilen.push(z);
  }
  return bloecke;
}

function Karte({ titel, untertitel, offen, erledigt = [], erledigtAnzahl = null, leerText, heute, aktionen, onOeffnen, onAbhaken }) {
  // Projekte sind im Cockpit aufgeklappt (Teilaufgaben abhaken); Klick aufs Projekt klappt zu.
  const [zu, setZu] = useState(() => new Set());
  const umschalten = (id) => setZu((alt) => { const n = new Set(alt); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const total = offen.length + erledigt.length;
  const fertig = erledigtAnzahl ?? erledigt.length;
  const gesamt = offen.length + fertig;
  const anteil = gesamt ? fertig / gesamt : 0;
  return (
    <section className="tp-karte">
      <header className="tp-karte-kopf">
        <div>
          <h2 className="tp-karte-titel">{titel}</h2>
          <div className="tp-karte-untertitel">{untertitel}</div>
        </div>
        <div className="tp-karte-stand">
          {total > 0 && erledigtAnzahl == null && <span>{erledigt.length} von {total} erledigt</span>}
          {erledigtAnzahl > 0 && <span>{erledigtAnzahl} heute erledigt</span>}
          {minutenSumme(offen) > 0 && <span className="tp-karte-zeit">noch {formatiereStunden(minutenSumme(offen))}</span>}
        </div>
      </header>
      {gesamt > 0 && <div className="tp-fortschritt"><div style={{ width: `${Math.round(anteil * 100)}%` }} /></div>}
      {total > 0 && (
      <div className="tp-kacheln">
      {nachMandant(offen, erledigt).map((g) => {
        const gOffen = g.zeilen.filter((z) => !z.erledigt).length;
        return (
          <div key={g.schluessel} className="tp-mandant tp-kachel">
            <div className="tp-mandant-kopf">
              <span className="tp-mandant-name">{g.name}</span>
              <span className="tp-mandant-stand">{gOffen === 0 ? 'erledigt' : `${gOffen} offen`}</span>
            </div>
            <ul className="tp-liste">
              {nachProjekt(g.zeilen).map((b) => {
                if (b.art === 'einzeln') {
                  const { p, erledigt: e } = b.z;
                  return <Zeile key={p.id} p={p} heute={heute} erledigt={e} aktionen={e ? undefined : aktionen} onOeffnen={onOeffnen} onAbhaken={onAbhaken} />;
                }
                const offenImProjekt = b.zeilen.filter((z) => !z.erledigt).length;
                const geschlossen = zu.has(b.id);
                return [
                  <li key={`projekt-${b.id}`} className="tp-projektzeile">
                    <button type="button" onClick={() => umschalten(b.id)} aria-expanded={!geschlossen} title={geschlossen ? 'Teilaufgaben anzeigen' : 'Teilaufgaben einklappen'}>
                      <span className="tp-projekt-pfeil" aria-hidden="true">{geschlossen ? '▸' : '▾'}</span>
                      <span className="tp-projekt-titel">{b.titel}</span>
                      <span className="tp-projekt-anzahl">{b.zeilen.length} {b.zeilen.length === 1 ? 'Teilaufgabe' : 'Teilaufgaben'}{offenImProjekt < b.zeilen.length ? ` · ${b.zeilen.length - offenImProjekt} erledigt` : ''}</span>
                    </button>
                  </li>,
                  ...(geschlossen ? [] : b.zeilen.map(({ p, erledigt: e }) => (
                    <Zeile key={p.id} p={p} heute={heute} erledigt={e} inProjekt aktionen={e ? undefined : aktionen} onOeffnen={onOeffnen} onAbhaken={onAbhaken} />
                  ))),
                ];
              })}
            </ul>
          </div>
        );
      })}
      </div>
      )}
      {total === 0 && !(erledigtAnzahl > 0) && <div className="tp-leer">{leerText}</div>}
      {total === 0 && erledigtAnzahl > 0 && <div className="tp-alles">Alles erledigt.</div>}
      {total > 0 && offen.length === 0 && <div className="tp-alles">Alles erledigt.</div>}
    </section>
  );
}

// Cockpit (v7): nur Heute, Morgen und Wochenziele -- klar getrennt, mit Abhaken. Alles ohne
// Bearbeitungstag liegt im Ordner "Zu planen".
export default function TagesCockpit() {
  const { benutzer } = useAuth();
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();
  const heute = heutigesDatumISO();

  const laden = useCallback(() => {
    Promise.all([
      api.pendenzen.offene(),
      api.pendenzen.liste({ status: 'Erledigt', erledigtVon: montagDerWoche(heutigesDatumISO()) }),
      api.pendenzen.eingangAnzahl(),
    ]).then(([offene, erledigte, eingang]) => { setDaten({ offene, erledigte, eingang }); setFehler(null); })
      .catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;
  if (!daten) return <div className="ladeindikator">Lade Cockpit…</div>;

  const plan = tagesplan(daten.offene, daten.erledigte, { heute, ichId: benutzer?.id ?? null });
  const anzahlZuPlanen = zuPlanen(daten.offene).length;
  const morgenName = morgenTitel(heute, plan.morgen.tag);

  async function abhaken(p, erledigt) {
    try {
      await api.pendenzen.statusAendern(p.id, erledigt ? 'Erledigt' : 'Offen');
      meldeAenderung();
    } catch (err) {
      window.alert(err.message);
    }
  }
  async function planen(p, tag) {
    try {
      await api.pendenzen.aktualisieren(p.id, { bearbeitungstag: tag });
      meldeAenderung();
    } catch (err) {
      window.alert(err.message);
    }
  }

  const zuPlanenAktion = { label: 'Zu planen', titel: 'Bearbeitungstag entfernen – in den Ordner «Zu planen»', ausfuehren: (p) => planen(p, null) };

  return (
    <div className="tp-seite">
      <div className="tp-kopf">
        <h1 className="seiten-titel">Cockpit</h1>
        <span className="tp-kopf-datum">{tagText(heute)}{heute.slice(0, 4)}</span>
        <span className="tp-kopf-links">
          <Link to="/planen">Zu planen <strong>{anzahlZuPlanen}</strong></Link>
          {daten.eingang > 0 && <Link to="/eingang">Eingang <strong>{daten.eingang}</strong></Link>}
          <Link to="/uebersicht">Übersicht &amp; Kalender</Link>
        </span>
      </div>

      <div className="tp-karten">
        <Karte
          titel="Heute"
          untertitel={`${tagText(heute)} · geplant, fällig, in Arbeit`}
          offen={plan.heute.offen}
          erledigtAnzahl={plan.heute.erledigt.length}
          leerText="Für heute ist nichts geplant."
          heute={heute}
          aktionen={[{ label: `→ ${morgenName}`, titel: `Auf ${morgenName} verschieben`, ausfuehren: (p) => planen(p, plan.morgen.tag) }, zuPlanenAktion]}
          onOeffnen={setAktivePendenz}
          onAbhaken={abhaken}
        />
        <Karte
          titel={morgenName}
          untertitel={tagText(plan.morgen.tag)}
          offen={plan.morgen.offen}
          leerText={`Für ${morgenName === 'Morgen' ? 'morgen' : morgenName} ist noch nichts geplant.`}
          heute={heute}
          aktionen={[{ label: '→ Heute', titel: 'Auf heute vorziehen', ausfuehren: (p) => planen(p, heute) }, zuPlanenAktion]}
          onOeffnen={setAktivePendenz}
          onAbhaken={abhaken}
        />
        <Karte
          titel="Wochenziele"
          untertitel={`Woche ab ${formatiereDatum(plan.wochenziele.woche)}`}
          offen={plan.wochenziele.offen}
          erledigt={plan.wochenziele.erledigt}
          leerText="Keine Wochenziele – im Wochenrückblick die 3–5 wichtigsten Ergebnisse festlegen."
          heute={heute}
          onOeffnen={setAktivePendenz}
          onAbhaken={abhaken}
        />
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
