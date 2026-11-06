import { useEffect, useState } from 'react';
import api from '../api.js';
import FormularModal from './FormularModal.jsx';
import { meldeZeitAenderung, meldeAenderung } from '../events.js';
import { heutigesDatumISO } from '../format.js';
import { aktivePauschalen } from '../lib/preise.js';
import {
  ZEIT_ARTEN, laufendeMinuten, formatiereDauer, parseDauer, leistungVorschlag, artVorschlag, ansatzFuer,
  pauschalLeistungIds,
} from '../lib/zeit.js';
import { chf } from '../lib/offerte.js';

const wert = (w) => (w == null ? '' : String(w));

// Zeit erfassen, korrigieren oder einen laufenden Timer stoppen (v7, Etappe 2).
//   eintrag: bestehender Zeiteintrag (laufend = minuten null) oder null fuer neu
//   pendenz: optional -- neue Zeit zu dieser Pendenz (Mandant/Leistung/Text vorgeschlagen)
export default function ZeitModal({ eintrag = null, pendenz = null, onSchliessen, onGespeichert }) {
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    Promise.all([api.mandanten.liste(), api.preise.leistungen.liste(), api.preise.ansaetze.liste(), api.pauschalen.liste()])
      .then(([mandanten, leistungen, ansaetze, pauschalen]) => setDaten({ mandanten, leistungen, ansaetze, pauschalen }))
      .catch((e) => setFehler(e.message));
  }, []);

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
  const pauschalenVon = (mandantId) => aktivePauschalen(pauschalen.filter((p) => String(p.mandant_id) === String(mandantId)), heute);
  const leistungVon = (id) => leistungen.find((l) => String(l.id) === String(id));

  let start;
  if (eintrag) {
    start = {
      datum: eintrag.datum, dauer: formatiereDauer(laeuft ? laufendeMinuten(eintrag.timer_start) : eintrag.minuten),
      mandantId: wert(eintrag.mandant_id), leistungId: wert(eintrag.leistung_id), art: eintrag.art === 'intern' ? 'pauschal' : eintrag.art,
      stundenansatzChf: wert(eintrag.stundenansatz_chf ?? (eintrag.art === 'extra' ? ansatzFuer(leistungVon(eintrag.leistung_id), ansaetze) : '')),
      beschreibung: eintrag.beschreibung ?? eintrag.pendenzen?.titel ?? '', ansatzManuell: eintrag.stundenansatz_chf != null,
    };
  } else {
    const mandantId = pendenz?.mandant_id ?? '';
    const leistungId = leistungVorschlag(pendenz, pauschalenVon(mandantId));
    const art = artVorschlag(mandantId, leistungId, pauschalenVon(mandantId));
    start = {
      datum: heute, dauer: '', mandantId: wert(mandantId), leistungId: wert(leistungId), art: art === 'intern' ? 'pauschal' : art,
      stundenansatzChf: wert(ansatzFuer(leistungVon(leistungId), ansaetze)), beschreibung: pendenz?.titel ?? '', ansatzManuell: false,
    };
  }

  const aktiveMandanten = mandanten.filter((m) => m.aktiv || String(m.id) === start.mandantId);
  const pendenzId = eintrag ? eintrag.pendenz_id : pendenz?.id ?? null;

  return (
    <FormularModal
      titel={laeuft ? 'Timer stoppen' : eintrag ? 'Zeit bearbeiten' : `Zeit erfassen${pendenz ? ` · ${pendenz.titel}` : ''}`}
      speichernText={laeuft ? 'Stoppen & speichern' : 'Speichern'}
      startwerte={start}
      felder={[
        { name: 'datum', label: 'Datum', typ: 'datum', pflicht: true, halb: true },
        { name: 'dauer', label: 'Dauer', typ: 'text', pflicht: true, halb: true, platzhalter: 'z.B. 1:30 oder 45',
          hinweis: 'h:mm, Stunden (1.5) oder Minuten (45).' },
        { name: 'mandantId', label: 'Mandant', typ: 'select', leer: 'Intern (eigenes Büro)',
          optionen: aktiveMandanten.map((m) => ({ wert: String(m.id), label: m.name })) },
        { name: 'leistungId', label: 'Leistung', typ: 'select', leer: '– keine –', halb: true,
          optionen: leistungen.filter((l) => l.aktiv || String(l.id) === start.leistungId).map((l) => ({ wert: String(l.id), label: l.name })) },
        { name: 'art', label: 'Art', typ: 'select', leer: false, halb: true, sichtbar: (f) => !!f.mandantId,
          optionen: ZEIT_ARTEN.filter((a) => a.wert !== 'intern').map((a) => ({ wert: a.wert, label: a.lang })) },
        { name: 'stundenansatzChf', label: 'Ansatz CHF/Std.', typ: 'zahl', schritt: '0.05', sichtbar: (f) => !!f.mandantId && f.art === 'extra' },
        { name: 'beschreibung', label: 'Text im Rapport', typ: 'textarea', hinweis: 'So erscheint die Arbeit im Detailrapport an den Kunden.' },
      ]}
      onAendern={(name, neuerWert, f) => {
        if (name === 'stundenansatzChf') return { ansatzManuell: neuerWert !== '' };
        if (name !== 'mandantId' && name !== 'leistungId') return null;
        const p = pauschalenVon(f.mandantId);
        let leistungId = f.leistungId;
        if (name === 'mandantId' && !leistungId) leistungId = wert(leistungVorschlag({ leistung_id: pendenz?.leistung_id }, p));
        const art = artVorschlag(f.mandantId, leistungId, p);
        const patch = { leistungId, art: art === 'intern' ? 'pauschal' : art };
        if (!f.ansatzManuell) patch.stundenansatzChf = wert(ansatzFuer(leistungVon(leistungId), ansaetze));
        return patch;
      }}
      vorschau={(f) => {
        const minuten = parseDauer(f.dauer);
        if (!f.mandantId) return 'Interne Zeit – zählt nicht in die Rentabilität eines Mandanten.';
        const inPauschale = pauschalLeistungIds(pauschalenVon(f.mandantId)).has(Number(f.leistungId));
        if (f.art === 'extra') {
          const betrag = minuten != null && f.stundenansatzChf !== '' ? (minuten / 60) * Number(f.stundenansatzChf) : null;
          return `Extra: ${minuten != null ? formatiereDauer(minuten) : '–'} h × ${chf(f.stundenansatzChf || 0)} = ${betrag == null ? '–' : chf(betrag)} (exkl. MWST)`
            + (inPauschale ? ' · Achtung: Diese Leistung ist in der Pauschale des Mandanten enthalten.' : '');
        }
        return 'In der Pauschale – erscheint im Rapport mit Zeit, ohne Betrag.'
          + (f.leistungId && !inPauschale ? ' · Hinweis: Für diese Leistung hat der Mandant keine Pauschale.' : '');
      }}
      onSpeichern={async (f) => {
        const minuten = parseDauer(f.dauer);
        if (minuten == null) throw new Error('Dauer nicht erkannt – z.B. 1:30, 1.5 oder 90 eingeben.');
        await api.zeit.speichern(eintrag?.id ?? null, {
          datum: f.datum, minuten, mandantId: f.mandantId || null, leistungId: f.leistungId || null, art: f.art,
          stundenansatzChf: f.art === 'extra' ? f.stundenansatzChf : null, beschreibung: f.beschreibung, pendenzId,
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
  );
}
