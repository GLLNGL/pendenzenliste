import { formatiereDatum, formatiereZeitstempel, heutigesDatumISO } from '../format.js';
import { STATUS_WERTE, statusSlug } from '../constants.js';

const PRIO_SLUG = { Hoch: 'hoch', Mittel: 'mittel', Tief: 'tief' };

// Eine Tabellenzeile (<tr>) -- fuer Haupt- wie fuer Teilpendenzen. Die Prioritaet wird nicht
// als eigene Chip-Spalte gefuehrt, sondern als schmaler Farbstreifen an der ersten Zelle: bei
// vielen Zeilen faellt "dringend" so auf einen Blick auf, ohne dass ein weiterer bunter Chip
// neben Status und Mandant um Aufmerksamkeit konkurriert. Teilaufgaben bleiben zusaetzlich ganz
// ohne Farbstreifen -- ihre Prioritaet ergibt sich aus der Hauptpendenz.
export default function PendenzZeile({
  pendenz, onOeffnen, onStatusAendern, onKeyDown,
  eingezogen = false, anzeigeId, hatKinder = false, eingeklappt = false, onToggleEinklappen,
  ohneAbhaken = false, onVorschau, istVorschau = false,
}) {
  const heute = heutigesDatumISO();
  const erledigt = pendenz.status === 'Erledigt';
  const ueberfaellig = !erledigt && pendenz.faelligkeit < heute;
  const istHeute = !erledigt && pendenz.faelligkeit === heute;

  const teilaufgabenGesamt = pendenz.teilaufgaben_gesamt || 0;
  const teilaufgabenErledigt = pendenz.teilaufgaben_erledigt || 0;
  const fortschrittProzent = teilaufgabenGesamt
    ? Math.round((teilaufgabenErledigt / teilaufgabenGesamt) * 100)
    : 0;

  const prioSlug = PRIO_SLUG[pendenz.prioritaet] || 'tief';
  const railKlasse = !eingezogen ? `zeile-rail prio-${prioSlug}` : '';
  const mandantText = [pendenz.mandant_name, pendenz.bearbeiter_name].filter(Boolean).join(' · ');

  function abhaken(e) {
    e.stopPropagation();
    onStatusAendern(pendenz, erledigt ? 'Offen' : 'Erledigt');
  }

  return (
    <tr
      className={`pendenz-zeile ${eingezogen ? 'pz-kind' : 'pz-haupt'} ${erledigt ? 'erledigt' : ''} ${istVorschau ? 'vorschau-aktiv' : ''}`}
      data-zeile
      tabIndex={0}
      onKeyDown={(e) => onKeyDown(e, pendenz)}
      onClick={() => (onVorschau ? onVorschau(pendenz) : onOeffnen(pendenz))}
    >
      {!ohneAbhaken && (
        <td className={`pz-td-check ${railKlasse}`} title={!eingezogen ? `Priorität: ${pendenz.prioritaet}` : undefined}>
          <button
            type="button"
            className={`abhaken ${erledigt ? 'aktiv' : ''}`}
            aria-label={erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}
            onClick={abhaken}
          >
            {erledigt ? '✓' : ''}
          </button>
        </td>
      )}

      <td
        className={`pz-td-titel ${ohneAbhaken ? railKlasse : ''}`}
        title={ohneAbhaken && !eingezogen ? `Priorität: ${pendenz.prioritaet}` : undefined}
      >
        <div className="zeile-titel">
          {hatKinder && (
            <button
              type="button"
              className="zeile-einklapp-toggle"
              onClick={(e) => { e.stopPropagation(); onToggleEinklappen(); }}
              aria-label={eingeklappt ? 'Teilaufgaben einblenden' : 'Teilaufgaben ausblenden'}
            >
              {eingeklappt ? '▸' : '▾'}
            </button>
          )}
          <span className="zeile-id">{anzeigeId ?? pendenz.id}</span>
          <span className="zeile-titel-text" title={pendenz.titel}>{pendenz.titel}</span>
          {pendenz.email_anzahl > 0 && (
            <span
              className="zeile-email-markierung"
              title={`Zuletzt gesendet am ${formatiereZeitstempel(pendenz.email_zuletzt_gesendet_am)}${pendenz.email_anzahl > 1 ? ` (${pendenz.email_anzahl}× gesendet)` : ''}`}
            >
              ✉
            </span>
          )}
          {!eingezogen && teilaufgabenGesamt > 0 && (
            <span
              className="teilaufgaben-fortschritt"
              title={`${teilaufgabenErledigt} von ${teilaufgabenGesamt} Teilaufgaben erledigt`}
            >
              <span className="tf-balken">
                <span className="tf-fuellung" style={{ width: `${fortschrittProzent}%` }} />
              </span>
              {teilaufgabenErledigt}/{teilaufgabenGesamt}
            </span>
          )}
        </div>
        {!eingezogen && pendenz.eltern_titel && (
          <div className="zeile-hinweis">↳ Teilaufgabe von: {pendenz.eltern_titel}</div>
        )}
      </td>

      <td className="pz-td-mandant">{mandantText}</td>

      <td className="pz-td-status">
        {eingezogen ? (
          // Teilaufgaben bleiben ruhig: Status nur als kleiner Text statt Dropdown, aber immer
          // sichtbar (auch "Offen") -- vollstaendig bearbeiten per Klick auf die Zeile.
          <span className={`zeile-status-tag status-${statusSlug(pendenz.status)}`}>{pendenz.status}</span>
        ) : (
          <select
            className={`status-select status-${statusSlug(pendenz.status)}`}
            value={pendenz.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onStatusAendern(pendenz, e.target.value)}
          >
            {STATUS_WERTE.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </td>

      <td className={`pz-td-faellig ${ueberfaellig ? 'ueberfaellig' : ''} ${istHeute ? 'heute' : ''}`}>
        {formatiereDatum(pendenz.faelligkeit)}
      </td>
    </tr>
  );
}
