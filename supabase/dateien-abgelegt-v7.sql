-- ==========================================================================
-- Abgelegte Dateien nicht doppelt speichern (v7). Mehrfach ausfuehrbar.
-- Sobald eine Datei im OneDrive-Ordner des Mandanten liegt, wird sie aus dem Speicher der App
-- entfernt; die Zeile bleibt als Nachweis (Dateiname, Datum, Ablageort).
-- ==========================================================================
alter table public.dateien add column if not exists abgelegt_in text;
alter table public.dateien alter column speicherpfad drop not null;
