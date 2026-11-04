import api from '../api.js';
import { statusWechselBrauchtFormular } from '../constants.js';

const WIP_LIMIT = 3;

// WIP-Limit (Etappe 2): hoechstens 3 Pendenzen gleichzeitig "In Arbeit" pro Person. Kein harter
// Riegel, sondern eine Warnung mit Rueckfrage -- die Pendenz bleibt unveraendert, wenn man
// abbricht. Gezaehlt wird bei der Person, die die Pendenz bearbeitet (ohne Bearbeiter/in: die
// angemeldete Person, der sie beim Setzen auf "In Arbeit" automatisch zugewiesen wird).
async function inArbeitErlaubt(pendenz, bearbeiterId) {
  if (pendenz?.teilaufgaben_gesamt > 0) return true; // Projekt-Kopf: es zaehlt der Schritt
  const zustaendig = bearbeiterId ?? pendenz?.bearbeiter_id ?? await api.mitarbeitende.aktuelleId();
  const andere = await api.pendenzen.inArbeitVon(zustaendig, pendenz?.id);
  if (andere.length < WIP_LIMIT) return true;
  const liste = andere.map((p) => `• ${p.mandant_name ? `${p.mandant_name}: ` : ''}${p.titel}`).join('\n');
  return window.confirm(
    `WIP-Limit erreicht: Es sind bereits ${andere.length} Pendenzen «In Arbeit»:\n\n${liste}\n\n`
    + 'Zuerst eine davon abschliessen oder zurückstellen («Später»).\n\nTrotzdem auf «In Arbeit» setzen?',
  );
}

// Gemeinsame Logik fuer die Status-Dropdowns in Listen und Vorschau: "Warten auf" ohne
// Person/Nachfassdatum oeffnet das Bearbeiten-Fenster, "In Arbeit" prueft das WIP-Limit.
async function statusWechseln(pendenz, neuerStatus, { onOeffnen, onStatusAendern }) {
  if (statusWechselBrauchtFormular(pendenz, neuerStatus)) {
    onOeffnen({ ...pendenz, status: neuerStatus });
    return;
  }
  if (neuerStatus === 'In Arbeit' && pendenz.status !== 'In Arbeit' && !(await inArbeitErlaubt(pendenz))) return;
  onStatusAendern(pendenz, neuerStatus);
}

export { WIP_LIMIT, inArbeitErlaubt, statusWechseln };
