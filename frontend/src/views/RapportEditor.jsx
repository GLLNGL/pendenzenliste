import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PendenzModal from '../components/PendenzModal.jsx';
import ZeitModal from '../components/ZeitModal.jsx';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../api.js';
import RapportDokument from '../components/RapportDokument.jsx';
import RechnungDokument from '../components/RechnungDokument.jsx';
import FormularModal from '../components/FormularModal.jsx';
import MandantSuche from '../components/MandantSuche.jsx';
import { useAblageGrund, useMandanten, useMitarbeitende } from '../hooks.js';
import { useAuth } from '../AuthContext.jsx';
import { meldeZeitAenderung } from '../events.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';
import { zeitraum, artLabel, formatiereDauer } from '../lib/zeit.js';
import { rapportDaten, nachPendenz, naechsteRapportNummer, stundenText } from '../lib/rapport.js';
import { textErsetzen, chf } from '../lib/offerte.js';
import { elementZuPdf, herunterladen } from '../lib/pdf.js';
import { qrReferenz, scorReferenz, naechsteRechnungsNr, plusTage, adresseVon, zahlteil, rechnungsPositionen } from '../lib/qrrechnung.js';
import { qrBildUrl } from '../lib/qrbild.js';
import { istQrIban } from '../lib/pain001.js';
import { buchhaltungsMandant, belegOrdner, belegDateiname, RECHNUNG_VORLAGE, rechnungPlatzhalter } from '../lib/belege.js';
import { unterstuetzt, dateiAblegen, dateiLesen } from '../lib/ablageOrdner.js';

const ZEITRAEUME = [
  { wert: 'vormonat', label: 'Letzter Monat' },
  { wert: 'monat', label: 'Dieser Monat' },
  { wert: 'vorwoche', label: 'Letzte Woche' },
  { wert: 'jahr', label: 'Dieses Jahr' },
  { wert: 'frei', label: 'Frei wählen' },
];

// Detailrapport erstellen (neu) oder einen abgeschlossenen ansehen, drucken, senden, stornieren.
async function blobBase64(blob) {
  const puffer = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < puffer.length; i += 0x8000) bin += String.fromCharCode(...puffer.subarray(i, i + 0x8000));
  return btoa(bin);
}

function FragmentGruppe({ children }) {
  return <>{children}</>;
}

function rechnungBelegVorab(kopf, debitoren) {
  return kopf.rechnung_nr && debitoren.some((d) => String(d.rechnungsnummer) === String(kopf.rechnung_nr));
}

export default function RapportEditor() {
  const { id } = useParams();
  const neu = id === 'neu';
  const [suchParameter] = useSearchParams();
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();
  const dokumentRef = useRef(null);
  const rechnungRef = useRef(null);
  const grund = useAblageGrund();
  const [debitoren, setDebitoren] = useState([]);
  const [rechnungEinst, setRechnungEinst] = useState({});
  const [buchEinst, setBuchEinst] = useState({});
  const [rechnungKopf, setRechnungKopf] = useState(null); // { nummer, datum, fristTage }
  const [vorschau, setVorschau] = useState('rapport');
  const [qrSrc, setQrSrc] = useState(null);

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
  const [pendenzInfo, setPendenzInfo] = useState([]);
  const [offenePendenz, setOffenePendenz] = useState(null);
  const [zeitOffen, setZeitOffen] = useState(null);
  const [aufgeklappt, setAufgeklappt] = useState(new Set());
  const [ladeZaehler, setLadeZaehler] = useState(0);
  const neuLaden = useCallback(() => setLadeZaehler((z) => z + 1), []);

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      try {
        const [f, t, alle] = await Promise.all([api.buero.lesen('firma'), api.buero.lesen('rapport'), neu ? api.rapporte.liste() : Promise.resolve([])]);
        if (abgebrochen) return;
        setFirma(f); setTexte(t);
        const [d, re, bu] = await Promise.all([api.belege.liste('debitor').catch(() => []), api.buero.lesen('rechnung').catch(() => ({})), api.buero.lesen('buchhaltung').catch(() => ({}))]);
        if (abgebrochen) return;
        setDebitoren(d); setRechnungEinst({ ...RECHNUNG_VORLAGE, ...re }); setBuchEinst(bu);
        const heute2 = heutigesDatumISO();
        setRechnungKopf({ nummer: naechsteRechnungsNr(d, Number(heute2.slice(0, 4))), datum: heute2, fristTage: Number(re.fristTage) || 10 });
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

  // Neuer Rapport: offene Zeit des Mandanten im Zeitraum laden (bzw. nach einer Korrektur neu).
  useEffect(() => {
    if (!neu) {
      if (ladeZaehler && kopf?.id) api.rapporte.eintraege({ rapportId: kopf.id }).then(setEintraege).catch((e) => setFehler(e.message));
      return;
    }
    if (!kopf?.mandant_id || !kopf.von || !kopf.bis) { setEintraege([]); return; }
    api.rapporte.eintraege({ mandantId: kopf.mandant_id, von: kopf.von, bis: kopf.bis })
      .then((d) => { setEintraege(d); if (!ladeZaehler) setAusgeschlossen(new Set()); })
      .catch((e) => setFehler(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neu, kopf?.mandant_id, kopf?.von, kopf?.bis, ladeZaehler]);

  // Pendenzen (mit Projekt) zu den Eintraegen nachladen.
  useEffect(() => {
    const ids = [...new Set(eintraege.map((e) => e.pendenz_id).filter(Boolean))];
    api.pendenzen.mehrere(ids).then(setPendenzInfo).catch(() => setPendenzInfo([]));
  }, [eintraege]);

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
  const gruppen = nachPendenz(eintraege, pendenzInfo, { runden: Number(kopf.runden_minuten) });
  const schritt = neu ? 1 : rechnungBelegVorab(kopf, debitoren) ? 3 : 2;
  const dateiname = `Detailrapport ${kopf.nummer}${mandant ? ` ${mandant.name}` : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  const zeitraumText = `${formatiereDatum(kopf.von)} – ${formatiereDatum(kopf.bis)}`;
  const rechnungBeleg = !neu && kopf.rechnung_nr ? debitoren.find((d) => String(d.rechnungsnummer) === String(kopf.rechnung_nr)) : null;
  const rk = rechnungBeleg
    ? { nummer: rechnungBeleg.rechnungsnummer, datum: rechnungBeleg.rechnungsdatum, faellig: rechnungBeleg.faelligkeit, fristTage: rechnungKopf?.fristTage ?? 10 }
    : rechnungKopf ? { ...rechnungKopf, faellig: plusTage(rechnungKopf.datum, rechnungKopf.fristTage) } : null;
  const rechnungIban = rechnungEinst.qrIban || '';
  const kreditor = adresseVon(firma.firma, firma.strasse, firma.plzOrt);
  const debitorAdr = mandant ? adresseVon(mandant.name, mandant.strasse, [mandant.plz, mandant.ort].filter(Boolean).join(' ')) : null;
  const referenzRoh = rk ? (istQrIban(rechnungIban) ? qrReferenz(mandant?.kunden_nr, rk.nummer) : scorReferenz(rk.nummer)) : '';
  const zt = rk ? zahlteil({
    iban: rechnungIban, kreditor, debitor: debitorAdr, betrag: daten.summen.total,
    referenz: rechnungBeleg?.zahlungsreferenz || referenzRoh, mitteilung: `Rechnung ${rk.nummer}`,
  }) : null;
  const positionen = rechnungsPositionen(daten, kopf.nummer, zeitraumText);
  const rechnungDatei = rk && mandant ? belegDateiname({ rechnungsdatum: rk.datum, partner: mandant.name, rechnungsnummer: rk.nummer }, 'Rechnung.pdf') : 'Rechnung.pdf';

  function aendern(feld, wert) { setKopf((k) => ({ ...k, [feld]: wert })); }
  const qrText = zt && !zt.fehler.length ? zt.text : null;
  if (qrText && qrSrc?.text !== qrText) {
    setQrSrc({ text: qrText, url: null });
    qrBildUrl(qrText).then((url) => setQrSrc({ text: qrText, url })).catch(() => setQrSrc({ text: qrText, url: null, fehler: true }));
  }

  const rechnungErstellen = () => aktion('rechnung-neu', async () => {
    if (zt.fehler.length) throw new Error(zt.fehler.join(' · '));
    if (!qrSrc?.url) throw new Error('QR-Code konnte nicht erzeugt werden.');
    setVorschau('rechnung');
    await new Promise((r) => setTimeout(r, 50));
    const { blob } = await elementZuPdf(rechnungRef.current);
    let ablagePfad = null;
    const ordner = belegOrdner({ art: 'debitor', datum: rk.datum }, buchEinst, buchhaltungsMandant(buchEinst, mandanten), grund);
    if (unterstuetzt() && ordner) ablagePfad = await dateiAblegen(blob, rechnungDatei, ordner);
    else herunterladen(blob, rechnungDatei);
    const beleg = await api.belege.speichern(null, {
      art: 'debitor', partner: mandant.name, rechnungsnummer: rk.nummer, rechnungsdatum: rk.datum, faelligkeit: rk.faellig,
      betrag: daten.summen.total, waehrung: 'CHF', zahlungsreferenz: zt.referenz, notiz: `Detailrapport ${kopf.nummer}`,
      ...(ablagePfad ? { dateiname: rechnungDatei, ablagePfad } : {}),
    });
    await api.rapporte.aktualisieren(kopf.id, { rechnung_nr: rk.nummer });
    setKopf((k) => ({ ...k, rechnung_nr: rk.nummer }));
    setDebitoren((alt) => [...alt, beleg]);
    setMeldung(`Rechnung ${rk.nummer} erstellt${ablagePfad ? ` und abgelegt: ${ablagePfad}` : ' (heruntergeladen)'} – steht unter Debitoren.`);
  });

  const ibanSpeichern = (wert) => aktion('iban', async () => {
    const neuEinst = { ...rechnungEinst, qrIban: String(wert).replace(/\s+/g, '').toUpperCase() };
    await api.buero.speichern('rechnung', neuEinst);
    setRechnungEinst(neuEinst);
  });
  function zeitraumWaehlen(art) {
    setZeitraumArt(art);
    const z = zeitraum(art, heutigesDatumISO());
    if (z) setKopf((k) => ({ ...k, ...z }));
  }
  const gruppeArtSetzen = (g, art) => aktion(`art-${g.schluessel}`, async () => {
    for (const e of g.eintraege) if (e.art !== art && !e.rapport_id) await api.zeit.artSetzen(e, art);
    if (g.pendenzId) await api.pendenzen.verrechnungSetzen(g.pendenzId, art);
    meldeZeitAenderung();
    neuLaden();
  });
  function gruppeUmschalten(g, drin) {
    setAusgeschlossen((alt) => { const n = new Set(alt); for (const e of g.eintraege) { if (drin) n.delete(e.id); else n.add(e.id); } return n; });
  }
  async function pendenzOeffnen(pendenzId) {
    try { setOffenePendenz(await api.pendenzen.holen(pendenzId)); } catch (e) { setFehler(e.message); }
  }
  function aufklappen(schluessel) {
    setAufgeklappt((alt) => { const n = new Set(alt); if (n.has(schluessel)) n.delete(schluessel); else n.add(schluessel); return n; });
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
              ② Rapport abschliessen
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setMailOffen(true)} disabled={!!beschaeftigt}>{rechnungBeleg ? 'Rechnung + Rapport senden' : 'Per E-Mail senden'}</button>
              <button type="button" className="btn btn-gefahr" onClick={stornieren} disabled={!!beschaeftigt}>Stornieren</button>
            </>
          )}
        </span>
      </div>
      <ol className="ra-schritte">
        <li className={neu ? 'aktiv' : 'fertig'}><span>1</span>Arbeiten prüfen<small>Zeit &amp; Verrechnungsart je Pendenz</small></li>
        <li className={neu ? '' : 'fertig'}><span>2</span>Rapport abschliessen<small>Zeit gilt als verrechnet</small></li>
        <li className={neu ? '' : schritt === 3 || daten.summen.betragExtra === 0 ? 'fertig' : 'aktiv'}><span>3</span>Rechnung &amp; Versand<small>{daten.summen.betragExtra > 0 || neu ? 'QR-Rechnung + Rapport' : 'nur Rapport (keine Extra-Zeit)'}</small></li>
      </ol>
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
      {meldung && <div className="hinweis-erfolg">{meldung}</div>}
      {kopf.versendet_am && <div className="offert-hinweis">Versendet am {formatiereDatum(kopf.versendet_am.slice(0, 10))} an {kopf.versendet_an}.</div>}

          <div className="karte offert-karte ra-arbeiten-karte">
            <div className="karte-kopf">
              {neu ? '① ' : ''}Arbeiten ({gruppen.length} {gruppen.length === 1 ? 'Pendenz' : 'Pendenzen'})
              <span className="pauschalen-zusatz"> · Titel öffnet die Pendenz · ▸ zeigt die einzelnen Zeiten{neu ? ' · Häkchen = in diesem Rapport' : ''}</span>
            </div>
            <table className="tabelle ra-arbeiten">
              <tbody>
                {gruppen.map((g) => {
                  const drin = g.eintraege.some((e) => !ausgeschlossen.has(e.id));
                  const offen = aufgeklappt.has(g.schluessel);
                  return (
                    <FragmentGruppe key={g.schluessel}>
                      <tr className={`ra-gruppe ${drin ? '' : 'ausgeschlossen'}`}>
                        {neu && <td className="ra-check"><input type="checkbox" checked={drin} onChange={(e) => gruppeUmschalten(g, e.target.checked)} aria-label="Im Rapport" /></td>}
                        <td className="ra-titel">
                          <button type="button" className="ra-pfeil" onClick={() => aufklappen(g.schluessel)} aria-label="Zeiten anzeigen">{offen ? '▾' : '▸'}</button>
                          {g.pendenzId
                            ? <button type="button" className="link-knopf ra-pendenz" onClick={() => pendenzOeffnen(g.pendenzId)} title="Pendenz öffnen">{g.titel}</button>
                            : <span>{g.titel}</span>}
                          <span className="text-gedaempft"> · {g.eintraege.length} {g.eintraege.length === 1 ? 'Eintrag' : 'Einträge'}</span>
                        </td>
                        <td className="zahl ra-zeit">{stundenText(g.minuten)}</td>
                        <td className="ra-art">
                          {neu ? (
                            <span className="ra-umschalter" role="group" aria-label="Verrechnung">
                              {['pauschal', 'extra'].map((a) => (
                                <button key={a} type="button" className={g.art === a ? 'aktiv' : ''} disabled={!!beschaeftigt} onClick={() => g.art !== a && gruppeArtSetzen(g, a)}>
                                  {a === 'pauschal' ? 'Pauschal' : 'Extra'}
                                </button>
                              ))}
                            </span>
                          ) : <span className={`zeit-art zeit-art-${g.art === 'gemischt' ? 'pauschal' : g.art}`}>{g.art === 'gemischt' ? 'gemischt' : artLabel(g.art)}</span>}
                          {neu && g.art === 'gemischt' && <div className="text-gedaempft ra-gemischt">gemischt – Klick vereinheitlicht</div>}
                        </td>
                        <td className="zahl ra-betrag">{g.betrag ? chf(g.betrag).replace('CHF ', '') : ''}</td>
                      </tr>
                      {offen && g.eintraege.map((e) => (
                        <tr key={e.id} className={`ra-eintrag ${ausgeschlossen.has(e.id) ? 'ausgeschlossen' : ''}`}>
                          {neu && <td className="ra-check"><input type="checkbox" checked={!ausgeschlossen.has(e.id)} onChange={() => umschalten(e.id)} aria-label="Eintrag im Rapport" /></td>}
                          <td className="ra-titel">
                            <button type="button" className="link-knopf ra-eintrag-knopf" onClick={() => setZeitOffen(e)} disabled={!neu && !!e.rapport_id} title={neu ? 'Zeit korrigieren' : undefined}>
                              {formatiereDatum(e.datum)} · {e.schrittTitel || e.beschreibung || e.pendenzen?.titel || '–'}{e.mitarbeitende?.name ? ` · ${e.mitarbeitende.name}` : ''}
                            </button>
                          </td>
                          <td className="zahl">{formatiereDauer(e.minuten)}</td>
                          <td><span className={`zeit-art zeit-art-${e.art}`}>{artLabel(e.art)}</span></td>
                          <td className="zahl">{e.art === 'extra' ? chf((e.minuten / 60) * Number(e.stundenansatz_chf ?? 0)).replace('CHF ', '') : ''}</td>
                        </tr>
                      ))}
                    </FragmentGruppe>
                  );
                })}
                {gruppen.length === 0 && <tr><td className="leer-hinweis">{mandant ? 'Keine offene Zeit in diesem Zeitraum.' : 'Zuerst einen Mandanten wählen.'}</td></tr>}
              </tbody>
            </table>
            {neu && gruppen.length > 0 && (
              <div className="ra-weiter">
                <span>{stundenText(daten.summen.minutenPauschal)} Pauschal · {stundenText(daten.summen.minutenExtra)} Extra = <strong>{chf(daten.summen.total)}</strong> zu verrechnen</span>
                <button type="button" className="btn btn-primary" onClick={abschliessen} disabled={!mandant || daten.ids.length === 0 || !!beschaeftigt}>② Rapport abschliessen →</button>
              </div>
            )}
          </div>

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
              {!neu && <button type="button" className="btn-klein" onClick={rechnungSpeichern} disabled={!!beschaeftigt}>Bemerkung speichern</button>}
            </div>
          </div>

          {!neu && daten.summen.betragExtra > 0 && rk && (
            <div className="karte offert-karte">
              <div className="karte-kopf">③ Rechnung mit QR-Einzahlungsschein</div>
              <div className="modal-koerper">
                {rechnungBeleg ? (
                  <>
                    <div className="hinweis-erfolg">Rechnung {rechnungBeleg.rechnungsnummer} vom {formatiereDatum(rechnungBeleg.rechnungsdatum)} · {chf(rechnungBeleg.betrag)} · fällig {formatiereDatum(rechnungBeleg.faelligkeit)}{rechnungBeleg.bezahlt_am ? ` · bezahlt am ${formatiereDatum(rechnungBeleg.bezahlt_am)}` : ''}{rechnungBeleg.versendet_am ? ` · versendet ${formatiereDatum(rechnungBeleg.versendet_am.slice(0, 10))}` : ''}</div>
                    <p className="feld-hinweis">Steht unter Buchhaltung › Debitoren; der Zahlungseingang wird beim Kontoauszug über die Referenz erkannt.</p>
                  </>
                ) : (
                  <>
                    <div className="feld-reihe projekt-reihe-3">
                      <div className="feld"><label htmlFor="re-nr">Rechnung-Nr.</label><input id="re-nr" value={rk.nummer} onChange={(e) => setRechnungKopf((r) => ({ ...r, nummer: e.target.value }))} /></div>
                      <div className="feld"><label htmlFor="re-datum">Datum</label><input id="re-datum" type="date" value={rk.datum} onChange={(e) => setRechnungKopf((r) => ({ ...r, datum: e.target.value }))} /></div>
                      <div className="feld"><label htmlFor="re-frist">Zahlbar innert</label><select id="re-frist" value={rk.fristTage} onChange={(e) => setRechnungKopf((r) => ({ ...r, fristTage: Number(e.target.value) }))}>{[10, 20, 30].map((t) => <option key={t} value={t}>{t} Tagen</option>)}</select></div>
                    </div>
                    <div className="feld">
                      <label htmlFor="re-iban">QR-IBAN (bzw. IBAN) für Rechnungen</label>
                      <input id="re-iban" defaultValue={rechnungIban} placeholder="CH44 3000 0…" onBlur={(e) => { if (e.target.value.replace(/\s+/g, '').toUpperCase() !== rechnungIban) ibanSpeichern(e.target.value); }} />
                      <p className="feld-hinweis">{istQrIban(rechnungIban) ? 'QR-IBAN – Referenz QRR (Zahlungen werden automatisch zugeordnet).' : rechnungIban ? 'Normale IBAN – Referenz RF (Creditor Reference).' : 'Wird für alle Rechnungen gespeichert.'}</p>
                    </div>
                    {zt.fehler.length > 0 && <div className="hinweis-fehler">{zt.fehler.join(' · ')}</div>}
                    {!debitorAdr && <div className="hinweis-fehler">Adresse des Mandanten unvollständig (Strasse, PLZ, Ort) – im Mandantenstamm ergänzen.</div>}
                    {qrSrc?.fehler && <div className="hinweis-fehler">QR-Code konnte nicht erzeugt werden.</div>}
                    <button type="button" className="btn btn-primary" onClick={rechnungErstellen} disabled={!!beschaeftigt || zt.fehler.length > 0 || !qrSrc?.url}>{beschaeftigt === 'rechnung-neu' ? 'Erstellt…' : `Rechnung über ${chf(daten.summen.total)} erstellen`}</button>
                  </>
                )}
              </div>
            </div>
          )}

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
          {!neu && daten.summen.betragExtra > 0 && rk && (
            <div className="re-vorschau-wahl">
              <button type="button" className={`btn-klein ${vorschau === 'rapport' ? 'gewaehlt' : ''}`} onClick={() => setVorschau('rapport')}>Detailrapport</button>
              <button type="button" className={`btn-klein ${vorschau === 'rechnung' ? 'gewaehlt' : ''}`} onClick={() => setVorschau('rechnung')}>Rechnung</button>
            </div>
          )}
          <div className={`rapport-vorschau-skala ${vorschau === 'rapport' ? 'druck-ziel' : 're-versteckt'}`}>
            <RapportDokument ref={dokumentRef} kopf={kopf} daten={daten} mandant={mandant} bearbeiter={bearbeiter} firma={firma} texte={texte} />
          </div>
          {!neu && rk && daten.summen.betragExtra > 0 && (
            <div className={`rapport-vorschau-skala ${vorschau === 'rechnung' ? 'druck-ziel' : 're-versteckt'}`}>
              <RechnungDokument
                ref={rechnungRef}
                kopf={{ ...rk, mwstSatz: kopf.mwst_satz }}
                positionen={positionen}
                summen={daten.summen}
                kreditor={kreditor}
                debitor={debitorAdr}
                mandant={mandant}
                zahlung={{ iban: rechnungIban, referenz: zt.referenz, referenzTyp: zt.referenzTyp, mitteilung: `Rechnung ${rk.nummer}` }}
                qrSrc={qrSrc?.text === qrText ? qrSrc.url : null}
                firma={firma}
                texte={{ zahlungstext: rechnungEinst.zahlungstext }}
              />
            </div>
          )}
        </div>
      </div>

      {offenePendenz && createPortal(
        <PendenzModal
          pendenz={offenePendenz}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => { setOffenePendenz(null); neuLaden(); }}
          onGespeichert={() => neuLaden()}
          onGeloescht={() => { setOffenePendenz(null); neuLaden(); }}
        />,
        document.body,
      )}
      {zeitOffen && createPortal(
        <ZeitModal eintrag={zeitOffen} onSchliessen={() => setZeitOffen(null)} onGespeichert={() => { setZeitOffen(null); neuLaden(); }} />,
        document.body,
      )}

      {mailOffen && (
        <FormularModal
          titel={rechnungBeleg ? `Rechnung ${rechnungBeleg.rechnungsnummer} mit Detailrapport senden` : `Detailrapport ${kopf.nummer} per E-Mail senden`}
          breit
          mail
          speichernText="Senden"
          startwerte={{
            an: adressen[0] || '', cc: '', bcc: '',
            betreff: rechnungBeleg ? textErsetzen(rechnungEinst.mailBetreff, rechnungPlatzhalter(rechnungBeleg, mandant, firma)) : textErsetzen(texte.mailBetreff || 'Detailrapport {nummer} – {mandant}', platzhalter),
            text: rechnungBeleg ? textErsetzen(rechnungEinst.mailText, rechnungPlatzhalter(rechnungBeleg, mandant, firma)) : textErsetzen(texte.mailText || '', platzhalter),
          }}
          felder={[
            { name: 'an', label: 'An', typ: 'text', pflicht: true, auswahl: () => [
              mandant?.email && { label: 'Ansprechperson', wert: mandant.email },
              mandant?.geschaeftsfuehrung_email && { label: 'Geschäftsführung', wert: mandant.geschaeftsfuehrung_email },
            ].filter(Boolean), },
            { name: 'cc', label: 'CC', typ: 'text', halb: true, platzhalter: 'optional, mehrere mit ; trennen' },
            { name: 'bcc', label: 'BCC', typ: 'text', halb: true, platzhalter: 'optional' },
            { name: 'betreff', label: 'Betreff', typ: 'text', pflicht: true },
            { name: 'text', label: 'Text', typ: 'textarea', pflicht: true, hinweis: 'Signatur mit Logo wird automatisch angehängt (Arial 10).' },
          ]}
          vorschau={() => `Anhang: ${rechnungBeleg ? `${rechnungDatei}, ` : ''}${dateiname}`}
          onSpeichern={async (f) => {
            setVorschau('rapport');
            await new Promise((r) => setTimeout(r, 50));
            const { base64 } = await elementZuPdf(dokumentRef.current);
            const anhaenge = [];
            if (rechnungBeleg) {
              let rBase64 = null;
              if (rechnungBeleg.ablage_pfad) {
                try { rBase64 = await blobBase64(await dateiLesen(rechnungBeleg.ablage_pfad)); } catch { rBase64 = null; }
              }
              if (!rBase64) { setVorschau('rechnung'); await new Promise((r) => setTimeout(r, 50)); rBase64 = (await elementZuPdf(rechnungRef.current)).base64; }
              anhaenge.push({ dateiname: rechnungDatei, base64: rBase64 });
            }
            await api.rapporte.versenden(kopf, { an: f.an, cc: f.cc, bcc: f.bcc, betreff: f.betreff, text: f.text, pdfBase64: base64, dateiname, anhaenge });
            if (rechnungBeleg) await api.belege.versendetMarkieren(rechnungBeleg.id, f.an);
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
