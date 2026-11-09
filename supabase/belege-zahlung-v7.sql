-- ==========================================================================
-- Belege: Adresse, IBAN und Referenz (v7, Grundlage fuer den Zahlungslauf). Mehrfach ausfuehrbar.
-- ==========================================================================
alter table public.belege add column if not exists partner_adresse text;
alter table public.belege add column if not exists iban text;
alter table public.belege add column if not exists zahlungsreferenz text;
