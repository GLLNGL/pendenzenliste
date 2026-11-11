-- ==========================================================================
-- Standardtext der Rechnungs-Mail (Debitoren) setzen. Ueberschreibt einen vorhandenen Text --
-- nur einmal ausfuehren; spaeter in der App unter Debitoren › «Rechnungstext» aendern.
-- Platzhalter: {nummer} {datum} {faelligkeit} {betrag} {waehrung} {debitor} {ansprechperson} {firma}
-- ==========================================================================
insert into public.buero_einstellungen (schluessel, wert) values
  ('rechnung', jsonb_build_object(
    'mailBetreff', 'Rechnung {nummer} – {firma}',
    'mailText', E'Guten Tag {ansprechperson}\n\nIm Anhang erhalten Sie unsere Rechnung Nr. {nummer} vom {datum} über {waehrung} {betrag}.\n\nWir bitten Sie, den Betrag innert 10 Tagen mit dem beiliegenden QR-Einzahlungsschein zu überweisen. Bitte verwenden Sie für die Zahlung die angegebene QR-Referenz, damit wir Ihre Zahlung korrekt zuordnen können.\n\nBei Fragen zur Rechnung stehen wir Ihnen gerne zur Verfügung.'))
on conflict (schluessel) do update set wert = excluded.wert, geaendert_am = now();
