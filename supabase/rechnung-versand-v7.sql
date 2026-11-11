-- ==========================================================================
-- Debitorenrechnungen per E-Mail (v7). Mehrfach ausfuehrbar.
-- Versand merken (wann, an wen) und Standardtext der Rechnungs-Mail.
-- ==========================================================================
alter table public.belege add column if not exists versendet_am timestamptz;
alter table public.belege add column if not exists versendet_an text;

insert into public.buero_einstellungen (schluessel, wert) values
  ('rechnung', jsonb_build_object(
    'mailBetreff', 'Rechnung {nummer} – {firma}',
    'mailText', E'Guten Tag {ansprechperson}\n\nBesten Dank für Ihren Auftrag. Im Anhang erhalten Sie unsere Rechnung {nummer} vom {datum} über {waehrung} {betrag}.\n\nWir bitten Sie, den Betrag bis am {faelligkeit} zu überweisen. Für Fragen stehen wir Ihnen gerne zur Verfügung.'))
on conflict (schluessel) do nothing;
