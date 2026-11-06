import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import FormularModal from './FormularModal.jsx';
import MandantSuche from './MandantSuche.jsx';
import MandantModal from './MandantModal.jsx';
import { meldeZeitAenderung, meldeAenderung, meldeMandantenAenderung } from '../events.js';
import { heutigesDatumISO } from '../format.js';
import { aktivePauschalen } from '../lib/preise.js';
import {
  ZEIT_ARTEN, laufendeMinuten, formatiereDauer, parseDauer, leistungVorschlag, artVorschlag, ansatzFuer,
  pauschalLeistungIds, uhrzeitAus, minutenZwischen, uhrzeitPlus,
} from '../lib/zeit.js';
import { chf } from '../lib/offerte.js';

const wert = (w) => (w == null ? '' : String(w));

// Zeit erfassen, korrigieren oder einen laufenden Timer stoppen.
//   eintrag: bestehender Zeiteintrag (laufend = minuten null) oder null fuer neu
//   pendenz: optional -- neue Zeit zu dieser Pendenz (Mandant/Leistung/Text vorgeschlagen)
// Der Mandant muss bewusst gewaehlt werden; interne Zeit nur per Haekchen.
export default function ZeitModal({ eintrag = null, pendenz = null, onSchliessen, onGespeichert }) {
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [neuerMandant, setNeuerMandant] = useState(null); // { name }
  const mandantSetzen = useRef(null);

  function laden() {
    return Promise.all([api.mandanten.liste(), api.preise.leistungen.liste(), api.preise.ansaetze.liste(), api.pauschalen.liste()])
      .then(([mandanten, leistungen, ansaetze, pauschalen]) => setDaten({ mandanten, leistungen, ansaetze, pauschalen }))
      .catch((e) => setFehler(e.message));
  }
  useEffect(() => { laden(); }, []);

  if (fehler) {
    return (
      <div className="modal-hintergrund" onClick={onSchliessen}>
        <div className="modal" onClick={(e) => e.stopPropagation()}><div className="modal-koerper"><div className="hinweis-fehler">{fehler}</div></div></div>
      </div>
    );
  }
  if (!daten) return null;

  const { mandanten, leistungen, ansaetze, pauschalen } = daten;
  const heute = heutigesDatumISO();
  const laeuft = eintrag && eintrag.minuten == null;
  const pauschalenVon = (mandantId) => (mandantId ? aktivePauschalen(pauschalen.filter((p) => String(p.mandant_id) === String(mandantId)), heute) : []);
  const leistungVon = (id) => leistungen.find((l) => String(l.id) === String(id));

  let start;
  if (eintrag) {
    const minuten = laeuft ? laufendeMinuten(eintrag.timer_start) : eintrag.minuten;
    const von = eintrag.timer_start ? uhrzeitAus(eintrag.timer_start) : '';
    start = {
      datum: eintrag.datum, von, bis: laeuft ? uhrzeitAus(new Date()) : uhrzeitPlus(von, minuten), dauer: formatiereDauer(minuten),
      intern: eintrag.art === 'intern', mandantId: wert(eintrag.mandant_id), leistungId: wert(eintrag.leistung_id),
      art: eintrag.art === 'intern' ? 'pauschal' : eintrag.art,
      stundenansatzChf: wert(eintrag.stundenansatz_chf ?? (eintrag.art === 'extra' ? ansatzFuer(leistungVon(eintrag.leistung_id), ansaetze) : '')),
      beschreibung: eintrag.beschreibung ?? eintrag.pendenzen?.titel ?? '', ansatzManuell: eintrag.stundenansatz_chf != null,
    };
  } else {
    const mandantId = pendenz?.mandant_id ?? '';
    const leistungId = leistungVorschlag(pendenz, pauschalenVon(mandantId));
    // Verrechnung des Teilschritts (Pauschal/Extra) geht vor; sonst Vorschlag aus den Pauschalen.
    const art = pendenz?.verrechnung && mandantId ? pendenz.verrechnung : artVorschlag(mandantId, leistungId, pauschalenVon(mandantId));
    start = {
      datum: heute, von: '', bis: '', dauer: '', intern: !!pendenz && !pendenz.mandant_id,
      mandantId: wert(mandantId), leistungId: wert(leistungId), art: art === 'intern' ? 'pauschal' : art,
      stundenansatzChf: wert(ansatzFuer(leistungVon(leistungId), ansaetze)), beschreibung: pendenz?.titel ?? '', ansatzManuell: false,
    };
  }
  const pendenzId = eintrag ? eintrag.pendenz_id : pendenz?.id ?? null;

  // Art und Ansatz neu vorschlagen, wenn Mandant oder Leistung wechselt.
  function vorschlag(f, patch = {}) {
    const g = { ...f, ...patch };
    const p = pauschalenVon(g.mandantId);
    let leistungId = g.leistungId;
    if (patch.mandantId !== undefined && !leistungId) leistungId = wert(leistungVorschlag({ leistung_id: pendenz?.leistung_id }, p));
    const art = artVorschlag(g.mandantId, leistungId, p);
    const neu = { ...patch, leistungId, art: art === 'intern' ? 'pauschal' : art };
    if (!g.ansatzManuell) neu.stundenansatzChf = wert(ansatzFuer(leistungVon(leistungId), ansaetze));
    return neu;
  }

  return (
    <>
      <FormularModal
        titel={laeuft ? 'Timer stoppen' : eintrag ? 'Zeit bearbeiten' : `Zeit erfassen${pendenz ? ` · ${pendenz.titel}` : ''}`}
        speichernText={laeuft ? 'Stoppen & speichern' : 'Speichern'}
        breit
        startwerte={start}
        felder={[
          { name: 'mandantId', label: 'Mandant', typ: 'eigen', sichtbar: (f) => !f.intern,
            render: ({ id, wert: w, setzen }) => {
              mandantSetzen.current = setzen;
              return (
                <MandantSuche
                  id={id}
                  mandanten={mandanten}
                  wert={w}
                  onWahl={setzen}
                  onNeu={(text) => setNeuerMandant({ name: text.trim() })}
                />
              );
            } },
          { name: 'intern', label: 'Interne Zeit (eigenes Büro, ohne Mandant)', typ: 'checkbox' },
          { name: 'datum', label: 'Datum', typ: 'datum', pflicht: true, halb: true },
          { name: 'dauer', label: 'Dauer', typ: 'text', pflicht: true, halb: true, platzhalter: 'z.B. 1:00, 1.5 oder 45',
            hinweis: 'Wird aus Von/Bis berechnet – oder direkt eingeben.' },
          { name: 'von', label: 'Von', typ: 'uhrzeit', halb: true },
          { name: 'bis', label: 'Bis', typ: 'uhrzeit', halb: true },
          { name: 'leistungId', label: 'Leistung', typ: 'select', leer: '– keine –', halb: true, sichtbar: (f) => !f.intern,
            optionen: leistungen.filter((l) => l.aktiv || String(l.id) === start.leistungId).map((l) => ({ wert: String(l.id), label: l.name })) },
          { name: 'art', label: 'Art', typ: 'select', leer: false, halb: true, sichtbar: (f) => !f.intern,
            optionen: ZEIT_ARTEN.filter((a) => a.wert !== 'intern').map((a) => ({ wert: a.wert, label: a.lang })) },
          { name: 'stundenansatzChf', label: 'Ansatz CHF/Std.', typ: 'zahl', schritt: '0.05', sichtbar: (f) => !f.intern && f.art === 'extra' },
          { name: 'beschreibung', label: 'Text im Rapport', typ: 'textarea', hinweis: 'So erscheint die Arbeit im Detailrapport an den Kunden.' },
        ]}
        onAendern={(name, neuerWert, f) => {
          if (name === 'stundenansatzChf') return { ansatzManuell: neuerWert !== '' };
          if (name === 'von' || name === 'bis') {
            const m = minutenZwischen(f.von, f.bis);
            return m == null ? null : { dauer: formatiereDauer(m) };
          }
          if (name === 'dauer') {
            const m = parseDauer(neuerWert);
            return f.von && m != null ? { bis: uhrzeitPlus(f.von, m) } : null;
          }
          if (name === 'intern') return neuerWert ? { mandantId: '' } : null;
          if (name === 'mandantId') return vorschlag(f, { mandantId: neuerWert });
          if (name === 'leistungId') return vorschlag(f, { leistungId: neuerWert });
          return null;
        }}
        vorschau={(f) => {
          if (eintrag?.rapport_id) return 'Diese Zeit ist bereits in einem Detailrapport verrechnet – Änderungen erst nach einem Storno des Rapports.';
          const minuten = parseDauer(f.dauer);
          if (f.intern) return 'Interne Zeit – zählt nicht in die Rentabilität eines Mandanten.';
          if (!f.mandantId) return 'Bitte den Mandanten wählen (oder «Interne Zeit» ankreuzen).';
          const inPauschale = pauschalLeistungIds(pauschalenVon(f.mandantId)).has(Number(f.leistungId));
          if (f.art === 'extra') {
            const betrag = minuten != null && f.stundenansatzChf !== '' ? (minuten / 60) * Number(f.stundenansatzChf) : null;
            return `Extra: ${minuten != null ? formatiereDauer(minuten) : '–'} h × ${chf(f.stundenansatzChf || 0)} = ${betrag == null ? '–' : chf(betrag)} (exkl. MWST) – erscheint im Rapport zum Verrechnen.`
              + (inPauschale ? ' Achtung: Diese Leistung ist in der Pauschale des Mandanten enthalten.' : '');
          }
          return 'In der Pauschale – erscheint im Rapport mit Zeit, ohne Betrag.'
            + (f.leistungId && !inPauschale ? ' Hinweis: Für diese Leistung hat der Mandant keine Pauschale.' : '');
        }}
        onSpeichern={async (f) => {
          if (!f.intern && !f.mandantId) throw new Error('Bitte den Mandanten wählen – oder «Interne Zeit» ankreuzen.');
          const minuten = parseDauer(f.dauer);
          if (minuten == null) throw new Error('Dauer nicht erkannt – z.B. 1:00, 1.5 oder 60 eingeben, oder Von/Bis ausfüllen.');
          const beginn = f.von ? new Date(`${f.datum}T${f.von}`).toISOString() : (eintrag?.timer_start ?? null);
          await api.zeit.speichern(eintrag?.id ?? null, {
            datum: f.datum, minuten, beginn, mandantId: f.intern ? null : f.mandantId, leistungId: f.intern ? null : (f.leistungId || null),
            art: f.art, stundenansatzChf: f.art === 'extra' ? f.stundenansatzChf : null, beschreibung: f.beschreibung, pendenzId,
            mitarbeiterId: eintrag?.mitarbeiter_id,
          });
          meldeZeitAenderung();
          if (pendenzId) meldeAenderung();
          onGespeichert?.();
        }}
        onLoeschen={eintrag ? async () => {
          await api.zeit.loeschen(eintrag.id);
          meldeZeitAenderung();
          onGespeichert?.();
        } : undefined}
        loeschenText={laeuft ? 'Timer verwerfen (keine Zeit speichern)?' : 'Diesen Zeiteintrag löschen?'}
        onSchliessen={onSchliessen}
      />
      {neuerMandant && (
        <MandantModal
          mandant={null}
          alleMandanten={mandanten}
          vorgabeName={neuerMandant.name}
          onSchliessen={() => setNeuerMandant(null)}
          onGespeichert={async (m) => {
            setNeuerMandant(null);
            meldeMandantenAenderung();
            await laden();
            mandantSetzen.current?.(String(m.id));
          }}
        />
      )}
    </>
  );
}
