const STATUS_WERTE = ['Offen', 'In Arbeit', 'Warte auf Kunde', 'Warte intern', 'Erledigt'];
const OFFENE_STATUS = ['Offen', 'In Arbeit', 'Warte auf Kunde', 'Warte intern'];
const PRIORITAETEN = ['Hoch', 'Mittel', 'Tief'];

// Frueher per GET /api/meta vom Server geliefert (aus backend/src/recurrence.js) -- da rein
// statisch, jetzt direkt als Konstante im Frontend statt eines Netzwerk-Aufrufs.
const RHYTHMEN = ['monatlich', 'quartalsweise', 'halbjaehrlich', 'jaehrlich'];
const FAELLIGKEIT_TYPEN = [
  { typ: 'tag_des_monats', label: 'Tag des Monats', felder: ['tag'] },
  { typ: 'letzter_tag_des_monats', label: 'Letzter Tag des Monats', felder: [] },
  { typ: 'tage_nach_periodenende', label: 'X Tage nach Periodenende', felder: ['tage'] },
  { typ: 'tag_monat_folgejahr', label: 'Tag/Monat (mit Jahresversatz)', felder: ['tag', 'monat', 'jahre_offset'] },
  { typ: 'tage_des_monats_liste', label: 'Mehrere Tage im Monat', felder: ['tage'] },
];

function statusSlug(status) {
  return status.toLowerCase().replaceAll(' ', '-');
}

export { STATUS_WERTE, OFFENE_STATUS, PRIORITAETEN, RHYTHMEN, FAELLIGKEIT_TYPEN, statusSlug };
