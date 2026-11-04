-- Test der Projekt-Logik (Etappe 2) -- im Supabase SQL-Editor ausführen, NACH schema.sql.
--
-- Legt ein Testprojekt mit drei Schritten an, prüft alle Regeln und bricht am Ende BEWUSST mit
-- einer Meldung ab. Dadurch wird alles zurückgerollt -- es bleibt nichts in der Datenbank.
--
-- Erwartetes Ergebnis: Fehlermeldung «TEST OK: alle 11 Prüfungen bestanden (alles
-- zurückgerollt)». Jede andere Meldung nennt die Prüfung, die fehlgeschlagen ist.

do $$
declare
  projekt  bigint;
  s1       bigint;
  s2       bigint;
  s3       bigint;
  st       text;
begin
  insert into public.pendenzen (titel, faelligkeit, prioritaet, status, block)
    values ('TEST Projekt', current_date + 30, 'B', 'Offen', 'Sonstiges') returning id into projekt;
  insert into public.pendenzen (titel, faelligkeit, uebergeordnete_pendenz_id)
    values ('TEST Schritt 1', current_date + 10, projekt) returning id into s1;
  insert into public.pendenzen (titel, faelligkeit, uebergeordnete_pendenz_id)
    values ('TEST Schritt 2', current_date + 20, projekt) returning id into s2;
  insert into public.pendenzen (titel, faelligkeit, uebergeordnete_pendenz_id)
    values ('TEST Schritt 3', current_date + 30, projekt) returning id into s3;

  -- 1. Reihenfolge automatisch 1, 2, 3
  if (select string_agg(reihenfolge::text, ',' order by id) from public.pendenzen where uebergeordnete_pendenz_id = projekt) <> '1,2,3' then
    raise exception 'FEHLER 1: Reihenfolge nicht automatisch 1,2,3';
  end if;

  -- 2. Nur der erste Schritt ist Offen, die weiteren Später
  if (select string_agg(status, ',' order by reihenfolge) from public.pendenzen where uebergeordnete_pendenz_id = projekt) <> 'Offen,Später,Später' then
    raise exception 'FEHLER 2: Erwartet Offen,Später,Später, erhalten %',
      (select string_agg(status, ',' order by reihenfolge) from public.pendenzen where uebergeordnete_pendenz_id = projekt);
  end if;

  -- 3. Schritt 1 erledigt -> Schritt 2 wird Offen, Schritt 3 bleibt Später
  update public.pendenzen set status = 'Erledigt', erledigt_am = current_date where id = s1;
  if (select string_agg(status, ',' order by reihenfolge) from public.pendenzen where uebergeordnete_pendenz_id = projekt) <> 'Erledigt,Offen,Später' then
    raise exception 'FEHLER 3: Nach Erledigen von Schritt 1 erwartet Erledigt,Offen,Später, erhalten %',
      (select string_agg(status, ',' order by reihenfolge) from public.pendenzen where uebergeordnete_pendenz_id = projekt);
  end if;

  -- 4. Schritt 2 in Arbeit -> Projekt In Arbeit
  update public.pendenzen set status = 'In Arbeit' where id = s2;
  select status into st from public.pendenzen where id = projekt;
  if st <> 'In Arbeit' then raise exception 'FEHLER 4: Projekt sollte In Arbeit sein, ist %', st; end if;

  -- 5. Gewöhnliches Speichern des Projekts (Titel) setzt die Schritte NICHT zurück
  update public.pendenzen set titel = 'TEST Projekt umbenannt', prioritaet = 'A' where id = projekt;
  select status into st from public.pendenzen where id = s2;
  if st <> 'In Arbeit' then raise exception 'FEHLER 5: Schritt 2 wurde durch Speichern des Projekts zurückgesetzt (%)', st; end if;

  -- 6. Alle Schritte erledigt -> Projekt Erledigt
  update public.pendenzen set status = 'Erledigt', erledigt_am = current_date where id in (s2, s3);
  select status into st from public.pendenzen where id = projekt;
  if st <> 'Erledigt' then raise exception 'FEHLER 6: Projekt sollte Erledigt sein, ist %', st; end if;

  -- 7. Projekt wieder öffnen -> Schritte beginnen von vorne (Offen, Später, Später)
  update public.pendenzen set status = 'Offen', erledigt_am = null where id = projekt;
  if (select string_agg(status, ',' order by reihenfolge) from public.pendenzen where uebergeordnete_pendenz_id = projekt) <> 'Offen,Später,Später' then
    raise exception 'FEHLER 7: Nach Wiedereröffnen erwartet Offen,Später,Später, erhalten %',
      (select string_agg(status, ',' order by reihenfolge) from public.pendenzen where uebergeordnete_pendenz_id = projekt);
  end if;

  -- 8. Reihenfolge tauschen (Schritt 3 nach vorne) -> Schritt 3 wird aktiv
  update public.pendenzen set reihenfolge = 0 where id = s3;
  if (select status from public.pendenzen where id = s3) <> 'Offen'
     or (select status from public.pendenzen where id = s1) <> 'Später' then
    raise exception 'FEHLER 8: Nach Vorziehen von Schritt 3 sollte er Offen und Schritt 1 Später sein';
  end if;

  -- 9. Projekt direkt erledigt -> alle Schritte erledigt
  update public.pendenzen set status = 'Erledigt', erledigt_am = current_date where id = projekt;
  if exists (select 1 from public.pendenzen where uebergeordnete_pendenz_id = projekt and status <> 'Erledigt') then
    raise exception 'FEHLER 9: Nicht alle Schritte wurden mit dem Projekt erledigt';
  end if;

  -- 10. «Warten auf» ohne Person/Nachfassdatum ist nicht speicherbar
  begin
    update public.pendenzen set status = 'Warten auf' where id = s1;
    raise exception 'FEHLER 10: «Warten auf» ohne Person wurde gespeichert';
  exception when check_violation then
    null; -- erwartet
  end;

  -- 11. «Warten auf» mit Person + Nachfassdatum geht
  update public.pendenzen set status = 'Warten auf', warten_auf_person = 'Test', wiedervorlage = current_date + 7 where id = s1;

  raise exception 'TEST OK: alle 11 Prüfungen bestanden (alles zurückgerollt)';
end $$;
