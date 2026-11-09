-- ==========================================================================
-- "Zu planen" merken (v7). Mehrfach ausfuehrbar.
-- Wer eine abgelaufene Pendenz im Cockpit bewusst in den Ordner "Zu planen" legt, will sie
-- nicht mehr unter "Abgelaufen" sehen -- dieses Datum haelt das fest. Wird die Pendenz wieder
-- auf einen Tag gelegt, zaehlt der Bearbeitungstag.
-- ==========================================================================
alter table public.pendenzen add column if not exists zu_planen_seit date;

-- Der View liest p.* -- neu erstellen, damit die Spalte darin erscheint.

drop view if exists public.pendenzen_angereichert;

create view public.pendenzen_angereichert
with (security_invoker = true) as
select
  p.*,
  m.name as mandant_name, m.kuerzel as mandant_kuerzel, m.email as mandant_email,
  m.geschaeftsfuehrung_email as mandant_geschaeftsfuehrung_email,
  b.name as bearbeiter_name, b.email as bearbeiter_email,
  (select count(*) from public.pendenzen c where c.uebergeordnete_pendenz_id = p.id) as teilaufgaben_gesamt,
  (select count(*) from public.pendenzen c where c.uebergeordnete_pendenz_id = p.id and c.status = 'Erledigt') as teilaufgaben_erledigt,
  eltern.titel as eltern_titel,
  (select count(*) from public.pendenz_emails e where e.pendenz_id = p.id) as email_anzahl,
  (select max(e.gesendet_am) from public.pendenz_emails e where e.pendenz_id = p.id) as email_zuletzt_gesendet_am
from public.pendenzen p
left join public.mandanten m on m.id = p.mandant_id
left join public.mitarbeitende b on b.id = p.bearbeiter_id
left join public.pendenzen eltern on eltern.id = p.uebergeordnete_pendenz_id;

