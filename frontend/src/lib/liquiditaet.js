// Buchhaltung (v7): Status der Belege und Liquiditaetsplan -- reine Funktionen mit Tests.
//   Zufluesse = offene Debitoren, Abfluesse = offene Kreditoren, je nach Faelligkeit.

function tageZwischen(a, b) {
  const t = (iso) => { const [j, m, d] = iso.split('-').map(Number); return Date.UTC(j, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

function plusTage(iso, tage) {
  const [j, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + tage)).toISOString().slice(0, 10);
}

function montag(iso) {
  const [j, m, d] = iso.split('-').map(Number);
  const tag = new Date(Date.UTC(j, m - 1, d)).getUTCDay();
  return plusTage(iso, -((tag + 6) % 7));
}

// 'bezahlt' | 'im_lauf' (in einem Zahlungslauf, noch nicht als bezahlt markiert) | 'ueberfaellig' | 'offen'
function belegStatus(b, heute) {
  if (b.bezahlt_am) return 'bezahlt';
  if (b.zahlungslauf_id) return 'im_lauf';
  if (b.faelligkeit && b.faelligkeit < heute) return 'ueberfaellig';
  return 'offen';
}

// Durchschnittliche Zahlungsfrist (Rechnungsdatum -> Faelligkeit) in Tagen, gewichtet nach Betrag.
function durchschnittFrist(belege) {
  let summe = 0;
  let gewicht = 0;
  for (const b of belege) {
    if (!b.rechnungsdatum || !b.faelligkeit) continue;
    const g = Math.abs(Number(b.betrag) || 0) || 1;
    summe += tageZwischen(b.rechnungsdatum, b.faelligkeit) * g;
    gewicht += g;
  }
  return gewicht ? Math.round(summe / gewicht) : null;
}

/**
 * Liquiditaetsplan in Perioden (Wochen ab Montag oder Monate).
 * @param belege   alle Belege (nur offene in CHF zaehlen; ohne Faelligkeit -> "ohne Datum")
 * @param optionen { heute, start (Kontostand), perioden, einheit: 'woche' | 'monat' }
 * @returns { zeilen: [{ label, von, bis, zufluss, abfluss, saldo, stand }], ueberfaellig, ohneDatum, fremdwaehrung }
 */
function liquiditaetsplan(belege, { heute, start = 0, perioden = 12, einheit = 'woche' }) {
  const offen = belege.filter((b) => !b.bezahlt_am && Number(b.betrag));
  const chf = offen.filter((b) => (b.waehrung || 'CHF') === 'CHF');
  const vorzeichen = (b) => (b.art === 'debitor' ? 1 : -1) * Number(b.betrag);

  const grenzen = [];
  if (einheit === 'monat') {
    const [j, m] = heute.split('-').map(Number);
    for (let i = 0; i < perioden; i += 1) {
      const von = new Date(Date.UTC(j, m - 1 + i, 1)).toISOString().slice(0, 10);
      const bis = new Date(Date.UTC(j, m + i, 0)).toISOString().slice(0, 10);
      grenzen.push({ von: i === 0 ? heute : von, bis, label: new Date(Date.UTC(j, m - 1 + i, 1)).toLocaleDateString('de-CH', { month: 'short', year: 'numeric', timeZone: 'UTC' }) });
    }
  } else {
    const mo = montag(heute);
    for (let i = 0; i < perioden; i += 1) {
      const von = plusTage(mo, i * 7);
      const bis = plusTage(von, 6);
      const [, mm, dd] = von.split('-');
      grenzen.push({ von: i === 0 ? heute : von, bis, label: `KW ab ${dd}.${mm}.` });
    }
  }

  // Ueberfaellige (Faelligkeit vor heute) gelten als sofort -- sie stehen in einer eigenen Zeile vorne.
  const ueberfaelligeBelege = chf.filter((b) => b.faelligkeit && b.faelligkeit < heute);
  const ueberfaellig = {
    zufluss: ueberfaelligeBelege.filter((b) => b.art === 'debitor').reduce((s, b) => s + Number(b.betrag), 0),
    abfluss: ueberfaelligeBelege.filter((b) => b.art === 'kreditor').reduce((s, b) => s + Number(b.betrag), 0),
  };
  let stand = Number(start) || 0;
  stand += ueberfaellig.zufluss - ueberfaellig.abfluss;
  const standNachUeberfaellig = stand;

  const zeilen = grenzen.map((g) => {
    const drin = chf.filter((b) => b.faelligkeit && b.faelligkeit >= g.von && b.faelligkeit <= g.bis && b.faelligkeit >= heute);
    const zufluss = drin.filter((b) => b.art === 'debitor').reduce((s, b) => s + Number(b.betrag), 0);
    const abfluss = drin.filter((b) => b.art === 'kreditor').reduce((s, b) => s + Number(b.betrag), 0);
    stand += zufluss - abfluss;
    return { ...g, zufluss, abfluss, saldo: zufluss - abfluss, stand, anzahl: drin.length };
  });

  const ohneDatum = chf.filter((b) => !b.faelligkeit).reduce((s, b) => s + vorzeichen(b), 0);
  const fremdwaehrung = offen.filter((b) => (b.waehrung || 'CHF') !== 'CHF');
  const letzteBis = grenzen.at(-1)?.bis;
  const spaeter = chf.filter((b) => b.faelligkeit && letzteBis && b.faelligkeit > letzteBis).reduce((s, b) => s + vorzeichen(b), 0);
  return { zeilen, ueberfaellig, standNachUeberfaellig, ohneDatum, spaeter, fremdwaehrung, tiefsterStand: Math.min(standNachUeberfaellig, ...zeilen.map((z) => z.stand)) };
}

export { belegStatus, durchschnittFrist, liquiditaetsplan, tageZwischen, montag, plusTage };
