import { forwardRef } from 'react';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { chf } from '../lib/offerte.js';
import { BEREICHE, MWST_SPALTEN, bewertungGesamt } from '../lib/abstimmung.js';

const LOGO = `${import.meta.env.BASE_URL}logo-est-controlling.png`;
const b = (x) => (x == null ? '–' : chf(x).replace('CHF ', ''));

function Diff({ d }) {
  if (!d || d.ok == null) return <span className="ar-leer">–</span>;
  return <span className={d.ok ? 'ar-ok' : 'ar-fehler'}>{d.ok ? '✓ ' : ''}{b(d.betrag)}</span>;
}

function Tabelle({ kopf, zeilen, rechts = [] }) {
  return (
    <table className="ar-tabelle">
      <thead><tr>{kopf.map((k, i) => <th key={i} className={rechts.includes(i) ? 'od-zahl' : ''}>{k}</th>)}</tr></thead>
      <tbody>
        {zeilen.map((z, i) => (
          <tr key={i} className={z.summe ? 'ar-summe' : ''}>
            {z.zellen.map((c, j) => <td key={j} className={rechts.includes(j) ? 'od-zahl' : ''}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SvTeil({ bereich, daten, r, grundlagen }) {
  const kurz = BEREICHE[bereich].kurz;
  const dok = daten.dokumente ?? {};
  const g = grundlagen ?? {};
  const quellen = [
    [`Lohnmeldung ${kurz}`, dok.lohnmeldung ? `${dok.lohnmeldung.datei}${dok.lohnmeldung.versicherer ? ` (${dok.lohnmeldung.versicherer})` : ''}` : 'von Hand erfasst'],
    ['Erfolgsrechnung', g.kontenDatei ? `${g.kontenDatei}, eingelesen ${formatiereDatum(g.kontenAm)}` : '–'],
    ['Kumulativjournal', g.journalDatei ? `${g.journalDatei}, eingelesen ${formatiereDatum(g.journalAm)}` : '–'],
    [`Schlussrechnung ${kurz}`, dok.schlussrechnung ? `${dok.schlussrechnung.datei}${dok.schlussrechnung.versicherer ? ` (${dok.schlussrechnung.versicherer})` : ''}` : 'von Hand erfasst'],
  ];
  const deklarationen = (daten.deklarationen ?? []).filter((x) => x.betrag !== '' && x.betrag != null);
  const lohnZeilen = [];
  if (bereich === 'ahv') {
    (r.lohnKonten ?? []).forEach((k) => lohnZeilen.push({ zellen: [`${k.konto} ${k.text}`, b(k.betrag), '', ''] }));
    lohnZeilen.push({ summe: true, zellen: ['Lohnaufwand FiBu (Vergleich: Bruttolohn LA 5000)', b(r.lohnFibu), b(r.brutto), <Diff d={r.diffBrutto} />] });
    (daten.lohnKorrekturen ?? []).filter((k) => k.betrag !== '' && k.betrag != null).forEach((k) => lohnZeilen.push({ zellen: [k.text || 'Korrektur', b(Number(k.betrag)), '', ''] }));
    lohnZeilen.push({ summe: true, zellen: ['AHV-pflichtige Lohnsumme', b(r.pflichtig), '', ''] });
  }
  deklarationen.forEach((x) => lohnZeilen.push({ zellen: [`Gemeldet: ${x.text}`, b(Number(String(x.betrag).replace(/['\s]/g, ''))), '', ''] }));
  lohnZeilen.push({ summe: true, zellen: [`Gemeldete Lohnsumme total (Vergleich: ${bereich === 'ahv' ? 'AHV-pflichtige Lohnsumme' : 'Bruttolohn LA 5000'})`, b(r.deklaration), b(bereich === 'ahv' ? r.pflichtig : r.brutto), <Diff d={r.diffDeklaration} />] });

  return (
    <>
      <div className="od-zwischentitel">Grundlagen</div>
      <Tabelle kopf={['Unterlage', 'Datei']} zeilen={quellen.map((q) => ({ zellen: q }))} />

      <div className="od-zwischentitel">Gemeldete Lohnsumme</div>
      <Tabelle kopf={['Position', 'Betrag', 'Vergleich', 'Differenz']} rechts={[1, 2, 3]} zeilen={lohnZeilen} />

      <div className="od-zwischentitel">Beiträge laut Lohnjournal und Abrechnung</div>
      <Tabelle
        kopf={['Beitragsart', 'LA AN', 'LA AG', 'AN', 'AG', 'Lohnjournal', 'Abrechnung', 'Delta']}
        rechts={[3, 4, 5, 6, 7]}
        zeilen={[
          ...(daten.beitraege ?? []).map((x, i) => ({ zellen: [x.bez, x.laAN || '–', x.laAG || '–', b(r.zeilen[i]?.an), b(r.zeilen[i]?.ag), b(r.zeilen[i]?.lohn), r.zeilen[i]?.rechnung == null ? '–' : b(r.zeilen[i].rechnung), <Diff d={r.zeilen[i]?.delta} />] })),
          { summe: true, zellen: ['Total', '', '', b(r.an), b(r.ag), b(r.lohn), b(r.rechnung), <Diff d={r.diffRechnung} />] },
        ]}
      />

      <div className="od-zwischentitel">Abstimmung FiBu – Lohnbuchhaltung – Versicherung</div>
      <Tabelle
        kopf={['Prüfung', 'Ist', 'Soll', 'Differenz']}
        rechts={[1, 2, 3]}
        zeilen={[
          { zellen: [`Aufwand FiBu Konto ${daten.konten || '–'} = AG-Anteil Lohnjournal`, b(r.fibu), b(r.ag), <Diff d={r.diffFibuJournal} />] },
          { zellen: [`Abrechnung ${kurz} = AN + AG Lohnjournal`, b(r.rechnung), b(r.lohn), <Diff d={r.diffRechnung} />] },
          { zellen: [`Abrechnung ${kurz} = Aufwand FiBu + AN-Abzüge`, b(r.rechnung), b(r.fibu + r.an), <Diff d={r.diffRechnungFibu} />] },
        ]}
      />

      <div className="od-zwischentitel">Abgrenzung per 31.12.</div>
      <Tabelle
        kopf={['Position', 'Betrag', 'Vergleich', 'Differenz']}
        rechts={[1, 2, 3]}
        zeilen={[
          { zellen: ['Jahresbeitrag laut Abrechnung', b(r.rechnung), '', ''] },
          { zellen: ['./. bereits fakturiert (Akonto)', daten.akonto === '' || daten.akonto == null ? '–' : b(Number(daten.akonto)), '', ''] },
          { summe: true, zellen: ['= abzugrenzen (+) / Guthaben (−)', b(r.abzugrenzen), '', ''] },
          { zellen: [`Saldo Bilanzkonto ${daten.kontoBilanz || ''}`, daten.saldoBilanz === '' || daten.saldoBilanz == null ? '–' : b(Number(daten.saldoBilanz)), b(r.abzugrenzen), <Diff d={r.diffBilanz} />] },
        ]}
      />
    </>
  );
}

function MwstTeil({ daten, r }) {
  const seite = (s, titel) => (
    <>
      <div className="od-zwischentitel">{titel}</div>
      <Tabelle
        kopf={['Periode', ...MWST_SPALTEN.map((x) => x.label), 'Steuer', 'Zahllast', ...(s === 'buch' ? ['Delta'] : [])]}
        rechts={[1, 2, 3, 4, 5, 6, 7, 8]}
        zeilen={[
          ...r.perioden.map((p, i) => ({ zellen: [p.label, ...MWST_SPALTEN.map((x) => b(Number(daten.perioden[i]?.[s]?.[x.feld]) || 0)), b(p[s].steuer), b(p[s].zahllast), ...(s === 'buch' ? [<Diff d={p.delta} />] : [])] })),
          { summe: true, zellen: ['Total', ...MWST_SPALTEN.map((x) => b(r[s][x.feld])), b(r[s].steuer), b(r[s].zahllast), ...(s === 'buch' ? [<Diff d={r.diffZahllast} />] : [])] },
        ]}
      />
    </>
  );
  const sp = r.spalten;
  return (
    <>
      {seite('estv', 'Abrechnungen ESTV')}
      {seite('buch', 'Verbuchung Buchhaltung')}
      <div className="od-zwischentitel">Jahresabstimmung (Verbuchung − Abrechnung)</div>
      <Tabelle
        kopf={['Position', 'Differenz', 'Wirkung auf Zahllast']}
        rechts={[1, 2]}
        zeilen={[
          { zellen: ['Umsatz', b(sp.umsatz), ''] },
          { zellen: ['Umsatz steuerfrei', b(sp.steuerfrei), ''] },
          { zellen: ['Steuerbarer Umsatz × Satz', b(r.umsatzNetto), b(sp.steuer)] },
          { zellen: ['1170 Vorsteuer', b(sp.v1170), b(-sp.v1170)] },
          { zellen: ['1171 Vorsteuer', b(sp.v1171), b(-sp.v1171)] },
          { zellen: ['2203', b(sp.k2203), b(sp.k2203)] },
          { summe: true, zellen: ['Zahllast zu bezahlen (+) / Gutschrift (−)', <Diff d={r.diffZahllast} />, b(r.erklaert)] },
        ]}
      />
    </>
  );
}

// Rapport einer Abstimmung (A4) fuer das Jahresabschlussdossier: Druck und PDF.
const AbstimmungRapport = forwardRef(function AbstimmungRapport({ bereich, jahr, mandant, daten, ergebnis, grundlagen, eintrag, bemerkung, firma }, ref) {
  const info = BEREICHE[bereich];
  const absender = [firma?.firma, firma?.strasse, firma?.plzOrt].filter(Boolean).join('  •  ');
  const plzOrt = [mandant?.plz, mandant?.ort].filter(Boolean).join(' ');
  const gesamt = bewertungGesamt(ergebnis);
  const offen = ergebnis.differenzen.filter((d) => !d.ok).length;
  const status = eintrag?.status === 'abgestimmt' ? `abgestimmt am ${formatiereDatum(eintrag.abgestimmt_am)}`
    : eintrag?.status === 'entfaellt' ? 'entfällt' : 'in Arbeit';
  return (
    <div className="offerte-dokument abst-rapport" ref={ref}>
      <div className="od-kopf">
        <div className="od-absender">{absender}</div>
        <img className="od-logo" src={LOGO} alt={firma?.firma || 'Logo'} />
      </div>
      <div className="od-adressblock">
        <div className="od-empfaenger">
          <div className="od-empfaenger-firma">{mandant?.name}</div>
          {mandant?.strasse && <div>{mandant.strasse}</div>}
          {plzOrt && <div>{plzOrt}</div>}
        </div>
        <table className="od-info">
          <tbody>
            <tr><td>Geschäftsjahr</td><td>{jahr}</td></tr>
            {mandant?.kunden_nr && <tr><td>Kunden-Nr.</td><td>{mandant.kunden_nr}</td></tr>}
            <tr><td>Erstellt am</td><td>{formatiereDatum(heutigesDatumISO())}</td></tr>
            <tr><td>Status</td><td>{status}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="od-titel">{info.titel} {jahr}</div>
      <div className="ar-ergebnis">
        {gesamt === 'ok' && <span className="ar-ok">✓ Alle erfassten Positionen stimmen (Toleranz unter CHF 1).</span>}
        {gesamt === 'differenz' && <span className="ar-fehler">{offen} Differenz{offen === 1 ? '' : 'en'} – siehe Bemerkung.</span>}
        {gesamt === 'leer' && <span className="ar-leer">Noch keine Werte erfasst.</span>}
      </div>

      {bereich === 'mwst'
        ? <MwstTeil daten={daten} r={ergebnis} />
        : <SvTeil bereich={bereich} daten={daten} r={ergebnis} grundlagen={grundlagen} />}

      <div className="od-zwischentitel">Bemerkung</div>
      <div className="ar-bemerkung">{bemerkung?.trim() || '–'}</div>

      {(daten.unterlagen ?? []).length > 0 && (
        <>
          <div className="od-zwischentitel">Abgelegte Unterlagen</div>
          <ul className="ar-unterlagen">{daten.unterlagen.map((u, i) => <li key={i}>{u.name} ({formatiereDatum(u.datum)})</li>)}</ul>
        </>
      )}

      <div className="od-unterschriften">
        <div>Erstellt</div>
        <div>Geprüft</div>
      </div>
    </div>
  );
});

export default AbstimmungRapport;
