import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import FormularModal from './FormularModal.jsx';
import { textErsetzen } from '../lib/offerte.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { onboardingStand } from '../lib/onboarding.js';

const STANDARD_BETREFF = 'Willkommen bei {firma} – Unterlagen zur Mandatseröffnung';

// Onboarding eines Mandanten (nach angenommener Offerte): Checkliste der Unterlagen, Mail mit
// den Vorlagen als Anhang, Ruecklauf (unterschrieben zurueck) abhaken, abschliessen.
export default function OnboardingBereich({ mandant, offerten = [], vorgabeOfferteId = null, onGeaendert }) {
  const { benutzer } = useAuth();
  const [onboarding, setOnboarding] = useState(undefined);
  const [katalog, setKatalog] = useState([]);
  const [texte, setTexte] = useState({});
  const [firma, setFirma] = useState({});
  const [fehler, setFehler] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [mailOffen, setMailOffen] = useState(false);
  const [zusatz, setZusatz] = useState([]);
  const zusatzRef = useRef(null);

  const laden = useCallback(() => {
    Promise.all([api.onboarding.holen(mandant.id), api.onboarding.unterlagen.liste()])
      .then(([o, k]) => { setOnboarding(o); setKatalog(k); setFehler(null); })
      .catch((e) => { setOnboarding(null); setFehler(e.message); });
    api.buero.lesen('onboarding').then(setTexte).catch(() => {});
    api.buero.lesen('firma').then(setFirma).catch(() => {});
  }, [mandant.id]);
  useEffect(() => { laden(); }, [laden]);

  if (onboarding === undefined) return null;

  const angenommen = offerten.filter((o) => o.status === 'Angenommen');
  const katalogVon = (id) => katalog.find((k) => k.id === id);

  async function aendern(patch, text) {
    setFehler(null);
    try {
      const neu = await api.onboarding.aktualisieren(onboarding.id, patch);
      setOnboarding(neu);
      if (text) setMeldung(text);
      onGeaendert?.();
    } catch (err) { setFehler(err.message); }
  }

  async function starten() {
    setFehler(null);
    try {
      const offerteId = vorgabeOfferteId ?? angenommen[0]?.id ?? null;
      setOnboarding(await api.onboarding.starten(mandant.id, offerteId));
      setMeldung('Onboarding gestartet – Unterlagen prüfen und die Mail erstellen.');
      onGeaendert?.();
    } catch (err) { setFehler(err.message); }
  }

  if (fehler && /relation|does not exist|schema cache/i.test(fehler)) {
    return <div className="hinweis-fehler">Onboarding ist noch nicht eingerichtet – bitte zuerst <code>supabase/mandanten-onboarding-v7.sql</code> in Supabase ausführen.</div>;
  }

  if (!onboarding) {
    const aktive = katalog.filter((k) => k.aktiv);
    return (
      <div className="onboarding-leer">
        <p>
          {angenommen.length
            ? <>Offerte {angenommen[0].nummer} ist angenommen. Mit dem Onboarding erhält der Mandant die Unterlagen zur Mandatseröffnung:</>
            : <>Noch keine angenommene Offerte. Das Onboarding startet normalerweise nach der Annahme – es lässt sich aber auch direkt starten. Unterlagen:</>}
        </p>
        <ul className="onboarding-katalog-liste">
          {aktive.map((k) => <li key={k.id}>{k.name}{!k.datei && <span className="text-gedaempft"> (noch keine Vorlage)</span>}</li>)}
          {aktive.length === 0 && <li className="text-gedaempft">Noch keine Unterlagen im Katalog.</li>}
        </ul>
        <div className="onboarding-aktionen">
          <button type="button" className="btn btn-primary" onClick={starten}>Onboarding starten</button>
          <Link to="/onboarding-unterlagen" className="btn-klein">Unterlagen verwalten</Link>
        </div>
        {fehler && <div className="hinweis-fehler">{fehler}</div>}
      </div>
    );
  }

  const zeilen = onboarding.unterlagen ?? [];
  const stand = onboardingStand(onboarding);
  const setzeZeile = (i, patch) => aendern({ unterlagen: zeilen.map((z, j) => (j === i ? { ...z, ...patch } : z)) });

  function ergaenzen() {
    const fehlend = katalog.filter((k) => k.aktiv && !zeilen.some((z) => z.unterlageId === k.id));
    if (!fehlend.length) { setMeldung('Alle Unterlagen aus dem Katalog sind bereits in der Checkliste.'); return; }
    aendern({
      unterlagen: [...zeilen, ...fehlend.map((k) => ({ unterlageId: k.id, name: k.name, zurueck: k.zurueck, mitsenden: true, gesendetAm: null, erhaltenAm: null }))],
    }, `${fehlend.length} Unterlage(n) ergänzt.`);
  }

  const mitsenden = zeilen.filter((z) => z.mitsenden);
  const vorlagen = mitsenden.map((z) => katalogVon(z.unterlageId)?.datei).filter(Boolean);
  const ohneVorlage = mitsenden.filter((z) => !katalogVon(z.unterlageId)?.datei);
  const adressen = [mandant.email, mandant.geschaeftsfuehrung_email].filter(Boolean);
  const platzhalter = {
    firma: firma.firma || '', mandant: mandant.name, ansprechperson: mandant.ansprechperson || '', bearbeiter: benutzer?.name || '',
    unterlagen: mitsenden.map((z) => `– ${z.name}`).join('\n'),
  };

  return (
    <div className="onboarding">
      <div className="onboarding-stand">
        <span>Gestartet am {formatiereDatum(onboarding.gestartet_am)}</span>
        {onboarding.offerte_id && (() => {
          const o = offerten.find((x) => x.id === onboarding.offerte_id);
          return o ? <span>· aus Offerte <Link to={`/offerten/${o.id}?von=mandanten`}>{o.nummer}</Link></span> : null;
        })()}
        <span>· {onboarding.mail_gesendet_am ? `Mail gesendet am ${formatiereDatum(onboarding.mail_gesendet_am.slice(0, 10))} an ${onboarding.mail_an}` : 'Mail noch nicht gesendet'}</span>
        <span>· zurück: {stand.erhalten}/{stand.zurueck}</span>
        {onboarding.abgeschlossen_am && <strong>· abgeschlossen am {formatiereDatum(onboarding.abgeschlossen_am)}</strong>}
      </div>

      <table className="tabelle onboarding-tabelle">
        <thead>
          <tr><th title="In der Mail mitsenden">Senden</th><th>Unterlage</th><th>Vorlage</th><th>Gesendet</th><th>Unterschrieben zurück</th><th></th></tr>
        </thead>
        <tbody>
          {zeilen.map((z, i) => {
            const k = katalogVon(z.unterlageId);
            return (
              <tr key={`${z.unterlageId}-${i}`}>
                <td><input type="checkbox" checked={!!z.mitsenden} onChange={(e) => setzeZeile(i, { mitsenden: e.target.checked })} aria-label={`${z.name} mitsenden`} /></td>
                <td>{z.name}</td>
                <td>{k?.datei ? <span className="text-gedaempft">{k.datei.dateiname}</span> : <Link to="/onboarding-unterlagen" className="text-ueberfaellig">keine Vorlage</Link>}</td>
                <td>{z.gesendetAm ? formatiereDatum(z.gesendetAm.slice(0, 10)) : '–'}</td>
                <td>
                  {z.zurueck ? (
                    <label className="onboarding-erhalten">
                      <input type="checkbox" checked={!!z.erhaltenAm} onChange={(e) => setzeZeile(i, { erhaltenAm: e.target.checked ? heutigesDatumISO() : null })} />
                      {z.erhaltenAm ? formatiereDatum(z.erhaltenAm) : 'offen'}
                    </label>
                  ) : <span className="text-gedaempft">nicht nötig</span>}
                </td>
                <td>
                  <button type="button" className="btn-klein btn-gefahr-text" title="Aus der Checkliste entfernen"
                    onClick={() => window.confirm(`«${z.name}» aus der Checkliste entfernen?`) && aendern({ unterlagen: zeilen.filter((_, j) => j !== i) })}>×</button>
                </td>
              </tr>
            );
          })}
          {zeilen.length === 0 && <tr><td colSpan={6} className="leer-hinweis">Keine Unterlagen in der Checkliste.</td></tr>}
        </tbody>
      </table>

      <div className="onboarding-zusatz">
        <span>Weitere Anhänge für die Mail:</span>
        {zusatz.map((f, i) => (
          <span key={`${f.name}-${i}`} className="onboarding-zusatz-datei">
            {f.name} <button type="button" className="link-knopf" onClick={() => setZusatz((z) => z.filter((_, j) => j !== i))} aria-label="Entfernen">×</button>
          </span>
        ))}
        <button type="button" className="btn-klein" onClick={() => zusatzRef.current?.click()}>+ Datei vom PC</button>
        <input ref={zusatzRef} type="file" multiple hidden onChange={(e) => { setZusatz((z) => [...z, ...e.target.files]); e.target.value = ''; }} />
      </div>

      <div className="onboarding-aktionen">
        <button type="button" className="btn btn-primary" onClick={() => setMailOffen(true)} disabled={!mitsenden.length && !zusatz.length}>
          {onboarding.mail_gesendet_am ? 'Mail erneut senden…' : 'Onboarding-Mail erstellen…'}
        </button>
        <button type="button" className="btn-klein" onClick={ergaenzen}>Aus Katalog ergänzen</button>
        <Link to="/onboarding-unterlagen" className="btn-klein">Unterlagen verwalten</Link>
        <span className="onboarding-aktionen-rechts">
          {onboarding.abgeschlossen_am ? (
            <button type="button" className="btn-klein" onClick={() => aendern({ abgeschlossen_am: null }, 'Onboarding wieder geöffnet.')}>Wieder öffnen</button>
          ) : (
            <button type="button" className="btn" onClick={() => {
              if (stand.offen > 0 && !window.confirm(`Noch ${stand.offen} Unterlage(n) nicht zurück. Trotzdem abschliessen?`)) return;
              aendern({ abgeschlossen_am: heutigesDatumISO() }, 'Onboarding abgeschlossen.');
            }}>Onboarding abschliessen</button>
          )}
          <button type="button" className="btn-klein btn-gefahr-text" onClick={async () => {
            if (!window.confirm('Onboarding dieses Mandanten löschen (Checkliste und Versanddatum)? Die Unterlagen im Katalog bleiben.')) return;
            try { await api.onboarding.loeschen(onboarding.id); setOnboarding(null); onGeaendert?.(); } catch (err) { setFehler(err.message); }
          }}>Löschen</button>
        </span>
      </div>
      {meldung && <div className="hinweis-erfolg">{meldung}</div>}
      {fehler && <div className="hinweis-fehler">{fehler}</div>}

      {mailOffen && (
        <FormularModal
          titel={`Onboarding-Mail an ${mandant.name}`}
          breit
          mail
          speichernText="Senden"
          startwerte={{
            an: adressen[0] || '', cc: '', bcc: '',
            betreff: textErsetzen(texte.mailBetreff || STANDARD_BETREFF, platzhalter),
            text: textErsetzen(texte.mailText || '{unterlagen}', platzhalter),
          }}
          felder={[
            { name: 'an', label: 'An', typ: 'text', pflicht: true, vorschlaege: adressen,
              hinweis: adressen.length ? 'Vorschläge aus dem Mandanten.' : 'Beim Mandanten ist keine E-Mail hinterlegt.' },
            { name: 'cc', label: 'CC', typ: 'text', halb: true, platzhalter: 'optional, mehrere mit ; trennen' },
            { name: 'bcc', label: 'BCC', typ: 'text', halb: true, platzhalter: 'optional' },
            { name: 'betreff', label: 'Betreff', typ: 'text', pflicht: true },
            { name: 'text', label: 'Text', typ: 'textarea', pflicht: true, hinweis: 'Signatur mit Logo wird automatisch angehängt (Arial 10).' },
          ]}
          vorschau={() => [
            `Anhänge: ${[...vorlagen.map((d) => d.dateiname), ...zusatz.map((f) => f.name)].join(', ') || 'keine'}`,
            ohneVorlage.length ? `Ohne Vorlage (nur im Text erwähnt): ${ohneVorlage.map((z) => z.name).join(', ')}` : '',
          ].filter(Boolean).join(' · ')}
          onSpeichern={async (f) => {
            const neu = await api.onboarding.versenden(onboarding, {
              an: f.an, cc: f.cc, bcc: f.bcc, betreff: f.betreff, text: f.text, dateien: vorlagen, zusatz,
              unterlagenIds: mitsenden.map((z) => z.unterlageId),
            });
            setOnboarding(neu);
            setZusatz([]);
            setMailOffen(false);
            setMeldung(`Onboarding-Mail an ${f.an} gesendet.`);
            onGeaendert?.();
          }}
          onSchliessen={() => setMailOffen(false)}
        />
      )}
    </div>
  );
}
