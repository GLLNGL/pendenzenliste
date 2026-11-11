-- ==========================================================================
-- Abstimmungen (v7): Datensatz "lohn_grundlagen" pro Mandant und Jahr fuer die eingelesene
-- Erfolgsrechnung (Konten-Saldi) und das Kumulativjournal (Totale pro Lohnart, keine
-- Personendaten). Wird von AHV, BVG, UVG und KTG gemeinsam genutzt. Mehrfach ausfuehrbar.
-- ==========================================================================
alter table public.abstimmungen drop constraint if exists abstimmungen_bereich_check;
alter table public.abstimmungen add constraint abstimmungen_bereich_check
  check (bereich in ('mwst', 'ahv', 'bvg', 'uvg', 'ktg', 'lohn_grundlagen'));
