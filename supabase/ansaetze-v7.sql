-- Nur der neue Abschnitt aus schema.sql (Stundenansaetze nach Dienstleistungsart).
-- Idempotent: mehrfach ausfuehrbar, bestehende Zuordnungen bleiben erhalten.

-- ==========================================================================
-- Stundenansaetze nach Dienstleistungsart (v7): Buchhaltung 130 (Standard), Admin 90,
-- Controlling 220, CFO 250. Jede Leistung hat einen Zielansatz -- auch Festpreis-Leistungen
-- (dort nur fuer die Kalkulation: maximale Stunden = Betrag / Zielansatz). Ein Arbeitstag = 8 h.
-- Bestehende Ansaetze werden nur umbenannt, solange der neue Name noch nicht existiert;
-- vorhandene Zuordnungen bleiben erhalten.
-- ==========================================================================

do $$
declare
  buchhaltung_id bigint;
  admin_id       bigint;
  controlling_id bigint;
  cfo_id         bigint;
begin
  if not exists (select 1 from public.stundenansaetze where name = 'Buchhaltung') then
    update public.stundenansaetze set name = 'Buchhaltung' where name = 'Standard';
  end if;
  if not exists (select 1 from public.stundenansaetze where name = 'Admin') then
    update public.stundenansaetze set name = 'Admin' where name = 'Kreditoren/Debitoren';
  end if;
  insert into public.stundenansaetze (name, chf_pro_stunde, ist_standard)
    select 'Buchhaltung', 130, not exists (select 1 from public.stundenansaetze where ist_standard)
    where not exists (select 1 from public.stundenansaetze where name = 'Buchhaltung');
  insert into public.stundenansaetze (name, chf_pro_stunde) select 'Admin', 90
    where not exists (select 1 from public.stundenansaetze where name = 'Admin');
  insert into public.stundenansaetze (name, chf_pro_stunde) select 'Controlling', 220
    where not exists (select 1 from public.stundenansaetze where name = 'Controlling');
  insert into public.stundenansaetze (name, chf_pro_stunde) select 'CFO', 250
    where not exists (select 1 from public.stundenansaetze where name = 'CFO');

  select id into buchhaltung_id from public.stundenansaetze where name = 'Buchhaltung';
  select id into admin_id from public.stundenansaetze where name = 'Admin';
  select id into controlling_id from public.stundenansaetze where name = 'Controlling';
  select id into cfo_id from public.stundenansaetze where name = 'CFO';

  -- Zielansatz fuer Festpreis-Leistungen ohne Ansatz.
  update public.leistungen set stundenansatz_id = controlling_id
    where stundenansatz_id is null and name ~* '(budget|reporting|controlling)';
  update public.leistungen set stundenansatz_id = cfo_id
    where stundenansatz_id is null and name ~* 'cfo';
  update public.leistungen set stundenansatz_id = buchhaltung_id
    where stundenansatz_id is null;

  -- Neue Leistungen fuer Controlling und CFO-Mandate (nur falls noch nicht vorhanden).
  insert into public.leistungen (reihenfolge, name, einheit, turnus, preis_art, minuten_pro_einheit, stundenansatz_id, hinweis)
    select 11, 'Controlling', 'Std.', 'monatlich', 'zeit', 60, controlling_id, 'Controlling-Leistungen nach Aufwand'
    where not exists (select 1 from public.leistungen where name = 'Controlling');
  insert into public.leistungen (reihenfolge, name, einheit, turnus, preis_art, minuten_pro_einheit, stundenansatz_id, hinweis)
    select 12, 'CFO-Mandat', 'Std.', 'monatlich', 'zeit', 60, cfo_id, 'Externer CFO / Finanzleitung'
    where not exists (select 1 from public.leistungen where name = 'CFO-Mandat');
  insert into public.leistungen (reihenfolge, name, einheit, turnus, preis_art, minuten_pro_einheit, stundenansatz_id, hinweis)
    select 13, 'Administration', 'Std.', 'monatlich', 'zeit', 60, admin_id, 'Administrative Dienstleistungen'
    where not exists (select 1 from public.leistungen where name = 'Administration');
end $$;
