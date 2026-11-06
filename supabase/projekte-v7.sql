-- Nur der neue Abschnitt aus schema.sql (Projekte mit Teilschritten). Mehrfach ausfuehrbar.

-- ==========================================================================
-- Projekte mit Teilschritten (v7): Verrechnung des Projekts (Standard Pauschal, sonst Extra) --
-- gilt fuer die erfasste Zeit seiner Teilschritte. Aufwand frei in Minuten (Teilschritte
-- summieren sich zum Projekt), nicht mehr nur 15/30/60/120.
-- ==========================================================================
alter table public.pendenzen add column if not exists verrechnung text not null default 'pauschal'
  check (verrechnung in ('pauschal', 'extra'));
alter table public.pendenzen drop constraint if exists pendenzen_aufwand_minuten_check;
alter table public.pendenzen add constraint pendenzen_aufwand_minuten_check
  check (aufwand_minuten is null or (aufwand_minuten > 0 and aufwand_minuten <= 6000));
alter table public.wiederkehr_regeln drop constraint if exists wiederkehr_regeln_aufwand_minuten_check;
alter table public.wiederkehr_regeln add constraint wiederkehr_regeln_aufwand_minuten_check
  check (aufwand_minuten is null or (aufwand_minuten > 0 and aufwand_minuten <= 6000));
