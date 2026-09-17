import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import { formatiereDatum, formatiereZeitstempel } from '../format.js';
import { statusSlug } from '../constants.js';
import { aufAenderungHoeren } from '../events.js';
import Badge from './Badge.jsx';

// Dritte Spalte neben einer Pendenzenliste: Klick auf den Titel einer Zeile zeigt hier
// Beschreibung und Eckdaten der Pendenz, ohne gleich das volle Bearbeiten-Fenster zu oeffnen.
// Klick auf diese Vorschau selbst oeffnet die Pendenz dann wie gewohnt als Pop-up. Ist die
// Pendenz eine Hauptaufgabe, stehen darunter zusaetzlich ihre Teilaufgaben -- ein Klick auf eine
// von ihnen oeffnet direkt deren eigenes Pop-up.
export default function PendenzVorschau({ pendenz, onOeffnen, onStatusAendern }) {
  const istHauptaufgabe = !!pendenz && !pendenz.uebergeordnete_pendenz_id;
  const [teilaufgaben, setTeilaufgaben] = useState([]);
  const [notizen, setNotizen] = useState([]);
  const [emailVerlauf, setEmailVerlauf] = useState([]);

  const ladeTeilaufgaben = useCallback(() => {
    if (!istHauptaufgabe) { setTeilaufgaben([]); return; }
    api.pendenzen.teilaufgaben(pendenz.id).then(setTeilaufgaben).catch(() => setTeilaufgaben([]));
  }, [pendenz, istHauptaufgabe]);

  const ladeNotizen = useCallback(() => {
    if (!pendenz) { setNotizen([]); return; }
    api.pendenzen.notizen(pendenz.id).then(setNotizen).catch(() => setNotizen([]));
  }, [pendenz]);

  const ladeEmailVerlauf = useCallback(() => {
    if (!pendenz) { setEmailVerlauf([]); return; }
    api.pendenzen.emails(pendenz.id).then(setEmailVerlauf).catch(() => setEmailVerlauf([]));
  }, [pendenz]);

  // Nicht nur beim Wechsel der angezeigten Pendenz neu laden, sondern bei jeder Aenderung
  // irgendwo in der App -- sonst bleibt z.B. eine Teilaufgabe hier veraltet stehen, wenn sie
  // ueber ihr eigenes Bearbeiten-Fenster geaendert wurde (die angezeigte Pendenz wechselt dabei
  // ja nicht, der Effekt wuerde also sonst nicht erneut laufen).
  useEffect(() => {
    ladeTeilaufgaben();
    return aufAenderungHoeren(ladeTeilaufgaben);
  }, [ladeTeilaufgaben]);

  useEffect(() => {
    ladeNotizen();
    return aufAenderungHoeren(ladeNotizen);
  }, [ladeNotizen]);

  useEffect(() => {
    ladeEmailVerlauf();
    return aufAenderungHoeren(ladeEmailVerlauf);
  }, [ladeEmailVerlauf]);

  if (!pendenz) {
    return (
      <div className="pendenz-vorschau-spalte">
        <div className="leer-hinweis">Titel einer Pendenz anklicken, um die Beschreibung zu sehen.</div>
      </div>
    );
  }

  const mandantText = [pendenz.mandant_name, pendenz.bearbeiter_name].filter(Boolean).join(' · ');

  async function teilaufgabeAbhaken(e, teilaufgabe) {
    e.stopPropagation();
    const erledigt = teilaufgabe.status === 'Erledigt';
    await onStatusAendern(teilaufgabe, erledigt ? 'Offen' : 'Erledigt');
    ladeTeilaufgaben();
  }

  return (
    <div className="pendenz-vorschau-spalte">
      <div
        className="pendenz-vorschau"
        role="button"
        tabIndex={0}
        onClick={() => onOeffnen(pendenz)}
        onKeyDown={(e) => { if (e.key === 'Enter') onOeffnen(pendenz); }}
      >
        <div className="pendenz-vorschau-kopf">
          <Badge prioritaet={pendenz.prioritaet} />
          <span className={`zeile-status-tag status-${statusSlug(pendenz.status)}`}>{pendenz.status}</span>
        </div>

        <div className="pendenz-vorschau-titel">{pendenz.titel}</div>

        {mandantText && <div className="pendenz-vorschau-mandant">{mandantText}</div>}

        <div className="pendenz-vorschau-daten">
          <span>Fällig {formatiereDatum(pendenz.faelligkeit)}</span>
          {pendenz.wiedervorlage && <span>Wiedervorlage {formatiereDatum(pendenz.wiedervorlage)}</span>}
          {pendenz.aufwand_stunden != null && <span>{pendenz.aufwand_stunden} Std.</span>}
        </div>

        <div className="pendenz-vorschau-teilaufgaben-titel">Bemerkungen</div>
        {pendenz.beschreibung ? (
          <p className="pendenz-vorschau-text">{pendenz.beschreibung}</p>
        ) : (
          <p className="pendenz-vorschau-text pendenz-vorschau-leer">Keine Beschreibung hinterlegt.</p>
        )}

        <div className="pendenz-vorschau-hinweis">Klicken für alle Details →</div>
      </div>

      {istHauptaufgabe && (
        <div className="pendenz-vorschau-teilaufgaben">
          <div className="pendenz-vorschau-teilaufgaben-titel">
            Teilaufgaben
            {teilaufgaben.length > 0 && (
              <span className="teilaufgaben-zaehler">
                {teilaufgaben.filter((t) => t.status === 'Erledigt').length}/{teilaufgaben.length} erledigt
              </span>
            )}
          </div>

          {teilaufgaben.length === 0 ? (
            <div className="teilaufgaben-leer">Noch keine Teilaufgaben.</div>
          ) : (
            <div className="teilaufgaben-liste">
              {teilaufgaben.map((t, idx) => {
                const erledigt = t.status === 'Erledigt';
                return (
                  <div
                    key={t.id}
                    className={`teilaufgabe-zeile ${erledigt ? 'erledigt' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOeffnen(t)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOeffnen(t); }}
                  >
                    <button
                      type="button"
                      className={`abhaken ${erledigt ? 'aktiv' : ''}`}
                      aria-label={erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}
                      onClick={(e) => teilaufgabeAbhaken(e, t)}
                    >
                      {erledigt ? '✓' : ''}
                    </button>
                    <span className="teilaufgabe-titel" title={t.titel}><span className="zeile-id">{pendenz.id}.{idx + 1}</span>{t.titel}</span>
                    <span className="teilaufgabe-datum">{formatiereDatum(t.faelligkeit)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="pendenz-vorschau-fortschritt">
        <div className="pendenz-vorschau-teilaufgaben-titel">E-Mails</div>
        {emailVerlauf.length === 0 ? (
          <p className="pendenz-vorschau-fortschritt-leer">Keine Daten.</p>
        ) : (
          <div className="email-verlauf">
            {emailVerlauf.map((eMail) => (
              <div key={eMail.id} className="email-verlauf-eintrag">
                <span className="email-verlauf-symbol" aria-hidden="true">✔</span>
                <span>Gesendet am {formatiereZeitstempel(eMail.gesendet_am)} an <strong>{eMail.an}</strong></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pendenz-vorschau-fortschritt">
        <div className="pendenz-vorschau-teilaufgaben-titel">Fortschritt</div>
        {notizen.length === 0 ? (
          <p className="pendenz-vorschau-fortschritt-leer">Keine Daten.</p>
        ) : (
          <div className="notizen-liste">
            {notizen.map((n) => (
              <div key={n.id} className="notiz-eintrag">
                <div className="notiz-kopf">
                  <span className="notiz-datum">{formatiereZeitstempel(n.erstellt_am)}</span>
                  {n.mitarbeiter_name && <span className="notiz-autor">{n.mitarbeiter_name}</span>}
                </div>
                <p className="notiz-text">{n.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
