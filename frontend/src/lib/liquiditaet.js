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
 * Liquiditaetsplan in Perioden (Wochen ab Montag oder Monate), CHF.
 *   zufluss  = Debitoren: offen nach Faelligkeit, bezahlt nach Zahlungsdatum
 *   abfluss  = Kreditoren offen (nicht im Zahlungslauf) nach Faelligkeit
 *   ausgang  = Zahlungsausgaenge: Kreditoren bezahlt (Zahlungsdatum) oder im Zahlungslauf
 *              (Ausfuehrungsdatum) -- so zaehlt keine Rechnung doppelt.
 * Bewegungen bis heute nach dem Stichtag des Kontostands stehen in der Zeile "seit Kontostand";
 * fruehere stecken bereits im Kontostand. Ueberfaellige offene Rechnungen gelten als sofort.
 * @param belege   alle Belege
 * @param optionen { heute, start, perioden, einheit: 'woche' | 'monat', kontostandDatum, laeufe }
 */
function liquiditaetsplan(belege, { heute, start = 0, perioden = 12, einheit = 'woche', kontostandDatum = null, laeufe = [] }) {
  const laufDatum = new Map(laeufe.map((l) => [l.id, l.ausfuehrungsdatum]));
  const betrag = (b) => Number(b.betrag) || 0;
  const mitBetrag = belege.filter((b) => betrag(b));
  const chf = mitBetrag.filter((b) => (b.waehrung || 'CHF') === 'CHF');

  // Jede CHF-Bewegung einordnen: { art: 'zufluss'|'abfluss'|'ausgang', datum (null = ohne), betrag }
  const bewegungen = [];
  for (const b of chf) {
    if (b.art === 'debitor') {
      bewegungen.push({ art: 'zufluss', datum: b.bezahlt_am || b.faelligkeit || null, bezahlt: !!b.bezahlt_am, betrag: betrag(b) });
    } else if (b.bezahlt_am) {
      bewegungen.push({ art: 'ausgang', datum: b.bezahlt_am, bezahlt: true, betrag: betrag(b) });
    } else if (b.zahlungslauf_id && laufDatum.get(b.zahlungslauf_id)) {
      bewegungen.push({ art: 'ausgang', datum: laufDatum.get(b.zahlungslauf_id), bezahlt: true, betrag: betrag(b) });
    } else {
      bewegungen.push({ art: 'abfluss', datum: b.faelligkeit || null, bezahlt: false, betrag: betrag(b) });
    }
  }
  const summe = (liste, art) => liste.filter((x) => x.art === art).reduce((s, x) => s + x.betrag, 0);

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

  // Ausgefuehrte Zahlungen bis heute: nur nach dem Stichtag (sonst im Kontostand enthalten).
  // Ohne Stichtag gelten sie als enthalten.
  const seit = bewegungen.filter((x) => x.bezahlt && x.datum && x.datum <= heute && kontostandDatum && x.datum > kontostandDatum);
  const bezahltSeitStand = { zufluss: summe(seit, 'zufluss'), ausgang: summe(seit, 'ausgang'), anzahl: seit.length };
  // Offene, ueberfaellige Rechnungen: sofort.
  const ueber = bewegungen.filter((x) => !x.bezahlt && x.datum && x.datum < heute);
  const ueberfaellig = { zufluss: summe(ueber, 'zufluss'), abfluss: summe(ueber, 'abfluss') };

  let stand = Number(start) || 0;
  stand += bezahltSeitStand.zufluss - bezahltSeitStand.ausgang;
  const standNachBezahlt = stand;
  stand += ueberfaellig.zufluss - ueberfaellig.abfluss;
  const standNachUeberfaellig = stand;

  // Ausgefuehrte Zahlungen bis und mit heute sind oben erfasst; in die Perioden kommen nur
  // offene Rechnungen ab heute und Zahlungen mit kuenftigem Datum.
  const kuenftig = bewegungen.filter((x) => x.datum && (x.bezahlt ? x.datum > heute : x.datum >= heute));
  const zeilen = grenzen.map((g) => {
    const drin = kuenftig.filter((x) => x.datum >= g.von && x.datum <= g.bis);
    const zufluss = summe(drin, 'zufluss');
    const abfluss = summe(drin, 'abfluss');
    const ausgang = summe(drin, 'ausgang');
    const saldo = zufluss - abfluss - ausgang;
    stand += saldo;
    return { ...g, zufluss, abfluss, ausgang, saldo, stand, anzahl: drin.length };
  });

  const vorzeichen = (x) => (x.art === 'zufluss' ? x.betrag : -x.betrag);
  const ohneDatum = bewegungen.filter((x) => !x.datum).reduce((s, x) => s + vorzeichen(x), 0);
  const letzteBis = grenzen.at(-1)?.bis;
  const spaeter = kuenftig.filter((x) => letzteBis && x.datum > letzteBis).reduce((s, x) => s + vorzeichen(x), 0);
  const fremdwaehrung = mitBetrag.filter((b) => !b.bezahlt_am && (b.waehrung || 'CHF') !== 'CHF');
  const engpass = zeilen.find((z) => z.stand < 0) ?? null;
  return {
    zeilen, ueberfaellig, bezahltSeitStand, standNachBezahlt, standNachUeberfaellig, ohneDatum, spaeter, fremdwaehrung, engpass,
    tiefsterStand: Math.min(standNachBezahlt, standNachUeberfaellig, ...zeilen.map((z) => z.stand)),
  };
}

export { belegStatus, durchschnittFrist, liquiditaetsplan, tageZwischen, montag, plusTage };
