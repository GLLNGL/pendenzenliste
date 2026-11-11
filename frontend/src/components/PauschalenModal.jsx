import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import FormularModal from './FormularModal.jsx';
import { heutigesDatumISO, formatiereDatum } from '../format.js';
import { hintergrundSchliessen } from '../lib/modal.js';
import {
  listenpreisMonat, planMinutenMonat, effektiverSatz, formatiereCHF, formatiereMinuten, turnusLabel,
  aktivePauschalen, pauschalenSumme, zielansatz, maxMinuten, formatiereTage,
} from '../lib/preise.js';

const wertOderLeer = (w) => (w == null ? '' : String(w));
const rappen = (z) => (z == null ? '' : String(Math.round(z * 100) / 100));

// Vereinbarte Pauschalen eines Mandanten (v7, Etappe 1): eine Zeile pro Leistung bzw.
// ABACUS-Modul, Betrag pro Monat nach Rabatt. Der Listenpreis aus dem Katalog dient als
// Vorschlag; Planzeit/Mt. und Satz pro Planstunde zeigen schon jetzt, wie die Pauschale
// kalkuliert ist (Soll -- das Ist kommt mit der Zeiterfassung).
export default function PauschalenModal({ mandant, onSchliessen, onGeaendert }) {
  const [pauschalen, setPauschalen] = useState([]);
  const [leistungen, setLeistungen] = useState([]);
  const [module, setModule] = useState([]);
  const [ansaetze, setAnsaetze] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [zeigeBeendete, setZeigeBeendete] = useState(false);
  const [offen, setOffen] = useState(null); // { art: 'leistung'|'modul', eintrag }

  const laden = useCallback(() => {
    Promise.all([
      api.pauschalen.liste(mandant.id), api.preise.leistungen.liste(), api.preise.abacusModule.liste(), api.preise.ansaetze.liste(),
    ]).then(([p, l, m, a]) => { setPauschalen(p); setLeistungen(l); setModule(m); setAnsaetze(a); setFehler(null); })
      .catch((e) => setFehler(e.message));
  }, [mandant.id]);

  useEffect(() => { laden(); }, [laden]);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape' && !offen) onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen, offen]);

  const heute = heutigesDatumISO();
  const aktiveIds = new Set(aktivePauschalen(pauschalen, heute).map((p) => p.id));
  const sichtbar = pauschalen.filter((p) => zeigeBeendete || aktiveIds.has(p.id) || p.gueltig_ab > heute);
  const anzahlBeendet = pauschalen.filter((p) => p.gueltig_bis && p.gueltig_bis < heute).length;
  const leistungVon = (p) => leistungen.find((l) => l.id === p.leistung_id);
  const modulVon = (p) => module.find((m) => m.id === p.abacus_modul_id);

  function kennzahlen(p) {
    const leistung = leistungVon(p);
    if (leistung) {
      const plan = planMinutenMonat(leistung, p.menge);
      const ansatz = zielansatz(leistung, ansaetze);
      const max = maxMinuten(p.betrag_monat, ansatz);
      return {
        leistung, liste: listenpreisMonat(leistung, p.menge, ansaetze), plan, satz: effektiverSatz(p.betrag_monat, plan),
        ansatz, ansatzName: ansaetze.find((a) => a.id === leistung.stundenansatz_id)?.name ?? 'Standard', max,
      };
    }
    const modul = modulVon(p);
    return { modul, liste: modul ? Number(modul.chf_pro_monat) * Number(p.menge ?? 1) : null, plan: null, satz: null, ansatz: null, max: null };
  }

  const aktive = pauschalen.filter((p) => aktiveIds.has(p.id));
  const summe = pauschalenSumme(aktive);
  const summeListe = aktive.reduce((s, p) => s + (kennzahlen(p).liste ?? Number(p.betrag_monat)), 0);
  const summeZeit = aktive.filter((p) => p.leistung_id).reduce((s, p) => s + Number(p.betrag_monat), 0);
  const summePlan = aktive.reduce((s, p) => s + (kennzahlen(p).plan ?? 0), 0);
  const ohnePlanzeit = aktive.filter((p) => p.leistung_id && kennzahlen(p).plan == null).length;
  const summeMax = aktive.reduce((s, p) => s + (kennzahlen(p).max ?? 0), 0);
  const summePlanMitZeit = aktive.filter((p) => kennzahlen(p).plan != null && kennzahlen(p).max != null);
  const reserve = summePlanMitZeit.reduce((s, p) => s + kennzahlen(p).max - kennzahlen(p).plan, 0);

  async function nachAktion(aktion) {
    await aktion();
    setOffen(null);
    laden();
    onGeaendert?.();
  }

  function fenster({ art, eintrag }) {
    const istModul = art === 'modul';
    const katalog = istModul ? module : leistungen;
    const auswahl = katalog.filter((k) => k.aktiv || k.id === (istModul ? eintrag?.abacus_modul_id : eintrag?.leistung_id));
    const finde = (id) => katalog.find((k) => String(k.id) === String(id));
    const vorschlag = (f) => {
      const k = finde(f.positionId);
      if (!k) return null;
      return istModul ? Number(k.chf_pro_monat) * Number(f.menge || 0) : listenpreisMonat(k, f.menge, ansaetze);
    };
    return (
      <FormularModal
        titel={`${eintrag ? 'Pauschale bearbeiten' : istModul ? 'ABACUS-Modul hinzufügen' : 'Leistung hinzufügen'} · ${mandant.name}`}
        startwerte={{
          positionId: wertOderLeer(istModul ? eintrag?.abacus_modul_id : eintrag?.leistung_id),
          menge: wertOderLeer(eintrag ? eintrag.menge : (istModul ? 1 : '')),
          betragMonat: wertOderLeer(eintrag?.betrag_monat),
          gueltigAb: eintrag?.gueltig_ab ?? heute, gueltigBis: eintrag?.gueltig_bis ?? '', notiz: eintrag?.notiz ?? '',
          betragManuell: !!eintrag,
        }}
        felder={[
          { name: 'positionId', label: istModul ? 'ABACUS-Modul' : 'Leistung', typ: 'select', pflicht: true,
            optionen: auswahl.map((k) => ({ wert: String(k.id), label: istModul ? k.name : `${k.name} (${k.einheit}, ${turnusLabel(k.turnus)})` })) },
          { name: 'menge', label: (f) => {
            const k = finde(f.positionId);
            return k && !istModul ? `Menge (${k.einheit} pro ${turnusLabel(k.turnus)})` : 'Menge';
          }, typ: 'zahl', halb: true, hinweis: istModul ? 'Anzahl Lizenzen.' : 'Vereinbarte/offerierte Menge – Grundlage für die Planzeit.' },
          { name: 'betragMonat', label: 'Betrag CHF/Mt. (nach Rabatt)', typ: 'zahl', pflicht: true, halb: true, schritt: '0.05',
            hinweis: 'Wird aus dem Listenpreis vorgeschlagen, solange du ihn nicht änderst.' },
          { name: 'gueltigAb', label: 'Gültig ab', typ: 'datum', pflicht: true, halb: true },
          { name: 'gueltigBis', label: 'Gültig bis', typ: 'datum', halb: true, hinweis: 'Leer = unbefristet. Zum Beenden statt Löschen.' },
          { name: 'notiz', label: 'Notiz', typ: 'text' },
        ]}
        onAendern={(name, wert, f) => {
          if (name === 'betragMonat') return { betragManuell: wert !== '' };
          if ((name === 'positionId' || name === 'menge') && !f.betragManuell) {
            const v = vorschlag(f);
            return v == null ? null : { betragMonat: rappen(v) };
          }
          return null;
        }}
        vorschau={(f) => {
          const k = finde(f.positionId);
          if (!k) return null;
          const liste = vorschlag(f);
          const teile = [];
          if (liste != null) {
            teile.push(`Listenpreis CHF ${formatiereCHF(liste)}/Mt.`);
            const betrag = Number(f.betragMonat);
            if (f.betragMonat !== '' && liste > 0 && Math.abs(betrag - liste) >= 0.01) {
              teile.push(`${betrag < liste ? 'Rabatt' : 'Aufschlag'} ${Math.abs((1 - betrag / liste) * 100).toLocaleString('de-CH', { maximumFractionDigits: 1 })} %`);
            }
          }
          if (!istModul && f.betragMonat !== '') {
            const ansatz = zielansatz(k, ansaetze);
            const max = maxMinuten(f.betragMonat, ansatz);
            if (max != null) teile.push(`max. ${formatiereMinuten(max)}/Mt. (${formatiereTage(max)}) bei CHF ${formatiereCHF(ansatz, { ohneRappen: true })}/Std.`);
          }
          if (!istModul) {
            const plan = planMinutenMonat(k, f.menge);
            if (plan != null) {
              teile.push(`Planzeit ${formatiereMinuten(plan)}/Mt.`);
              const satz = effektiverSatz(f.betragMonat, plan);
              if (satz != null) teile.push(`= CHF ${formatiereCHF(satz, { ohneRappen: true })}/Std.`);
            } else if (k.minuten_pro_einheit == null) {
              teile.push('Planzeit fehlt im Katalog (Preise)');
            }
          }
          return teile.join(' · ');
        }}
        onSpeichern={(f) => nachAktion(() => api.pauschalen.speichern(eintrag?.id, {
          mandantId: mandant.id,
          leistungId: istModul ? null : f.positionId,
          abacusModulId: istModul ? f.positionId : null,
          menge: f.menge, betragMonat: f.betragMonat, gueltigAb: f.gueltigAb, gueltigBis: f.gueltigBis, notiz: f.notiz,
        }))}
        onLoeschen={eintrag ? () => nachAktion(() => api.pauschalen.loeschen(eintrag.id)) : undefined}
        loeschenText="Diese Pauschale löschen? Zum Beenden besser «Gültig bis» setzen – dann bleibt sie für die Auswertung früherer Monate erhalten."
        onSchliessen={() => setOffen(null)}
      />
    );
  }

  return (
    <div className="modal-hintergrund" {...hintergrundSchliessen(onSchliessen)}>
      <div className="modal modal-breit" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>Preise &amp; Pauschalen · {mandant.name}{mandant.kunden_nr ? ` (${mandant.kunden_nr})` : ''}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>
        <div className="modal-koerper">
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
          <table className="tabelle pauschalen-tabelle">
            <thead>
              <tr>
                <th>Dienstleistung</th><th className="zahl">Menge</th><th className="zahl">Listenpreis/Mt.</th>
                <th className="zahl">Preis/Mt.</th><th className="zahl" title="Zielansatz der Leistung">Ansatz</th>
                <th className="zahl" title="Preis / Zielansatz – so viele Stunden pro Monat deckt der Preis">Max. Std./Mt.</th>
                <th className="zahl">Planzeit/Mt.</th><th className="zahl" title="Preis / Planzeit">Ertrag/Planstd.</th>
                <th>Gültig</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((p) => {
                const k = kennzahlen(p);
                const beendet = !aktiveIds.has(p.id) && p.gueltig_bis && p.gueltig_bis < heute;
                const name = k.leistung?.name ?? (k.modul ? `ABACUS: ${k.modul.name}` : '–');
                const einheit = k.leistung ? ` ${k.leistung.einheit}${k.leistung.turnus === 'jaehrlich' ? '/Jahr' : ''}` : '';
                const unterZiel = k.satz != null && k.ansatz != null && k.satz < k.ansatz;
                const ueberMax = k.plan != null && k.max != null && k.plan > k.max;
                return (
                  <tr key={p.id} title={p.notiz || undefined}>
                    <td className={beendet ? 'beendet' : ''}>{name}</td>
                    <td className="zahl">{p.menge == null ? '–' : `${Number(p.menge).toLocaleString('de-CH')}${einheit}`}</td>
                    <td className="zahl">{formatiereCHF(k.liste)}</td>
                    <td className="zahl">{formatiereCHF(p.betrag_monat)}</td>
                    <td className="zahl" title={k.ansatzName}>{k.ansatz == null ? '' : formatiereCHF(k.ansatz, { ohneRappen: true })}</td>
                    <td className="zahl" title={k.max == null ? undefined : formatiereTage(k.max)}>{k.max == null ? '' : formatiereMinuten(k.max)}</td>
                    <td className={`zahl ${ueberMax ? 'unter-liste' : ''}`} title={ueberMax ? 'Planzeit höher als die Stunden, die der Preis deckt' : undefined}>{k.leistung ? formatiereMinuten(k.plan) : ''}</td>
                    <td className={`zahl ${unterZiel ? 'unter-liste' : ''}`} title={unterZiel ? `unter dem Zielansatz von CHF ${formatiereCHF(k.ansatz)}` : undefined}>
                      {k.satz == null ? '' : formatiereCHF(k.satz, { ohneRappen: true })}
                    </td>
                    <td className="pauschalen-zusatz">
                      {beendet ? `bis ${formatiereDatum(p.gueltig_bis)}` : p.gueltig_ab > heute ? `ab ${formatiereDatum(p.gueltig_ab)}`
                        : p.gueltig_bis ? `bis ${formatiereDatum(p.gueltig_bis)}` : `seit ${formatiereDatum(p.gueltig_ab)}`}
                    </td>
                    <td className="spalte-aktionen">
                      <button type="button" className="btn-klein" onClick={() => setOffen({ art: p.abacus_modul_id ? 'modul' : 'leistung', eintrag: p })}>Bearbeiten</button>
                    </td>
                  </tr>
                );
              })}
              {sichtbar.length === 0 && <tr><td colSpan={10} className="leer-hinweis">Noch keine Preise erfasst – «+ Dienstleistung».</td></tr>}
            </tbody>
            {aktive.length > 0 && (
              <tfoot>
                <tr>
                  <td>Monatspauschale (aktuell gültig)</td>
                  <td></td>
                  <td className="zahl">{formatiereCHF(summeListe)}</td>
                  <td className="zahl">{formatiereCHF(summe)}</td>
                  <td></td>
                  <td className="zahl">{summeMax ? formatiereMinuten(summeMax) : ''}</td>
                  <td className="zahl">{summePlan ? formatiereMinuten(summePlan) : ''}</td>
                  <td className="zahl" title="Leistungen ohne ABACUS-Lizenzen, nur Positionen mit Planzeit">
                    {summePlan ? formatiereCHF(effektiverSatz(aktive.filter((p) => kennzahlen(p).plan != null).reduce((s, p) => s + Number(p.betrag_monat), 0), summePlan), { ohneRappen: true }) : ''}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
          {summeMax > 0 && (
            <div className="pauschalen-kapazitaet">
              <span>Max. einsetzbar: <strong>{formatiereMinuten(summeMax)} pro Monat</strong> ({formatiereTage(summeMax)})</span>
              <span><strong>{formatiereMinuten(summeMax * 12)} pro Jahr</strong> ({formatiereTage(summeMax * 12)})</span>
              {summePlan > 0 && <span>Planzeit {formatiereMinuten(summePlan)}/Mt.</span>}
              {summePlanMitZeit.length > 0 && (
                <span className={reserve < 0 ? 'unter-liste' : 'pauschalen-reserve'}>
                  {reserve < 0 ? 'Fehlbetrag' : 'Reserve'} {formatiereMinuten(Math.abs(reserve))}/Mt.
                </span>
              )}
              <span className="pauschalen-zusatz">1 Tag = 8 Std. · Max. = Preis ÷ Zielansatz der Leistung</span>
            </div>
          )}
          {aktive.length > 0 && (
            <p className="pauschalen-zusatz">
              Davon Leistungen CHF {formatiereCHF(summeZeit)}, ABACUS-Lizenzen CHF {formatiereCHF(summe - summeZeit)} · exkl. MWST
              {summeListe > 0 && summe < summeListe && ` · Rabatt gegenüber Listenpreis ${((1 - summe / summeListe) * 100).toLocaleString('de-CH', { maximumFractionDigits: 1 })} %`}
              {ohnePlanzeit > 0 && ` · ${ohnePlanzeit} Position${ohnePlanzeit > 1 ? 'en' : ''} ohne Planzeit`}
            </p>
          )}
        </div>
        <div className="modal-fuss">
          <div>
            {anzahlBeendet > 0 && (
              <label className="kopfzeile-checkbox">
                <input type="checkbox" checked={zeigeBeendete} onChange={(e) => setZeigeBeendete(e.target.checked)} />
                Beendete anzeigen ({anzahlBeendet})
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setOffen({ art: 'leistung', eintrag: null })}>+ Dienstleistung</button>
            <button type="button" className="btn" onClick={() => setOffen({ art: 'modul', eintrag: null })}>+ ABACUS-Modul</button>
            <button type="button" className="btn btn-primary" onClick={onSchliessen}>Fertig</button>
          </div>
        </div>
      </div>
      {offen && <div onClick={(e) => e.stopPropagation()}>{fenster(offen)}</div>}
    </div>
  );
}
