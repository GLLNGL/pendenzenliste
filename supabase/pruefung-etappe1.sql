-- Prüfabfrage nach Ausführen von schema.sql (Etappe 1 Arbeitsprozess). Rein lesend.
-- Im Supabase SQL-Editor ausführen; jede Zeile sollte in der Spalte "ok" true zeigen.
-- Erwartete Werte beziehen sich auf die Sicherung vom 04.11.2026 (52 Pendenzen,
-- 7x Hoch, 45x Mittel, 18 Teilaufgaben, 37 Pendenzen mit Aufwand).

select 'Anzahl Pendenzen unverändert (52)' as pruefung,
       count(*)::text as wert, count(*) = 52 as ok
  from public.pendenzen
union all
select 'Priorität A (vorher Hoch, 7)', count(*)::text, count(*) = 7
  from public.pendenzen where prioritaet = 'A'
union all
select 'Priorität B (vorher Mittel, 45)', count(*)::text, count(*) = 45
  from public.pendenzen where prioritaet = 'B'
union all
select 'Keine alten Prioritäten/Status mehr', count(*)::text, count(*) = 0
  from public.pendenzen
  where prioritaet not in ('A', 'B', 'C')
     or status not in ('Offen', 'In Arbeit', 'Warten auf', 'Später', 'Erledigt')
union all
select 'Status unverändert (27 Offen / 1 In Arbeit / 24 Erledigt)',
       string_agg(status || '=' || anzahl, ', ' order by status),
       string_agg(status || '=' || anzahl, ', ' order by status) = 'Erledigt=24, In Arbeit=1, Offen=27'
  from (select status, count(*) as anzahl from public.pendenzen group by status) s
union all
select 'Aufwand in Minuten übernommen (37)', count(*)::text, count(*) = 37
  from public.pendenzen where aufwand_minuten is not null
union all
select 'Alle Teilaufgaben haben eine Reihenfolge (18)', count(*)::text, count(*) = 18
  from public.pendenzen where uebergeordnete_pendenz_id is not null and reihenfolge is not null
union all
select 'Zuletzt geändert überall gesetzt', count(*)::text, count(*) = 0
  from public.pendenzen where zuletzt_geaendert_am is null
union all
select 'Block-Verteilung (zur Kontrolle)',
       string_agg(block || '=' || anzahl, ', ' order by block), true
  from (select block, count(*) as anzahl from public.pendenzen group by block) b
union all
select 'Mandanten unverändert (10)', count(*)::text, count(*) = 10
  from public.mandanten
union all
select 'Neue Mandanten-Spalten vorhanden', count(*)::text, count(*) = 5
  from information_schema.columns
  where table_schema = 'public' and table_name = 'mandanten'
    and column_name in ('mwst_periode', 'lohnzahltag', 'zahlungslauf_rhythmus', 'abschluss_wunsch_tag', 'abschluss_wunsch_monat')
union all
select 'Trigger "zuletzt geändert" aktiv', count(*)::text, count(*) = 1
  from pg_trigger where tgname = 'trg_pendenzen_zuletzt_geaendert' and tgenabled = 'O'
union all
select 'Status-Kaskade wieder eingeschaltet', count(*)::text, count(*) = 1
  from pg_trigger where tgname = 'trg_pendenzen_status_update' and tgenabled = 'O';
