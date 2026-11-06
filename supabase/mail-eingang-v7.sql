-- Nur der neue Abschnitt aus schema.sql (Auftraege per E-Mail). Mehrfach ausfuehrbar.

-- ==========================================================================
-- Auftraege per E-Mail (v7): Mails aus dem Outlook-Ordner "Auftraege" werden von der Edge
-- Function "mail-eingang" als Pendenz in den Eingang gelegt (geplant = false). Die Message-ID
-- verhindert, dass dieselbe Mail zweimal uebernommen wird.
-- ==========================================================================
alter table public.pendenzen add column if not exists email_message_id text;
alter table public.pendenzen add column if not exists email_von text;
create unique index if not exists idx_pendenzen_email_message_id on public.pendenzen (email_message_id) where email_message_id is not null;
