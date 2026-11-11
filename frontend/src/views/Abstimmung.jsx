import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api.js';
import { useAblageGrund, useMandanten } from '../hooks.js';
import { relativerOrdner } from '../lib/ablage.js';
import { unterstuetzt, dateiAblegen, dateiLesen } from '../lib/ablageOrdner.js';
import { csvZerlegen, xlsxZeilen } from '../lib/buchungsjournal.js';
import { chf } from '../lib/offerte.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import {
  BEREICHE, GRUNDLAGEN, STATUS, TOLERANZ, MWST_SPALTEN, grundlagenLesen, mwstLeer, mwstRhythmusWechseln, mwstBerechnen,
  svLeer, svBerechnen, bewertungGesamt, abstimmungOrdner, standardJahr, tabellenBlock, zahl,
} from '../lib/abstimmung.js';

const betrag = (x) => (x == null ? '–' : chf(x).replace('CHF ', ''));
const istSv = (bereich) => bereich !== 'mwst';

// Zahlenfeld; onBlock erhaelt einen aus Excel eingefuegten Block (mehrere Zellen).
function Zahl({ wert, onChange, onBlock, breit = false, schmal = false, platzhalter = '0.00' }) {
  return (
    <input
      className={`abst-zahl ${breit ? 'abst-zahl-breit' : ''} ${schmal ? 'abst-zahl-schmal' : ''}`}
      inputMode="decimal"
      value={wert ?? ''}
      placeholder={platzhalter}
      onChange={(e) => onChange(e.target.value)}
      onPaste={onBlock ? (e) => {
        const text = e.clipboardData.getData('text/plain');
        if (!/[\t\n]/.test(text.trim())) return;
        e.preventDefault();
        onBlock(tabellenBlock(text));
      } : undefined}
    />
  );
}

function Text({ wert, onChange, platzhalter, schmal = false }) {
  return <input className={schmal ? 'abst-la' : 'abst-text'} value={wert ?? ''} placeholder={platzhalter} onChange={(e) => onChange(e.target.value)} />;
}

function Differenz({ d }) {
  if (!d || d.ok == null) return <span className="abst-diff abst-diff-leer">–</span>;
  return <span className={`abst-diff ${d.ok ? 'abst-diff-ok' : 'abst-diff-fehler'}`}>{d.ok ? '✓ ' : ''}{betrag(d.betrag)}</span>;
}

function Karte({ titel, zusatz, children }) {
  return (
    <div className="karte abst-karte">
      <div className="abst-karte-titel">{titel}{zusatz && <span className="abst-karte-zusatz">{zusatz}</span>}</div>
      {children}
    </div>
  );
}

// Zeile "Bezeichnung | Ist | Soll | Differenz".
function Zeile({ label, hinweis, ist, soll, d, summe = false }) {
  return (
    <tr className={summe ? 'abst-summe' : ''}>
      <td>{label}{hinweis && <div className="text-gedaempft">{hinweis}</div>}</td>
      <td className="zahl">{ist}</td>
      <td className="zahl">{soll}</td>
      <td className="zahl">{d !== undefined && <Differenz d={d} />}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------------------------
// MWST
// ---------------------------------------------------------------------------------------------
function MwstTabelle({ titel, seite, daten, setDaten, r }) {
  const setze = (i, feld, wert) => setDaten({
    ...daten,
    perioden: daten.perioden.map((p, j) => (j === i ? { ...p, [seite]: { ...p[seite], [feld]: wert } } : p)),
  });
  // Block aus Excel ab Zelle (Periode i, Spalte s) einfuegen: Zeilen = Perioden, Spalten = Felder.
  const block = (i0, s0) => (zeilen) => {
    const perioden = daten.perioden.map((p) => ({ ...p, [seite]: { ...p[seite] } }));
    zeilen.forEach((zeile, dz) => zeile.forEach((zelle, ds) => {
      const p = perioden[i0 + dz];
      const spalte = MWST_SPALTEN[s0 + ds];
      if (p && spalte) p[seite][spalte.feld] = String(zahl(zelle) ?? zelle).trim();
    }));
    setDaten({ ...daten, perioden });
  };
  const total = r[seite];
  return (
    <Karte titel={titel} zusatz="Tipp: Block aus Excel kopieren und ins erste Feld einfügen (Ctrl+V)">
      <table className="tabelle abst-tabelle abst-tabelle-eng">
        <thead>
          <tr>
            <th>Periode</th>
            {seite === 'estv' && <th className="zahl">Satz %</th>}
            {MWST_SPALTEN.map((s) => <th key={s.feld} className="zahl">{s.label}</th>)}
            <th className="zahl">2200 Steuer</th>
            <th className="zahl">Zahllast</th>
            {seite === 'buch' && <th className="zahl">Delta zu ESTV</th>}
          </tr>
        </thead>
        <tbody>
          {daten.perioden.map((p, i) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              {seite === 'estv' && (
                <td className="zahl">
                  <Zahl wert={p.satz} schmal platzhalter={String(daten.satz)} onChange={(v) => setDaten({ ...daten, perioden: daten.perioden.map((x, j) => (j === i ? { ...x, satz: v } : x)) })} />
                </td>
              )}
              {MWST_SPALTEN.map((s, si) => (
                <td key={s.feld} className="zahl">
                  <Zahl wert={p[seite]?.[s.feld]} breit={s.feld === 'umsatz'} onChange={(v) => setze(i, s.feld, v)} onBlock={block(i, si)} />
                </td>
              ))}
              <td className="zahl">{betrag(r.perioden[i]?.[seite].steuer)}</td>
              <td className="zahl">{betrag(r.perioden[i]?.[seite].zahllast)}</td>
              {seite === 'buch' && <td className="zahl"><Differenz d={r.perioden[i]?.delta} /></td>}
            </tr>
          ))}
          <tr className="abst-summe">
            <td>Total</td>
            {seite === 'estv' && <td />}
            {MWST_SPALTEN.map((s) => <td key={s.feld} className="zahl">{betrag(total[s.feld])}</td>)}
            <td className="zahl">{betrag(total.steuer)}</td>
            <td className="zahl">{betrag(total.zahllast)}</td>
            {seite === 'buch' && <td className="zahl"><Differenz d={r.diffZahllast} /></td>}
          </tr>
        </tbody>
      </table>
    </Karte>
  );
}

function MwstFormular({ daten, setDaten }) {
  const r = mwstBerechnen(daten);
  const s = r.spalten;
  return (
    <>
      <div className="abst-methode">
        <span>Abrechnung</span>
        {[['quartal', 'Quartal'], ['semester', 'Semester'], ['monat', 'Monat']].map(([wert, label]) => (
          <button key={wert} type="button" className={`btn-klein ${daten.rhythmus === wert ? 'gewaehlt' : ''}`} onClick={() => setDaten(mwstRhythmusWechseln(daten, wert))}>{label}</button>
        ))}
        <label className="abst-sss">Steuersatz (Standard) <Zahl wert={daten.satz} schmal onChange={(v) => setDaten({ ...daten, satz: v })} platzhalter="8.1" /> %</label>
        <span className="text-gedaempft">Saldosteuersatz: Satz eintragen, Vorsteuer leer lassen.</span>
      </div>

      <MwstTabelle titel="Abrechnungen ESTV (My ESTV)" seite="estv" daten={daten} setDaten={setDaten} r={r} />
      <MwstTabelle titel="Verbuchung Buchhaltung (Abacus)" seite="buch" daten={daten} setDaten={setDaten} r={r} />

      <Karte titel="Jahresabstimmung" zusatz="Verbuchung − Abrechnung (+ = in der Buchhaltung mehr)">
        <table className="tabelle abst-tabelle">
          <thead><tr><th>Position</th><th className="zahl">Differenz</th><th className="zahl">Wirkung auf Zahllast</th><th className="zahl">Check</th></tr></thead>
          <tbody>
            <Zeile label="Umsatz" ist={betrag(s.umsatz)} />
            <Zeile label="Umsatz steuerfrei" ist={betrag(s.steuerfrei)} />
            <Zeile label="Steuerbarer Umsatz × Satz" hinweis="Steuer 2200" ist={betrag(r.umsatzNetto)} soll={betrag(s.steuer)} />
            <Zeile label="1170 Vorsteuer" ist={betrag(s.v1170)} soll={betrag(-s.v1170)} />
            <Zeile label="1171 Vorsteuer" ist={betrag(s.v1171)} soll={betrag(-s.v1171)} />
            <Zeile label="2203" ist={betrag(s.k2203)} soll={betrag(s.k2203)} />
            <Zeile summe label="Zahllast: zu bezahlen (+) / Gutschrift (−)" ist={<Differenz d={r.diffZahllast} />} soll={betrag(r.erklaert)} d={{ betrag: r.check, ok: Math.abs(r.check) < 0.01 }} />
          </tbody>
        </table>
        <div className="text-gedaempft abst-fuss">Check: Die Summe der Wirkungen muss der Zahllast-Differenz entsprechen. Differenzen mit Korrekturabrechnung bereinigen oder in der Bemerkung begründen.</div>
      </Karte>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Sozialversicherungen
// ---------------------------------------------------------------------------------------------
function GrundlagenKarte({ grundlagen, onDateien, laedt }) {
  const [ziehen, setZiehen] = useState(false);
  const eingabeRef = useRef(null);
  const g = grundlagen ?? {};
  return (
    <Karte titel="Grundlagen (für AHV, BVG, UVG und KTG gemeinsam)">
      <div className="abst-grundlagen">
        <div className={`abst-quelle ${g.konten?.length ? 'abst-quelle-ok' : ''}`}>
          <strong>Erfolgsrechnung / Saldenliste</strong>
          {g.konten?.length
            ? <span>{g.konten.length} Konten · {g.kontenDatei} · {formatiereDatum(g.kontenAm)}</span>
            : <span className="text-gedaempft">fehlt – Export mit Spalten Nummer, Bezeichnung, Saldo</span>}
        </div>
        <div className={`abst-quelle ${g.lohnarten?.length ? 'abst-quelle-ok' : ''}`}>
          <strong>Kumulativjournal</strong>
          {g.lohnarten?.length
            ? <span>{g.lohnarten.length} Lohnarten{g.personen ? `, ${g.personen} Personen` : ''} · {g.journalDatei} · {formatiereDatum(g.journalAm)}</span>
            : <span className="text-gedaempft">fehlt – Export mit Spalten LA, Lohnartentext, Total</span>}
        </div>
        <div
          className={`beleg-drop abst-drop ${ziehen ? 'aktiv' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
          onDragLeave={() => setZiehen(false)}
          onDrop={(e) => { e.preventDefault(); setZiehen(false); onDateien(e.dataTransfer.files); }}
          onClick={() => eingabeRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="beleg-drop-titel">{laedt ? 'Liest…' : 'Exporte hierher ziehen'}</div>
          <div className="beleg-drop-text">Excel oder CSV aus Abacus · beide auf einmal möglich · wird erkannt</div>
          <input ref={eingabeRef} type="file" multiple hidden accept=".xlsx,.csv,.txt" onChange={(e) => { onDateien(e.target.files); e.target.value = ''; }} />
        </div>
      </div>
      {(g.konten?.length > 0 || g.lohnarten?.length > 0) && (
        <details className="abst-details">
          <summary>Eingelesene Konten und Lohnarten anzeigen</summary>
          <div className="abst-listen">
            <table className="tabelle abst-tabelle abst-mini">
              <tbody>{(g.konten ?? []).filter((k) => /^5/.test(k.konto) || /^2[23]/.test(k.konto)).map((k) => <tr key={k.konto}><td>{k.konto}</td><td>{k.text}</td><td className="zahl">{betrag(k.saldo)}</td></tr>)}</tbody>
            </table>
            <table className="tabelle abst-tabelle abst-mini">
              <tbody>{(g.lohnarten ?? []).map((l) => <tr key={l.la}><td>{l.la}</td><td>{l.text}</td><td className="zahl">{betrag(l.total)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </Karte>
  );
}

function SvFormular({ bereich, daten, setDaten, grundlagen }) {
  const r = svBerechnen(daten, grundlagen);
  const feld = (name) => (v) => setDaten({ ...daten, [name]: v });
  const beitrag = (i, patch) => setDaten({ ...daten, beitraege: daten.beitraege.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const korrektur = (i, patch) => setDaten({ ...daten, lohnKorrekturen: daten.lohnKorrekturen.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const kurz = BEREICHE[bereich].kurz;
  const ohne = !r.hatKonten || !r.hatJournal;
  return (
    <>
      {ohne && <div className="abst-hinweis">Zuerst oben Erfolgsrechnung und Kumulativjournal einlesen – dann rechnet die Abstimmung automatisch.</div>}

      <Karte titel={`Beiträge laut Lohnjournal und Abrechnung ${kurz}`}>
        <div className="abst-zuordnung">
          <label>Aufwandkonto FiBu <Text schmal wert={daten.konten} onChange={feld('konten')} platzhalter="5700" /></label>
          <span className="text-gedaempft">Lohnarten mit Komma trennen, Bereiche mit Bindestrich (z.B. 9500, 9510-9520).</span>
        </div>
        <table className="tabelle abst-tabelle abst-tabelle-eng">
          <thead>
            <tr>
              <th>Beitragsart</th><th>LA AN</th><th>LA AG</th>
              <th className="zahl">AN</th><th className="zahl">AG</th><th className="zahl">Total Lohnjournal</th>
              <th className="zahl">Jahresbeitrag laut Abrechnung</th><th className="zahl">Delta</th><th />
            </tr>
          </thead>
          <tbody>
            {daten.beitraege.map((b, i) => (
              <tr key={i}>
                <td><Text wert={b.bez} onChange={(v) => beitrag(i, { bez: v })} /></td>
                <td><Text schmal wert={b.laAN} onChange={(v) => beitrag(i, { laAN: v })} platzhalter="–" /></td>
                <td><Text schmal wert={b.laAG} onChange={(v) => beitrag(i, { laAG: v })} platzhalter="–" /></td>
                <td className="zahl">{betrag(r.zeilen[i]?.an)}</td>
                <td className="zahl">{betrag(r.zeilen[i]?.ag)}</td>
                <td className="zahl">{betrag(r.zeilen[i]?.lohn)}</td>
                <td className="zahl"><Zahl wert={b.rechnung} onChange={(v) => beitrag(i, { rechnung: v })} /></td>
                <td className="zahl"><Differenz d={r.zeilen[i]?.delta} /></td>
                <td><button type="button" className="btn-klein btn-gefahr-text" aria-label="Beitragsart entfernen" onClick={() => setDaten({ ...daten, beitraege: daten.beitraege.filter((_, j) => j !== i) })}>×</button></td>
              </tr>
            ))}
            <tr className="abst-summe">
              <td colSpan={3}><button type="button" className="btn-klein" onClick={() => setDaten({ ...daten, beitraege: [...daten.beitraege, { bez: '', laAN: '', laAG: '', rechnung: '' }] })}>+ Beitragsart</button></td>
              <td className="zahl">{betrag(r.an)}</td>
              <td className="zahl">{betrag(r.ag)}</td>
              <td className="zahl">{betrag(r.lohn)}</td>
              <td className="zahl">{betrag(r.rechnung)}</td>
              <td className="zahl"><Differenz d={r.diffRechnung} /></td>
              <td />
            </tr>
          </tbody>
        </table>
      </Karte>

      <Karte titel="Abstimmung FiBu – Lohnbuchhaltung – Versicherung">
        <table className="tabelle abst-tabelle">
          <thead><tr><th>Prüfung</th><th className="zahl">Ist</th><th className="zahl">Soll</th><th className="zahl">Differenz</th></tr></thead>
          <tbody>
            <Zeile label={`Aufwand FiBu (Konto ${daten.konten || '–'})`} hinweis="Soll: AG-Anteil laut Kumulativjournal" ist={betrag(r.fibu)} soll={betrag(r.ag)} d={r.diffFibuJournal} />
            <Zeile label={`Abrechnung ${kurz}`} hinweis="Soll: AN + AG laut Kumulativjournal" ist={betrag(r.rechnung)} soll={betrag(r.lohn)} d={r.diffRechnung} />
            <Zeile label={`Abrechnung ${kurz}`} hinweis="Soll: Aufwand FiBu + AN-Abzüge" ist={betrag(r.rechnung)} soll={betrag(r.fibu + r.an)} d={r.diffRechnungFibu} />
          </tbody>
        </table>
      </Karte>

      <Karte titel="Abgrenzung per 31.12.">
        <table className="tabelle abst-tabelle">
          <thead><tr><th>Position</th><th className="zahl">Betrag</th><th className="zahl">Vergleich</th><th className="zahl">Differenz</th></tr></thead>
          <tbody>
            <Zeile label="Jahresbeitrag laut Abrechnung" ist={betrag(r.rechnung)} />
            <Zeile label="./. bereits fakturiert (Akonto)" hinweis="im Geschäftsjahr verbuchte Rechnungen" ist={<Zahl wert={daten.akonto} onChange={feld('akonto')} />} />
            <Zeile summe label="= abzugrenzen (+) / Guthaben (−)" ist={betrag(r.abzugrenzen)} />
            <Zeile
              label={<>Saldo Bilanzkonto <Text schmal wert={daten.kontoBilanz} onChange={feld('kontoBilanz')} platzhalter="z.B. 2270" /></>}
              hinweis={r.saldoAusListe != null && zahl(daten.saldoBilanz) == null
                ? <button type="button" className="link-knopf" onClick={() => setDaten({ ...daten, saldoBilanz: String(r.saldoAusListe) })}>{`aus Saldenliste übernehmen: ${betrag(r.saldoAusListe)}`}</button>
                : 'Passive Abgrenzung bzw. Kontokorrent'}
              ist={<Zahl wert={daten.saldoBilanz} onChange={feld('saldoBilanz')} />}
              soll={betrag(r.abzugrenzen)}
              d={r.diffBilanz}
            />
          </tbody>
        </table>
      </Karte>

      {bereich === 'ahv' ? (
        <Karte titel="Abstimmung gemeldete Lohnsumme">
          <div className="abst-zuordnung">
            <label>Lohnkonten <Text wert={daten.lohnKonten} onChange={feld('lohnKonten')} platzhalter="leer = alle 5000–5099" /></label>
          </div>
          <table className="tabelle abst-tabelle">
            <thead><tr><th>Position</th><th className="zahl">Betrag</th><th className="zahl">Vergleich</th><th className="zahl">Differenz</th></tr></thead>
            <tbody>
              {(r.lohnKonten ?? []).map((k) => <Zeile key={k.konto} label={`${k.konto} ${k.text}`} ist={betrag(k.betrag)} />)}
              <Zeile summe label="Lohnaufwand FiBu" ist={betrag(r.lohnFibu)} soll={betrag(r.brutto)} d={r.diffBrutto} hinweis="Vergleich: Bruttolohn LA 5000 laut Kumulativjournal" />
              {(daten.lohnKorrekturen ?? []).map((k, i) => (
                <tr key={i}>
                  <td><Text wert={k.text} onChange={(v) => korrektur(i, { text: v })} platzhalter="z.B. Privatanteil nicht deklariert, QST-Bezugsprovision" /></td>
                  <td className="zahl"><Zahl wert={k.betrag} onChange={(v) => korrektur(i, { betrag: v })} platzhalter="±" /></td>
                  <td colSpan={2}><button type="button" className="btn-klein btn-gefahr-text" aria-label="Korrektur entfernen" onClick={() => setDaten({ ...daten, lohnKorrekturen: daten.lohnKorrekturen.filter((_, j) => j !== i) })}>×</button></td>
                </tr>
              ))}
              <tr><td colSpan={4}><button type="button" className="btn-klein" onClick={() => setDaten({ ...daten, lohnKorrekturen: [...(daten.lohnKorrekturen ?? []), { text: '', betrag: '' }] })}>+ Korrektur (±)</button></td></tr>
              <Zeile summe label="= AHV-pflichtige Lohnsumme" ist={betrag(r.pflichtig)} />
              <Zeile label="AHV-Lohnsumme laut Deklaration" ist={<Zahl wert={daten.deklaration} onChange={feld('deklaration')} breit />} soll={betrag(r.pflichtig)} d={r.diffDeklaration} />
            </tbody>
          </table>
        </Karte>
      ) : (
        <Karte titel="Gemeldete Lohnsumme">
          <table className="tabelle abst-tabelle">
            <tbody>
              <Zeile label={`Lohnsumme laut Deklaration ${kurz}`} hinweis="Vergleich: Bruttolohn LA 5000 – Abweichung z.B. wegen Höchstlohn begründen" ist={<Zahl wert={daten.deklaration} onChange={feld('deklaration')} breit />} soll={betrag(r.brutto)} d={r.diffDeklaration} />
            </tbody>
          </table>
        </Karte>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------------------------
function leereDaten(bereich, mandant, vorjahr) {
  return bereich === 'mwst' ? mwstLeer(mandant, vorjahr) : svLeer(bereich, vorjahr);
}
function berechnen(bereich, daten, grundlagen) {
  return bereich === 'mwst' ? mwstBerechnen(daten) : svBerechnen(daten, grundlagen);
}

function listenStatus(eintrag, bereich, grundlagen) {
  if (!eintrag) return { klasse: 'abst-pille-offen', text: STATUS.offen };
  if (eintrag.status === 'abgestimmt') return { klasse: 'abst-pille-ok', text: STATUS.abgestimmt };
  if (eintrag.status === 'entfaellt') return { klasse: 'abst-pille-entfaellt', text: STATUS.entfaellt };
  const b = bewertungGesamt(berechnen(bereich, { ...leereDaten(bereich, null, null), ...eintrag.daten }, grundlagen));
  return b === 'differenz' ? { klasse: 'abst-pille-fehler', text: 'Differenz' } : { klasse: 'abst-pille-arbeit', text: STATUS.in_arbeit };
}

async function tabelleLesen(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return xlsxZeilen(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error(`${file.name}: altes Excel-Format – bitte als .xlsx oder CSV speichern.`);
  return csvZerlegen(await file.text());
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
  const [grundlagenListe, setGrundlagenListe] = useState([]);
  const [eintrag, setEintrag] = useState(null);
  const [daten, setDatenRoh] = useState(null);
  const [grundlagen, setGrundlagen] = useState(null);
  const [bemerkung, setBemerkung] = useState('');
  const [geaendert, setGeaendert] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [laedt, setLaedt] = useState(false);
  const [liest, setLiest] = useState(false);
  const [ziehen, setZiehen] = useState(false);
  const eingabeRef = useRef(null);

  const setDaten = (d) => { setDatenRoh(d); setGeaendert(true); };

  const listeLaden = useCallback(() => {
    Promise.all([
      api.abstimmungen.liste({ jahr, bereich }),
      istSv(bereich) ? api.abstimmungen.liste({ jahr, bereich: GRUNDLAGEN }).catch(() => []) : Promise.resolve([]),
    ]).then(([l, g]) => { setListe(l); setGrundlagenListe(g); setFehler(null); })
      .catch((err) => setFehler(/abstimmungen/.test(err.message)
        ? 'Tabelle fehlt – bitte zuerst supabase/abstimmungen-v7.sql in Supabase ausführen.' : err.message));
  }, [jahr, bereich]);
  useEffect(() => { listeLaden(); }, [listeLaden]);

  const aktive = useMemo(() => mandanten.filter((m) => m.aktiv && !m.potenziell), [mandanten]);
  const mandant = mandanten.find((m) => m.id === mandantId) ?? null;

  useEffect(() => {
    let abbruch = false;
    setDatenRoh(null);
    setEintrag(null);
    setGrundlagen(null);
    setGeaendert(false);
    setMeldung(null);
    if (!mandantId || !mandanten.length) return undefined;
    setLaedt(true);
    (async () => {
      try {
        const [gespeichert, vorjahr, g] = await Promise.all([
          api.abstimmungen.lesen({ mandantId, jahr, bereich }),
          api.abstimmungen.lesen({ mandantId, jahr: jahr - 1, bereich }),
          istSv(bereich) ? api.abstimmungen.lesen({ mandantId, jahr, bereich: GRUNDLAGEN }).catch(() => null) : null,
        ]);
        if (abbruch) return;
        const m = mandanten.find((x) => x.id === mandantId);
        const leer = leereDaten(bereich, m, vorjahr?.daten);
        setEintrag(gespeichert);
        // Erste Fassung (Saetze statt Lohnarten): nur Bemerkung/Unterlagen uebernehmen.
        const alt = gespeichert?.daten ?? {};
        const veraltet = istSv(bereich) && Array.isArray(alt.beitraege) && !alt.beitraege.some((b) => 'laAG' in b);
        setDatenRoh(gespeichert ? (veraltet ? { ...leer, unterlagen: alt.unterlagen } : { ...leer, ...alt }) : leer);
        setGrundlagen(g?.daten ?? null);
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

  const basis = relativerOrdner(mandant, grund);
  const ordner = abstimmungOrdner(basis, jahr, bereich);

  // Erfolgsrechnung / Kumulativjournal einlesen (Datei bleibt in OneDrive, hier nur die Totale).
  async function grundlagenEinlesen(files) {
    const dateien = [...files];
    if (!dateien.length) return;
    setFehler(null);
    setLiest(true);
    try {
      let neu = { ...(grundlagen ?? {}) };
      const gelesen = [];
      for (const f of dateien) {
        const r = grundlagenLesen(await tabelleLesen(f));
        if (!r) throw new Error(`${f.name}: weder Erfolgsrechnung (Nummer, Bezeichnung, Saldo) noch Kumulativjournal (LA, Total) erkannt.`);
        if (r.art === 'konten') neu = { ...neu, konten: r.konten, kontenDatei: f.name, kontenAm: heutigesDatumISO() };
        else neu = { ...neu, lohnarten: r.lohnarten, personen: r.personen, journalDatei: f.name, journalAm: heutigesDatumISO() };
        gelesen.push(r.art === 'konten' ? `Erfolgsrechnung (${r.konten.length} Konten)` : `Kumulativjournal (${r.lohnarten.length} Lohnarten)`);
        const ziel = abstimmungOrdner(basis, jahr, GRUNDLAGEN);
        if (unterstuetzt() && ziel) {
          try { await dateiAblegen(f, f.name, ziel); } catch { /* Ablage optional */ }
        }
      }
      await api.abstimmungen.speichern({ mandantId, jahr, bereich: GRUNDLAGEN, daten: neu, status: 'in_arbeit' });
      setGrundlagen(neu);
      setMeldung(`Eingelesen: ${gelesen.join(', ')}.`);
      listeLaden();
    } catch (err) {
      setFehler(/lohn_grundlagen|check constraint/i.test(err.message)
        ? 'Bitte zuerst supabase/abstimmungen-grundlagen-v7.sql in Supabase ausführen.' : err.message);
    } finally {
      setLiest(false);
    }
  }

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
  const grundlagenNach = new Map(grundlagenListe.map((e) => [e.mandant_id, e.daten]));
  const t = suche.trim().toLowerCase();
  const sichtbar = aktive.filter((m) => !t || `${m.name} ${m.kunden_nr ?? ''}`.toLowerCase().includes(t));
  const erledigt = aktive.filter((m) => ['abgestimmt', 'entfaellt'].includes(nachMandant.get(m.id)?.status)).length;
  const ergebnis = daten ? berechnen(bereich, daten, grundlagen) : null;
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
              const s = listenStatus(nachMandant.get(m.id), bereich, grundlagenNach.get(m.id));
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
                : (
                  <>
                    <GrundlagenKarte grundlagen={grundlagen} onDateien={grundlagenEinlesen} laedt={liest} />
                    <SvFormular bereich={bereich} daten={daten} setDaten={setDaten} grundlagen={grundlagen} />
                  </>
                )}

              <Karte titel="Bemerkung">
                <textarea className="abst-bemerkung" value={bemerkung} rows={3} placeholder="Begründung von Differenzen, Korrekturabrechnung, offene Fragen an den Kunden"
                  onChange={(e) => { setBemerkung(e.target.value); setGeaendert(true); }} />
              </Karte>

              <Karte titel="Unterlagen">
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
                  <div className="beleg-drop-titel">{bereich === 'mwst' ? 'MWST-Abrechnungen, Kontoauszüge hierher ziehen' : 'Abrechnungen der Versicherung hierher ziehen'}</div>
                  <div className="beleg-drop-text">{ordner ? `Ablage: ${ordner.join(' › ')}` : 'Beim Mandanten ist kein Ablage-Ordner hinterlegt.'}</div>
                  <input ref={eingabeRef} type="file" multiple hidden onChange={(e) => { unterlagenAblegen(e.target.files); e.target.value = ''; }} />
                </div>
              </Karte>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
