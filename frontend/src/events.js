// Leichtgewichtiges Signal fuer "Pendenzen haben sich geaendert", damit unabhaengige Ansichten
// (Cockpit, Mandanten, Alle Pendenzen) sich nach einer Aenderung an anderer Stelle aktualisieren
// koennen, ohne eine globale State-Bibliothek einzufuehren.
const PENDENZEN_EVENT = 'pendenzen-geaendert';
const MANDANTEN_EVENT = 'mandanten-geaendert';
const MITARBEITENDE_EVENT = 'mitarbeitende-geaendert';

function meldeAenderung() {
  window.dispatchEvent(new Event(PENDENZEN_EVENT));
}

function aufAenderungHoeren(callback) {
  window.addEventListener(PENDENZEN_EVENT, callback);
  return () => window.removeEventListener(PENDENZEN_EVENT, callback);
}

function meldeMandantenAenderung() {
  window.dispatchEvent(new Event(MANDANTEN_EVENT));
}

function aufMandantenAenderungHoeren(callback) {
  window.addEventListener(MANDANTEN_EVENT, callback);
  return () => window.removeEventListener(MANDANTEN_EVENT, callback);
}

function meldeMitarbeitendeAenderung() {
  window.dispatchEvent(new Event(MITARBEITENDE_EVENT));
}

function aufMitarbeitendeAenderungHoeren(callback) {
  window.addEventListener(MITARBEITENDE_EVENT, callback);
  return () => window.removeEventListener(MITARBEITENDE_EVENT, callback);
}

export {
  meldeAenderung, aufAenderungHoeren,
  meldeMandantenAenderung, aufMandantenAenderungHoeren,
  meldeMitarbeitendeAenderung, aufMitarbeitendeAenderungHoeren,
};
