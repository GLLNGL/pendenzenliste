import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../api.js';
import RapportDokument from '../components/RapportDokument.jsx';
import FormularModal from '../components/FormularModal.jsx';
import MandantSuche from '../components/MandantSuche.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { useAuth } from '../AuthContext.jsx';
import { meldeZeitAenderung } from '../events.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';
import { zeitraum, artLabel, formatiereDauer } from '../lib/zeit.js';
import { rapportDaten, naechsteRapportNummer, stundenText } from '../lib/rapport.js';
import { textErsetzen, chf } from '../lib/offerte.js';
import { elementZuPdf, herunterladen } from '../lib/pdf.js';

const ZEITRAEUME = [
  { wert: 'vormonat', label: 'Letzter Monat' },
  { wert: 'monat', label: 'Dieser Monat' },
  { wert: 'vorwoche', label: 'Letzte Woche' },
  { wert: 'jahr', label: 'Dieses Jahr' },
  { wert: 'frei', label: 'Frei wählen' },
];

// Detailrapport erstellen (neu) oder einen abgeschlossenen ansehen, drucken, senden, stornieren.
export default function RapportEditor() {
  const { id } = useParams();
  const neu = id === 'neu';
  const [suchParameter] = useSearchParams();
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();
  const dokumentRef = useRef(null);

  const [kopf, setKopf] = useState(null);
  const [zeitraumArt, setZeitraumArt] = useState(suchParameter.get('von') ? 'frei' : 'vormonat');
  const [eintraege, setEintraege] = useState([]);
  const [ausgeschlossen, setAusgeschlossen] = useState(new Set());
  const [firma, setFirma] = useState({});
  const [texte, setTexte] = useState({});
  const [fehler, setFehler] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [beschaeftigt, setBeschaeftigt] = useState(null);
  const [mailOffen, setMailOffen] = useState(false);

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      try {
        const [f, t, alle] = await Promise.all([api.buero.lesen('firma'), api.buero.lesen('rapport'), neu ? api.rapporte.liste() : Promise.resolve([])]);
        if (abgebrochen) return;
        setFirma(f); setTexte(t);
        if (neu) {
          const heute = heutigesDatumISO();
          const vor = zeitraum('vormonat', heute);
          setKopf({
            nummer: naechsteRapportNummer(alle, Number(heute.slice(0, 4))), mandant_id: suchParameter.get('mandant') || '',
            von: suchParameter.get('von') || vor.von, bis: suchParameter.get('bis') || vor.bis, datum: heute,
            bearbeiter_id: benutzer?.id ?? '', runden_minuten: 5, mwst_pflichtig: true, mwst_satz: 8.1, rechnung_nr: '', bemerkung: '',
          });
        } else {
          const r = await api.rapporte.holen(Number(id));
          if (abgebrochen) return;
          setKopf({ ...r, bearbeiter_id: r.bearbeiter_id ?? '', rechnung_nr: r.rechnung_nr ?? '', bemerkung: r.bemerkung ?? '' });
          setEintraege(await api.rapporte.eintraege({ rapportId: r.id }));
        }
      } catch (e) {
        if (!abgebrochen) setFehler(e.message);
      }
    })();
    return () => { abgebrochen = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Neuer Rapport: offene Zeit des Mandanten im Zeitraum laden.
  useEffect(() => {
    if (!neu || !kopf?.mandant_id || !kopf.von || !kopf.bis) { if (neu) setEintraege([]); return; }
    api.rapporte.eintraege({ mandantId: kopf.mandant_id, von: kopf.von, bis: kopf.bis })
      .then((d) => { setEintraege(d); setAusgeschlossen(new Set()); })
      .catch((e) => setFehler(e.message));
  }, [neu, kopf?.mandant_id, kopf?.von, kopf?.bis]);

  if (fehler && !kopf) {
    return (
      <div className="fehleranzeige">
        Fehler beim Laden: {fehler}
        {/relation|does not exist|schema cache/i.test(fehler) && ' – ist die Schema-Erweiterung (supabase/schema.sql) schon ausgeführt?'}
      </div>
    );
  }
  if (!kopf) return <div className="leer-hinweis">Lade…</div>;

  const mandant = mandanten.find((m) => String(m.id) === String(kopf.mandant_id));
  const bearbeiter = mitarbeitende.find((m) => String(m.id) === String(kopf.bearbeiter_id))?.name;
  const enthalten = eintraege.filter((e) => !ausgeschlossen.has(e.id));
  const daten = rapportDaten(enthalten, { runden: Number(kopf.runden_minuten), mwstPflichtig: kopf.mwst_pflichtig, mwstSatz: kopf.mwst_satz });
  const dateiname = `Detailrapport ${kopf.nummer}${mandant ? ` ${mandant.name}` : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  const zeitraumText = `${formatiereDatum(kopf.von)} – ${formatiereDatum(kopf.bis)}`;

  function aendern(feld, wert) { setKopf((k) => ({ ...k, [feld]: wert })); }
  function zeitraumWaehlen(art) {
    setZeitraumArt(art);
    const z = zeitraum(art, heutigesDatumISO());
    if (z) setKopf((k) => ({ ...k, ...z }));
  }
  function umschalten(eintragId) {
    setAusgeschlossen((alt) => { const n = new Set(alt); if (n.has(eintragId)) n.delete(eintragId); else n.add(eintragId); return n; });
  }

  async function aktion(name, fn) {
    setBeschaeftigt(name); setFehler(null); setMeldung(null);
    try { await fn(); } catch (e) { setFehler(e.message); } finally { setBeschaeftigt(null); }
  }

  const pdfLaden = () => aktion('pdf', async () => { const { blob } = await elementZuPdf(dokumentRef.current); herunterladen(blob, dateiname); });

  const abschliessen = () => aktion('abschliessen', async () => {
    if (!window.confirm(`Rapport ${kopf.nummer} abschliessen? ${daten.ids.length} Zeiteinträge werden als verrechnet markiert und lassen sich danach nur nach einem Storno ändern.`)) return;
    const r = await api.rapporte.abschliessen(kopf, daten.ids, daten.summen);
    meldeZeitAenderung();
    navigate(`/rapporte/${r.id}`, { replace: true });
  });

  const stornieren = () => aktion('storno', async () => {
    if (!window.confirm(`Rapport ${kopf.nummer} stornieren? Die Zeit wird wieder als «nicht verrechnet» geführt.`)) return;
    await api.rapporte.stornieren(kopf.id);
    meldeZeitAenderung();
    navigate('/rapporte');
  });

  const rechnungSpeichern = () => aktion('rechnung', async () => {
    await api.rapporte.aktualisieren(kopf.id, { rechnung_nr: kopf.rechnung_nr, bemerkung: kopf.bemerkung });
    setMeldung('Gespeichert.');
  });

  const platzhalter = {
    nummer: kopf.nummer, mandant: mandant?.name || '', ansprechperson: mandant?.ansprechperson || '',
    zeitraum: zeitraumText, bearbeiter: bearbeiter || '', firma: firma.firma || '',
  };
  const adressen = [mandant?.email, mandant?.geschaeftsfuehrung_email].filter(Boolean);

  return (
    <div className="offert-editor">
      <div className="cockpit-kopfzeile offert-kopfzeile">
        <button type="button" className="btn-klein" onClick={() => navigate('/rapporte')}>← Rapporte</button>
        <h1 className="seiten-titel">Detailrapport {kopf.nummer}</h1>
        <span className={`offert-status ${neu ? '' : 'offert-status-angenommen'}`}>{neu ? 'Entwurf' : 'Verrechnet'}</span>
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn" onClick={() => window.print()}>Drucken</button>
          <button type="button" className="btn" onClick={pdfLaden} disabled={!!beschaeftigt}>{beschaeftigt === 'pdf' ? 'PDF…' : 'PDF'}</button>
          {neu ? (
            <button type="button" className="btn btn-primary" onClick={abschliessen} disabled={!mandant || daten.ids.length === 0 || !!beschaeftigt}>
              Abschliessen &amp; verrechnen
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setMailOffen(true)} disabled={!!beschaeftigt}>Per E-Mail senden</button>
              <button type="button" className="btn btn-gefahr" onClick={stornieren} disabled={!!beschaeftigt}>Stornieren</button>
            </>
          )}
        </span>
      </div>
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
      {meldung && <div className="hinweis-erfolg">{meldung}</div>}
      {kopf.versendet_am && <div className="offert-hinweis">Versendet am {formatiereDatum(kopf.versendet_am.slice(0, 10))} an {kopf.versendet_an}.</div>}

      <div className="offert-arbeitsbereich">
        <div className="offert-formular">
          <div className="karte offert-karte">
            <div className="karte-kopf">Mandant &amp; Zeitraum</div>
            <div className="modal-koerper">
              <div className="feld">
                <label htmlFor="ra-mandant">Mandant *</label>
                {neu ? (
                  <MandantSuche id="ra-mandant" mandanten={mandanten} wert={kopf.mandant_id} onWahl={(w) => aendern('mandant_id', w)} />
                ) : <div className="rapport-fest">{mandant?.name}</div>}
              </div>
              {neu ? (
                <div className="feld-reihe">
                  <div className="feld">
                    <label htmlFor="ra-zeitraum">Zeitraum</label>
                    <select id="ra-zeitraum" value={zeitraumArt} onChange={(e) => zeitraumWaehlen(e.target.value)}>
                      {ZEITRAEUME.map((z) => <option key={z.wert} value={z.wert}>{z.label}</option>)}
                    </select>
                  </div>
                  <div className="feld">
                    <label htmlFor="ra-runden">Rundung je Eintrag</label>
                    <select id="ra-runden" value={kopf.runden_minuten} onChange={(e) => aendern('runden_minuten', Number(e.target.value))}>
                      {[1, 5, 6, 10, 15].map((m) => <option key={m} value={m}>{m === 1 ? 'keine (Minuten)' : `${m} Minuten`}</option>)}
                    </select>
                  </div>
                </div>
              ) : <div className="rapport-fest">{zeitraumText} · Rundung {kopf.runden_minuten === 1 ? 'keine' : `${kopf.runden_minuten} Min.`}</div>}
              {neu && zeitraumArt === 'frei' && (
                <div className="feld-reihe">
                  <div className="feld"><label htmlFor="ra-von">Von</label><input id="ra-von" type="date" value={kopf.von} onChange={(e) => aendern('von', e.target.value)} /></div>
                  <div className="feld"><label htmlFor="ra-bis">Bis</label><input id="ra-bis" type="date" value={kopf.bis} onChange={(e) => aendern('bis', e.target.value)} /></div>
                </div>
              )}
              {neu && <p className="feld-hinweis">{zeitraumText} – nur Zeit, die noch in keinem Rapport verrechnet ist.</p>}
              <div className="feld-reihe">
                <div className="feld"><label htmlFor="ra-rechnung">Rechnung-Nr. (optional)</label><input id="ra-rechnung" value={kopf.rechnung_nr} onChange={(e) => aendern('rechnung_nr', e.target.value)} /></div>
                <div className="feld">
                  <label htmlFor="ra-mwst">MWST auf Extra</label>
                  <select id="ra-mwst" value={kopf.mwst_pflichtig ? '1' : '0'} onChange={(e) => aendern('mwst_pflichtig', e.target.value === '1')} disabled={!neu}>
                    <option value="1">{kopf.mwst_satz} %</option>
                    <option value="0">keine</option>
                  </select>
                </div>
              </div>
              <div className="feld">
                <label htmlFor="ra-bemerkung">Bemerkung auf dem Rapport</label>
                <textarea id="ra-bemerkung" value={kopf.bemerkung} onChange={(e) => aendern('bemerkung', e.target.value)} />
              </div>
              {!neu && <button type="button" className="btn-klein" onClick={rechnungSpeichern} disabled={!!beschaeftigt}>Rechnung-Nr. &amp; Bemerkung speichern</button>}
            </div>
          </div>

          <div className="karte offert-karte">
            <div className="karte-kopf">
              Zeiteinträge ({daten.ids.length}{ausgeschlossen.size ? ` von ${eintraege.length}` : ''})
              {neu && <span className="pauschalen-zusatz"> · Häkchen entfernen, um einen Eintrag nicht in diesen Rapport zu nehmen. Korrigieren im Zeitjournal.</span>}
            </div>
            <div className="rapport-eintraege">
              <table className="tabelle">
                <tbody>
                  {eintraege.map((e) => (
                    <tr key={e.id} className={ausgeschlossen.has(e.id) ? 'ausgeschlossen' : ''}>
                      {neu && <td><input type="checkbox" checked={!ausgeschlossen.has(e.id)} onChange={() => umschalten(e.id)} aria-label="Im Rapport" /></td>}
                      <td>{formatiereDatum(e.datum)}</td>
                      <td>{e.beschreibung || e.pendenzen?.titel || '–'}</td>
                      <td><span className={`zeit-art zeit-art-${e.art}`}>{artLabel(e.art)}</span></td>
                      <td className="zahl">{formatiereDauer(e.minuten)}</td>
                    </tr>
                  ))}
                  {eintraege.length === 0 && <tr><td className="leer-hinweis">{mandant ? 'Keine offene Zeit in diesem Zeitraum.' : 'Zuerst einen Mandanten wählen.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="karte offert-karte">
            <div className="karte-kopf">Summen</div>
            <table className="tabelle offert-kalkulation">
              <tbody>
                <tr><td>In der Pauschale</td><td className="zahl">{stundenText(daten.summen.minutenPauschal)}</td></tr>
                <tr><td>Zusätzliche Arbeiten</td><td className="zahl">{stundenText(daten.summen.minutenExtra)} · {chf(daten.summen.betragExtra)}</td></tr>
                <tr><td><strong>Zu verrechnen inkl. MWST</strong></td><td className="zahl"><strong>{chf(daten.summen.total)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="offert-vorschau">
          <div className="rapport-vorschau-skala druck-ziel">
            <RapportDokument ref={dokumentRef} kopf={kopf} daten={daten} mandant={mandant} bearbeiter={bearbeiter} firma={firma} texte={texte} />
          </div>
        </div>
      </div>

      {mailOffen && (
        <FormularModal
          titel={`Detailrapport ${kopf.nummer} per E-Mail senden`}
          breit
          speichernText="Senden"
          startwerte={{
            an: adressen[0] || '',
            betreff: textErsetzen(texte.mailBetreff || 'Detailrapport {nummer} – {mandant}', platzhalter),
            text: textErsetzen(texte.mailText || '', platzhalter),
          }}
          felder={[
            { name: 'an', label: 'An', typ: 'text', pflicht: true, vorschlaege: adressen },
            { name: 'betreff', label: 'Betreff', typ: 'text', pflicht: true },
            { name: 'text', label: 'Text', typ: 'textarea', pflicht: true },
          ]}
          vorschau={() => `Anhang: ${dateiname}`}
          onSpeichern={async (f) => {
            const { base64 } = await elementZuPdf(dokumentRef.current);
            await api.rapporte.versenden(kopf, { an: f.an, betreff: f.betreff, text: f.text, pdfBase64: base64, dateiname });
            setKopf((k) => ({ ...k, versendet_am: new Date().toISOString(), versendet_an: f.an }));
            setMailOffen(false);
            setMeldung(`Rapport an ${f.an} gesendet.`);
          }}
          onSchliessen={() => setMailOffen(false)}
        />
      )}
    </div>
  );
}
