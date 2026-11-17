-- Projektstatus von Hand setzen (v7)
--
-- Bisher leitete die Datenbank den Status eines Projekts bei jeder Aenderung eines Teilschritts
-- neu ab (alle erledigt -> Erledigt, einer in Arbeit -> In Arbeit, sonst Offen). Ein von Hand
-- gesetzter Status (z.B. "Warten auf" oder "Später") wurde dadurch beim naechsten Teilschritt
-- wieder ueberschrieben.
--
-- Neu bleibt der Status des Projekts, wie du ihn setzt. Automatisch angepasst wird er nur noch:
--   * alle Teilschritte erledigt         -> Projekt "Erledigt"
--   * Projekt "Erledigt", aber ein Teilschritt wieder offen -> "In Arbeit" bzw. "Offen"
--   * Projekt "Offen" und ein Teilschritt "In Arbeit"       -> Projekt "In Arbeit"
-- Der aktive Schritt (erster offener Offen, Rest Später) wird wie bisher nachgefuehrt.
--
-- Im Supabase SQL Editor ausfuehren. Aendert keine bestehenden Daten.

create or replace function public.projekt_nachfuehren(p_projekt bigint)
returns void as $$
declare
  aktiver_schritt     bigint;
  schritte_gesamt     integer;
  schritte_erledigt   integer;
  schritte_in_arbeit  integer;
  abgeleiteter_status text;
begin
  select id into aktiver_schritt
    from public.pendenzen
    where uebergeordnete_pendenz_id = p_projekt and status <> 'Erledigt'
    order by reihenfolge nulls last, id
    limit 1;

  if aktiver_schritt is not null then
    update public.pendenzen set status = 'Offen'
      where id = aktiver_schritt and status = 'Später';
    update public.pendenzen set status = 'Später'
      where uebergeordnete_pendenz_id = p_projekt and id <> aktiver_schritt and status = 'Offen';
  end if;

  select count(*), count(*) filter (where status = 'Erledigt'), count(*) filter (where status = 'In Arbeit')
    into schritte_gesamt, schritte_erledigt, schritte_in_arbeit
    from public.pendenzen
    where uebergeordnete_pendenz_id = p_projekt;

  if schritte_gesamt = 0 then
    return;
  end if;

  abgeleiteter_status := case
    when schritte_erledigt = schritte_gesamt then 'Erledigt'
    when schritte_in_arbeit > 0 then 'In Arbeit'
    else 'Offen'
  end;

  update public.pendenzen
    set status = abgeleiteter_status,
        erledigt_am = case when abgeleiteter_status = 'Erledigt' then coalesce(erledigt_am, current_date) else null end,
        warten_auf_person = null, wiedervorlage = null, warte_seit = null
    where id = p_projekt
      and status is distinct from abgeleiteter_status
      -- Von Hand gesetzter Status bleibt -- nur die drei Faelle oben passen ihn an.
      and (abgeleiteter_status = 'Erledigt'
           or status = 'Erledigt'
           or (status = 'Offen' and abgeleiteter_status = 'In Arbeit'));
end;
$$ language plpgsql;
