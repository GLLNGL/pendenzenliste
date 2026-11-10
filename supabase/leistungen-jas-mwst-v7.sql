-- ==========================================================================
-- Leistungskatalog: Jahresabschluss, MWST und Steuern (v7). Mehrfach ausfuehrbar.
-- Quelle: Leistungskatalog_Angebot_nur JAS und MWST.xlsx -- Zeit pro Einheit x Ansatz
-- Buchhaltung (CHF 130/Std.). Quartal/Halbjahr gibt es als Turnus nicht: jaehrlich mit
-- Standardmenge 4 bzw. 2. Die JAS-Positionen erscheinen in der Offerte als eine Zeile
-- "Jahresabschluss", die MWST-Varianten als "MWST".
-- ==========================================================================
alter table public.leistungen add column if not exists standard_menge numeric(10,2) check (standard_menge is null or standard_menge >= 0);

-- Kuerzel JAS fuer Jahresabschluss: bereits angelegte "JA – …"-Leistungen umbenennen.
update public.leistungen set name = 'JAS – ' || substr(name, 6)
  where name like 'JA – %'
    and not exists (select 1 from public.leistungen l2 where l2.name = 'JAS – ' || substr(public.leistungen.name, 6));

do $$
declare
  ansatz_id bigint := coalesce(
    (select id from public.stundenansaetze where name ilike 'Buchhaltung%' order by id limit 1),
    (select id from public.stundenansaetze where ist_standard limit 1));
begin
  insert into public.leistungen (reihenfolge, name, einheit, turnus, preis_art, minuten_pro_einheit, stundenansatz_id, angebot_gruppe, standard_menge, hinweis)
  select v.reihenfolge, v.name, v.einheit, 'jaehrlich', 'zeit', v.minuten, ansatz_id, v.gruppe, v.menge, v.hinweis
  from (values
    (14, 'MWST-Abrechnung effektiv (Standard)', 'Abrechnung', 120, 'MWST', 4::numeric,
      'Pro Quartal (Menge 4). Ein Steuersatz, wenige Belege (etwa unter 300 Rechnungen pro Quartal).'),
    (15, 'MWST-Abrechnung effektiv (komplex)', 'Abrechnung', 180, 'MWST', 4::numeric,
      'Pro Quartal (Menge 4). Mehrere Steuersätze, viele Belege, Bezugsteuer oder Korrekturen.'),
    (16, 'MWST-Abrechnung Saldosteuersatz', 'Abrechnung', 60, 'MWST', 2::numeric,
      'Pro Halbjahr (Menge 2).'),
    (17, 'JAS – Kontenabstimmungen', 'Std.', 60, 'Jahresabschluss', null,
      'Menge = geschätzte Stunden für den Kunden.'),
    (18, 'JAS – Lohnabstimmung (AHV, BVG, UVG, KTG)', 'Std.', 60, 'Jahresabschluss', null,
      'Menge = geschätzte Stunden für den Kunden.'),
    (19, 'JAS – Abschlussbuchungen (Abgrenzungen, Abschreibungen, Rückstellungen)', 'Std.', 60, 'Jahresabschluss', null,
      'Menge = geschätzte Stunden für den Kunden.'),
    (20, 'JAS – Jahresrechnung und Anhang', 'Std.', 60, 'Jahresabschluss', null,
      'Menge = geschätzte Stunden für den Kunden.'),
    (21, 'JAS – Mandatsbetreuung und Rückfragen', 'Std.', 60, 'Jahresabschluss', null,
      'Menge = geschätzte Stunden für den Kunden.'),
    (22, 'Steuererklärung juristische Person', 'Pauschale', 240, null, 1::numeric,
      '4 Std. à Ansatz Buchhaltung, einmal pro Jahr.')
  ) as v(reihenfolge, name, einheit, minuten, gruppe, menge, hinweis)
  where not exists (select 1 from public.leistungen l where l.name = v.name);
end $$;
