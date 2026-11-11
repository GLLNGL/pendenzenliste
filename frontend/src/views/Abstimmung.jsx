import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api.js';
import { useAblageGrund, useMandanten } from '../hooks.js';
import { relativerOrdner } from '../lib/ablage.js';
import { unterstuetzt, dateiAblegen, dateiLesen } from '../lib/ablageOrdner.js';
import { chf } from '../lib/offerte.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import {
  BEREICHE, STATUS, TOLERANZ, mwstLeer, mwstMethodeWechseln, mwstBerechnen, svLeer, svBerechnen, bewertungGesamt,
  abstimmungOrdner, standardJahr,
} from '../lib/abstimmung.js';

const betrag = (x) => (x == null ? '–' : chf(x).replace('CHF ', ''));

function Zahl({ wert, onChange, breit = false, schmal = false, platzhalter = '0.00' }) {
  return (
    <input
      className={`abst-zahl ${breit ? 'abst-zahl-breit' : ''} ${schmal ? 'abst-zahl-schmal' : ''}`}
      inputMode="decimal"
      value={wert ?? ''}
      placeholder={platzhalter}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Differenz({ d }) {
  if (!d || d.ok == null) return <span className="abst-diff abst-diff-leer">–</span>;
  return <span className={`abst-diff ${d.ok ? 'abst-diff-ok' : 'abst-diff-fehler'}`}>{d.ok ? '✓ ' : ''}{betrag(d.betrag)}</span>;
}

// Zeile "Bezeichnung | Wert | Vergleich | Differenz" einer Abstimmung.
function Zeile({ label, hinweis, children, vergleich, d }) {
  return (
    <tr>
      <td>{label}{hinweis && <div className="text-gedaempft">{hinweis}</div>}</td>
      <td className="zahl">{children}</td>
      <td className="zahl">{vergleich}</td>
      <td className="zahl">{d !== undefined && <Differenz d={d} />}</td>
    </tr>
  );
}

// Liste "Text | Betrag" (Korrekturen / Ueberleitung).
function Korrekturen({ liste, onChange, platzhalter }) {
  const aendern = (i, patch) => onChange(liste.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  return (
    <>
      {liste.map((k, i) => (
        <tr key={i} className="abst-korrektur">
          <td>
            <input className="abst-text" value={k.text ?? ''} placeholder={platzhalter} onChange={(e) => aendern(i, { text: e.target.value })} />
          </td>
          <td className="zahl"><Zahl wert={k.betrag} onChange={(v) => aendern(i, { betrag: v })} /></td>
          <td colSpan={2}>
            <button type="button" className="btn-klein btn-gefahr-text" onClick={() => onChange(liste.filter((_, j) => j !== i))} aria-label="Korrektur entfernen">×</button>
          </td>
        </tr>
      ))}
      <tr>
        <td colSpan={4}>
          <button type="button" className="btn-klein" onClick={() => onChange([...liste, { text: '', betrag: '' }])}>+ Korrektur (±)</button>
        </td>
      </tr>
    </>
  );
}

function MwstFormular({ daten, setDaten }) {
  const r = mwstBerechnen(daten);
  const saldo = daten.methode === 'saldo';
  const feld = (name) => (v) => setDaten({ ...daten, [name]: v });
  const periode = (i, name) => (v) => setDaten({ ...daten, perioden: daten.perioden.map((p, j) => (j === i ? { ...p, [name]: v } : p)) });
  return (
    <>
      <div className="abst-methode">
        <span>Abrechnungsmethode</span>
        {[['effektiv', 'effektiv (Quartal)'], ['saldo', 'Saldosteuersatz (Semester)']].map(([wert, label]) => (
          <button key={wert} type="button" className={`btn-klein ${daten.methode === wert ? 'gewaehlt' : ''}`} onClick={() => setDaten(mwstMethodeWechseln(daten, wert))}>{label}</button>
        ))}
        {saldo && <label className="abst-sss">Saldosteuersatz <Zahl wert={daten.sssSatz} onChange={feld('sssSatz')} platzhalter="%" schmal /> %</label>}
      </div>

      <div className="karte abst-karte">
        <div className="abst-karte-titel">Abrechnungen ESTV</div>
        <table className="tabelle abst-tabelle">
          <thead>
            <tr>
              <th>Periode</th>
              <th className="zahl">Umsatz deklariert<br /><span className="abst-kopf-zusatz">Ziff. 200{saldo ? ' (inkl. MWST)' : ''}</span></th>
              <th className="zahl">Umsatzsteuer<br /><span className="abst-kopf-zusatz">Ziff. 399</span></th>
              {!saldo && <th className="zahl">Vorsteuer<br /><span className="abst-kopf-zusatz">Ziff. 479</span></th>}
              <th className="zahl">Zahllast</th>
              <th className="zahl">Bezahlt bis 31.12.</th>
            </tr>
          </thead>
          <tbody>
            {daten.perioden.map((p, i) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td className="zahl"><Zahl wert={p.umsatz} onChange={periode(i, 'umsatz')} breit /></td>
                <td className="zahl"><Zahl wert={p.steuer} onChange={periode(i, 'steuer')} /></td>
                {!saldo && <td className="zahl"><Zahl wert={p.vorsteuer} onChange={periode(i, 'vorsteuer')} /></td>}
                <td className="zahl">{betrag(r.perioden[i]?.zahllast)}</td>
                <td className="zahl"><Zahl wert={p.bezahlt} onChange={periode(i, 'bezahlt')} /></td>
              </tr>
            ))}
            <tr className="abst-summe">
              <td>Total</td>
              <td className="zahl">{betrag(r.umsatzDeklariert)}</td>
              <td className="zahl">{betrag(r.steuerDeklariert)}</td>
              {!saldo && <td className="zahl">{betrag(r.vorsteuerDeklariert)}</td>}
              <td className="zahl">{betrag(r.zahllast)}</td>
              <td className="zahl">{betrag(r.bezahlt)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="karte abst-karte">
        <div className="abst-karte-titel">Umsatzabstimmung</div>
        <table className="tabelle abst-tabelle">
          <thead><tr><th>Position</th><th className="zahl">Betrag</th><th className="zahl">Vergleich</th><th className="zahl">Differenz</th></tr></thead>
          <tbody>
            <Zeile label="Betriebsertrag laut Erfolgsrechnung" hinweis={saldo ? 'inkl. MWST' : 'exkl. MWST'}><Zahl wert={daten.umsatzBuchhaltung} onChange={feld('umsatzBuchhaltung')} breit /></Zeile>
            <Korrekturen liste={daten.korrekturen ?? []} onChange={feld('korrekturen')} platzhalter="z.B. Zinsertrag, Eigenverbrauch, Debitorenveränderung" />
            <tr className="abst-summe"><td>= zu deklarierender Umsatz</td><td className="zahl">{betrag(r.umsatzSoll)}</td><td /><td /></tr>
            <Zeile label="Umsatz deklariert (Total Abrechnungen)" vergleich={betrag(r.umsatzSoll)} d={r.diffUmsatz}>{betrag(r.umsatzDeklariert)}</Zeile>
          </tbody>
        </table>
      </div>

      <div className="karte abst-karte">
        <div className="abst-karte-titel">Steuer- und Kontenabstimmung per 31.12.</div>
        <table className="tabelle abst-tabelle">
          <thead><tr><th>Konto</th><th className="zahl">Saldo Buchhaltung</th><th className="zahl">laut Abrechnungen</th><th className="zahl">Differenz</th></tr></thead>
          <tbody>
            <Zeile label="Umsatzsteuer" hinweis="Konto 2200, Bewegung im Jahr" vergleich={betrag(r.steuerDeklariert)} d={r.diffSteuer}><Zahl wert={daten.steuerKonto} onChange={feld('steuerKonto')} /></Zeile>
            {saldo && <Zeile label="Steuer zum Saldosteuersatz" hinweis={`Umsatz × ${daten.sssSatz || '?'} %`} vergleich={betrag(r.steuerSoll)} d={r.diffSss}>{betrag(r.steuerDeklariert)}</Zeile>}
            {!saldo && <Zeile label="Vorsteuer" hinweis="Konten 1170/1171, Bewegung im Jahr" vergleich={betrag(r.vorsteuerDeklariert)} d={r.diffVorsteuer}><Zahl wert={daten.vorsteuerKonto} onChange={feld('vorsteuerKonto')} /></Zeile>}
            <Zeile label="MWST-Abrechnungskonto" hinweis="Schuld +, Guthaben − · Zahllast − bezahlt" vergleich={betrag(r.offen)} d={r.diffKonto}><Zahl wert={daten.saldoAbrechnungskonto} onChange={feld('saldoAbrechnungskonto')} /></Zeile>
          </tbody>
        </table>
      </div>
    </>
  );
}

function SvFormular({ bereich, daten, setDaten }) {
  const r = svBerechnen(daten);
  const feld = (name) => (v) => setDaten({ ...daten, [name]: v });
  const beitrag = (i, patch) => setDaten({ ...daten, beitraege: daten.beitraege.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const bvg = bereich === 'bvg';
  return (
    <>
      <div className="karte abst-karte">
        <div className="abst-karte-titel">Lohnsumme</div>
        <table className="tabelle abst-tabelle">
          <thead><tr><th>Position</th><th className="zahl">Betrag</th><th /><th /></tr></thead>
          <tbody>
            <Zeile label="Lohnsumme laut Lohnjournal" hinweis={bvg ? 'Jahreslöhne der versicherten Personen' : 'Bruttolohn Jahr'}><Zahl wert={daten.lohnsumme} onChange={feld('lohnsumme')} breit /></Zeile>
            <Korrekturen liste={daten.korrekturen ?? []} onChange={feld('korrekturen')} platzhalter={bereich === 'ahv' ? 'z.B. Rentnerfreibetrag, Spesen, über Höchstlohn' : 'z.B. Lohn über Höchstbetrag, nicht versicherte Personen'} />
            <tr className="abst-summe"><td>= massgebende Lohnsumme</td><td className="zahl">{betrag(r.massgebend)}</td><td /><td /></tr>
          </tbody>
        </table>
      </div>

      <div className="karte abst-karte">
        <div className="abst-karte-titel">Beiträge (Soll)</div>
        <table className="tabelle abst-tabelle">
          <thead>
            <tr>
              <th>Beitragsart</th>
              <th className="zahl">Basis<br /><span className="abst-kopf-zusatz">leer = massgebend</span></th>
              <th className="zahl">Satz %</th>
              <th className="zahl">oder Betrag</th>
              <th className="zahl">AN-Anteil %</th>
              <th className="zahl">Soll</th>
              <th className="zahl">davon AN</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {daten.beitraege.map((b, i) => (
              <tr key={i}>
                <td><input className="abst-text" value={b.bez ?? ''} onChange={(e) => beitrag(i, { bez: e.target.value })} /></td>
                <td className="zahl"><Zahl wert={b.basis} onChange={(v) => beitrag(i, { basis: v })} platzhalter={betrag(r.massgebend)} /></td>
                <td className="zahl"><Zahl wert={b.satz} onChange={(v) => beitrag(i, { satz: v })} platzhalter="%" schmal /></td>
                <td className="zahl"><Zahl wert={b.betrag} onChange={(v) => beitrag(i, { betrag: v })} platzhalter="–" /></td>
                <td className="zahl"><Zahl wert={b.an} onChange={(v) => beitrag(i, { an: v })} platzhalter="%" schmal /></td>
                <td className="zahl">{betrag(r.zeilen[i]?.soll)}</td>
                <td className="zahl">{betrag(r.zeilen[i]?.an)}</td>
                <td><button type="button" className="btn-klein btn-gefahr-text" onClick={() => setDaten({ ...daten, beitraege: daten.beitraege.filter((_, j) => j !== i) })} aria-label="Beitragsart entfernen">×</button></td>
              </tr>
            ))}
            <tr>
              <td colSpan={5}><button type="button" className="btn-klein" onClick={() => setDaten({ ...daten, beitraege: [...daten.beitraege, { bez: '', satz: '', an: 0 }] })}>+ Beitragsart</button></td>
              <td className="zahl abst-summe-zelle">{betrag(r.sollTotal)}</td>
              <td className="zahl abst-summe-zelle">{betrag(r.anSoll)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="karte abst-karte">
        <div className="abst-karte-titel">Abstimmung</div>
        <table className="tabelle abst-tabelle">
          <thead><tr><th>Position</th><th className="zahl">Ist</th><th className="zahl">Soll</th><th className="zahl">Differenz</th></tr></thead>
          <tbody>
            <Zeile label="Beiträge laut Schlussabrechnung" hinweis={`Total ${BEREICHE[bereich].kurz}-Abrechnung des Jahres`} vergleich={betrag(r.sollTotal)} d={r.diffAbrechnung}><Zahl wert={daten.abrechnung} onChange={feld('abrechnung')} /></Zeile>
            <Zeile label="Akontozahlungen im Jahr" hinweis="Rechnungen bzw. Zahlungen laut Konto"><Zahl wert={daten.akonto} onChange={feld('akonto')} /></Zeile>
            <tr className="abst-summe"><td>= Nachzahlung (+) / Guthaben (−) laut Schlussabrechnung</td><td className="zahl">{betrag(r.erwarteterSaldo)}</td><td /><td /></tr>
            <Zeile label="Saldo Kontokorrent per 31.12." hinweis="Schuld +, Guthaben −" vergleich={betrag(r.erwarteterSaldo)} d={r.diffKonto}><Zahl wert={daten.saldoKonto} onChange={feld('saldoKonto')} /></Zeile>
            <Zeile label="AN-Abzüge laut Lohnjournal" vergleich={betrag(r.anSoll)} d={r.diffAN}><Zahl wert={daten.anAbzuege} onChange={feld('anAbzuege')} /></Zeile>
          </tbody>
        </table>
      </div>
    </>
  );
}

function leereDaten(bereich, mandant, vorjahr) {
  return bereich === 'mwst' ? mwstLeer(mandant) : svLeer(bereich, vorjahr);
}

function berechnen(bereich, daten) {
  return bereich === 'mwst' ? mwstBerechnen(daten) : svBerechnen(daten);
}

// Status einer Zeile in der Mandantenliste.
function listenStatus(eintrag, bereich) {
  if (!eintrag) return { klasse: 'abst-pille-offen', text: STATUS.offen };
  if (eintrag.status === 'abgestimmt') return { klasse: 'abst-pille-ok', text: STATUS.abgestimmt };
  if (eintrag.status === 'entfaellt') return { klasse: 'abst-pille-entfaellt', text: STATUS.entfaellt };
  const b = bewertungGesamt(berechnen(bereich, { ...leereDaten(bereich, null, null), ...eintrag.daten }));
  return b === 'differenz' ? { klasse: 'abst-pille-fehler', text: 'Differenz' } : { klasse: 'abst-pille-arbeit', text: STATUS.in_arbeit };
}

// Abstimmung MWST bzw. einer Sozialversicherung fuer den Jahresabschluss: links die Mandanten
// mit Status fuer das gewaehlte Jahr, rechts die Abstimmung des gewaehlten Mandanten.
export default function Abstimmung({ bereich }) {
  const info = BEREICHE[bereich];
  const mandanten = useMandanten();
  const grund = useAblageGrund();
  const [params, setParams] = useSearchParams();
  const jahr = Number(params.get('jahr')) || standardJahr();
  const mandantId = params.get('mandant') ? Number(params.get('mandant')) : null;
  const [suche, setSuche] = useState('');
  const [liste, setListe] = useState([]);
  const [eintrag, setEintrag] = useState(null); // gespeicherte Zeile
  const [daten, setDatenRoh] = useState(null);
  const [bemerkung, setBemerkung] = useState('');
  const [geaendert, setGeaendert] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [laedt, setLaedt] = useState(false);
  const [ziehen, setZiehen] = useState(false);
  const eingabeRef = useRef(null);

  const setDaten = (d) => { setDatenRoh(d); setGeaendert(true); };

  const listeLaden = useCallback(() => {
    api.abstimmungen.liste({ jahr, bereich }).then((l) => { setListe(l); setFehler(null); }).catch((err) => setFehler(/abstimmungen/.test(err.message)
      ? 'Tabelle fehlt – bitte zuerst supabase/abstimmungen-v7.sql in Supabase ausführen.' : err.message));
  }, [jahr, bereich]);
  useEffect(() => { listeLaden(); }, [listeLaden]);

  const aktive = useMemo(() => mandanten.filter((m) => m.aktiv && !m.potenziell), [mandanten]);
  const mandant = mandanten.find((m) => m.id === mandantId) ?? null;

  useEffect(() => {
    let abbruch = false;
    setDatenRoh(null);
    setEintrag(null);
    setGeaendert(false);
    setMeldung(null);
    if (!mandantId || !mandanten.length) return undefined;
    setLaedt(true);
    (async () => {
      try {
        const [gespeichert, vorjahr] = await Promise.all([
          api.abstimmungen.lesen({ mandantId, jahr, bereich }),
          api.abstimmungen.lesen({ mandantId, jahr: jahr - 1, bereich }),
        ]);
        if (abbruch) return;
        const m = mandanten.find((x) => x.id === mandantId);
        const leer = leereDaten(bereich, m, vorjahr?.daten);
        setEintrag(gespeichert);
        setDatenRoh(gespeichert ? { ...leer, ...gespeichert.daten } : leer);
        setBemerkung(gespeichert?.bemerkung ?? '');
      } catch (err) {
        if (!abbruch) setFehler(err.message);
      } finally {
        if (!abbruch) setLaedt(false);
      }
    })();
    return () => { abbruch = true; };
  }, [mandantId, jahr, bereich, mandanten.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  function wechseln(patch) {
    if (geaendert && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    const neu = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v == null ? neu.delete(k) : neu.set(k, String(v))));
    setParams(neu);
  }

  async function speichern(status = eintrag?.status ?? 'in_arbeit', datenNeu = daten) {
    setFehler(null);
    try {
      const zeile = await api.abstimmungen.speichern({
        mandantId, jahr, bereich, daten: datenNeu, status, bemerkung, abgestimmtAm: eintrag?.abgestimmt_am,
      });
      setEintrag(zeile);
      setGeaendert(false);
      setMeldung(status === 'abgestimmt' ? 'Als abgestimmt markiert.' : status === 'entfaellt' ? 'Als «entfällt» markiert.' : 'Gespeichert.');
      listeLaden();
    } catch (err) { setFehler(err.message); }
  }

  const ordner = abstimmungOrdner(relativerOrdner(mandant, grund), jahr, bereich);

  async function unterlagenAblegen(files) {
    const neu = [...files];
    if (!neu.length) return;
    setFehler(null);
    try {
      if (!unterstuetzt()) throw new Error('Direkt ablegen geht nur mit Edge oder Chrome am PC.');
      if (!ordner) throw new Error(`Beim Mandanten «${mandant?.name}» ist kein Ablage-Ordner hinterlegt.`);
      const abgelegt = [];
      for (const f of neu) abgelegt.push({ name: f.name, pfad: await dateiAblegen(f, f.name, ordner), datum: heutigesDatumISO() });
      const datenNeu = { ...daten, unterlagen: [...(daten.unterlagen ?? []), ...abgelegt] };
      setDatenRoh(datenNeu);
      await speichern(eintrag?.status ?? 'in_arbeit', datenNeu);
      setMeldung(`${abgelegt.length} Unterlage(n) abgelegt in ${ordner.join(' › ')}.`);
    } catch (err) {
      if (err?.name !== 'AbortError') setFehler(err.message);
    }
  }

  async function unterlageOeffnen(u) {
    try {
      const datei = await dateiLesen(u.pfad);
      const url = URL.createObjectURL(datei);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { setFehler(err.message); }
  }

  const nachMandant = new Map(liste.map((e) => [e.mandant_id, e]));
  const t = suche.trim().toLowerCase();
  const sichtbar = aktive.filter((m) => !t || `${m.name} ${m.kunden_nr ?? ''}`.toLowerCase().includes(t));
  const erledigt = aktive.filter((m) => ['abgestimmt', 'entfaellt'].includes(nachMandant.get(m.id)?.status)).length;
  const ergebnis = daten ? berechnen(bereich, daten) : null;
  const gesamt = ergebnis ? bewertungGesamt(ergebnis) : 'leer';
  const offeneDifferenzen = ergebnis?.differenzen.filter((d) => !d.ok).length ?? 0;
  const jahre = [0, 1, 2, 3].map((i) => standardJahr() + 1 - i);

  return (
    <div className="arbeitsseite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">{info.titel}</h1>
        <span className="cockpit-kopf-hinweis">Jahresabschluss {jahr} · {erledigt} von {aktive.length} Mandanten erledigt · Differenzen unter CHF {TOLERANZ} gelten als Rundung.</span>
        <span className="kopfzeile-aktionen">
          <label className="abst-jahr">Geschäftsjahr
            <select value={jahr} onChange={(e) => wechseln({ jahr: e.target.value })}>
              {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </label>
        </span>
      </div>

      <div className="karte mandanten-layout">
        <div className="mandanten-liste">
          <input type="search" className="mandanten-suche" placeholder="Mandant suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
          <div className="mandanten-liste-eintraege">
            {sichtbar.map((m) => {
              const s = listenStatus(nachMandant.get(m.id), bereich);
              return (
                <button type="button" key={m.id} className={`uebersicht-kategorie ${mandantId === m.id ? 'aktiv' : ''}`} onClick={() => wechseln({ mandant: m.id })}>
                  <span className="mandanten-name">{m.name}</span>
                  <span className={`abst-pille ${s.klasse}`}>{s.text}</span>
                </button>
              );
            })}
            {sichtbar.length === 0 && <div className="leer-hinweis">Keine aktiven Mandanten.</div>}
          </div>
        </div>

        <div className="mandant-detail">
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
          {!mandant && <div className="leer-hinweis">Links einen Mandanten wählen.</div>}
          {mandant && laedt && <div className="leer-hinweis">Lädt…</div>}
          {mandant && daten && !laedt && (
            <>
              <div className="mandant-kopf">
                <div>
                  <h2 className="mandant-titel">{mandant.name} · {info.kurz} {jahr}</h2>
                  <div className="abst-status-zeile">
                    {eintrag?.status === 'abgestimmt' && <span className="abst-pille abst-pille-ok">abgestimmt am {formatiereDatum(eintrag.abgestimmt_am)}</span>}
                    {eintrag?.status === 'entfaellt' && <span className="abst-pille abst-pille-entfaellt">entfällt</span>}
                    {gesamt === 'ok' && <span className="hinweis-erfolg">Alle erfassten Positionen stimmen.</span>}
                    {gesamt === 'differenz' && <span className="text-ueberfaellig">{offeneDifferenzen} Differenz{offeneDifferenzen === 1 ? '' : 'en'}{bemerkung.trim() ? ' – in der Bemerkung begründet.' : ' – abklären oder in der Bemerkung begründen.'}</span>}
                    {gesamt === 'leer' && <span className="text-gedaempft">Noch keine Werte erfasst.</span>}
                    {bereich === 'mwst' && mandant.mwst_periode === 'keine' && <span className="text-gedaempft"> · Mandant laut Stammdaten nicht MWST-pflichtig.</span>}
                  </div>
                </div>
                <div className="abst-knoepfe">
                  {eintrag?.status === 'abgestimmt' || eintrag?.status === 'entfaellt'
                    ? <button type="button" className="btn" onClick={() => speichern('in_arbeit')}>Wieder öffnen</button>
                    : (
                      <>
                        <button type="button" className="btn" onClick={() => speichern('entfaellt')} title="z.B. keine Angestellten oder nicht pflichtig">Entfällt</button>
                        <button type="button" className="btn" onClick={() => speichern('abgestimmt')} disabled={gesamt === 'differenz' && !bemerkung.trim()} title={gesamt === 'differenz' && !bemerkung.trim() ? 'Differenzen zuerst in der Bemerkung begründen' : ''}>✓ Abgestimmt</button>
                      </>
                    )}
                  <button type="button" className="btn btn-primary" onClick={() => speichern()} disabled={!geaendert}>Speichern</button>
                </div>
              </div>
              {meldung && !geaendert && <div className="hinweis-erfolg abst-meldung">{meldung}</div>}

              {bereich === 'mwst'
                ? <MwstFormular daten={daten} setDaten={setDaten} />
                : <SvFormular bereich={bereich} daten={daten} setDaten={setDaten} />}

              <div className="karte abst-karte">
                <div className="abst-karte-titel">Bemerkung</div>
                <textarea className="abst-bemerkung" value={bemerkung} rows={3} placeholder="Begründung von Differenzen, Korrekturabrechnung, offene Fragen an den Kunden"
                  onChange={(e) => { setBemerkung(e.target.value); setGeaendert(true); }} />
              </div>

              <div className="karte abst-karte">
                <div className="abst-karte-titel">Unterlagen</div>
                {(daten.unterlagen ?? []).length > 0 && (
                  <ul className="abst-unterlagen">
                    {daten.unterlagen.map((u, i) => (
                      <li key={`${u.pfad}-${i}`}>
                        <button type="button" className="link-knopf" onClick={() => unterlageOeffnen(u)}>{u.name}</button>
                        <span className="text-gedaempft"> · {formatiereDatum(u.datum)}</span>
                        <button type="button" className="btn-klein btn-gefahr-text" aria-label="Aus der Liste entfernen" title="Aus der Liste entfernen (Datei in OneDrive bleibt)"
                          onClick={() => setDaten({ ...daten, unterlagen: daten.unterlagen.filter((_, j) => j !== i) })}>×</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div
                  className={`beleg-drop ${ziehen ? 'aktiv' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
                  onDragLeave={() => setZiehen(false)}
                  onDrop={(e) => { e.preventDefault(); setZiehen(false); unterlagenAblegen(e.dataTransfer.files); }}
                  onClick={() => eingabeRef.current?.click()}
                  role="button"
                  tabIndex={0}
                >
                  <div className="beleg-drop-titel">Abrechnungen, Kontoauszüge, Lohnjournal hierher ziehen</div>
                  <div className="beleg-drop-text">{ordner ? `Ablage: ${ordner.join(' › ')}` : 'Beim Mandanten ist kein Ablage-Ordner hinterlegt.'}</div>
                  <input ref={eingabeRef} type="file" multiple hidden onChange={(e) => { unterlagenAblegen(e.target.files); e.target.value = ''; }} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
