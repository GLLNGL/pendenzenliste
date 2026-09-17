# Prompt für Claude Code: Pendenzenliste für Treuhandbüro

Kopiere den folgenden Text als ersten Prompt in Claude Code:

---

Erstelle mir eine Pendenzenliste-Applikation für meine Arbeit als Treuhänder. Ich verwalte ein Mandantenportfolio mit wiederkehrenden Aufgaben (MWST-Abrechnungen, Lohnläufe, Zahlungsläufe, Jahresabschlüsse) und einmaligen Pendenzen.

## Technischer Rahmen

- Lokale Single-User-Webapp, keine Cloud, keine Authentifizierung nötig
- Frontend: React mit Vite, sauberes, dichtes UI (Arbeitswerkzeug, kein Marketing-Look)
- Backend: Node.js mit Express
- Datenbank: SQLite (Datei lokal, einfach zu sichern)
- Sprache der Oberfläche: Deutsch (Schweiz), Datumsformat TT.MM.JJJJ, keine ß-Schreibung

## Datenmodell

**Mandant**: Name, Kürzel, aktiv/inaktiv, Notizen.

**Pendenz**: Titel (als konkrete Handlung formuliert), Mandant (optional, es gibt auch interne Pendenzen), Beschreibung, Fälligkeitsdatum, Priorität (Hoch/Mittel/Tief), Status (Offen / In Arbeit / Warte auf Kunde / Warte intern / Erledigt), Aufwandschätzung in Stunden (optional), Erstellungsdatum, Erledigungsdatum, Verweis auf Wiederkehr-Regel (falls automatisch erzeugt).

Beim Status "Warte auf Kunde" zusätzlich: Warte-seit-Datum und ein Wiedervorlage-Datum für das Nachfassen.

**Wiederkehr-Regel**: Titel-Vorlage (mit Platzhaltern wie {Monat}, {Quartal}, {Jahr}), Mandant, Rhythmus (monatlich / quartalsweise / halbjährlich / jährlich), Fälligkeitslogik (z.B. "letzter Tag des Folgemonats", "60 Tage nach Quartalsende" – typisch für MWST), Vorlaufzeit in Tagen (wie viele Tage vor Fälligkeit die Pendenz erscheinen soll), aktiv/inaktiv.

Die App erzeugt beim Start (und einmal täglich) automatisch alle fälligen Pendenzen aus den Wiederkehr-Regeln. Keine Duplikate: Pro Regel und Periode darf nur eine Pendenz existieren, auch wenn die Erzeugung mehrfach läuft (Idempotenz über Regel-ID + Periodenschlüssel).

## Ansichten

1. **Heute/Cockpit** (Startansicht): Überfällige Pendenzen zuoberst (rot markiert), dann heute fällig, dann die nächsten 7 Tage. Zusätzlich ein Block "Nachfassen": alle "Warte auf Kunde"-Pendenzen, deren Wiedervorlage-Datum erreicht ist.
2. **Mandantenansicht**: Pro Mandant alle offenen Pendenzen gruppiert nach Status, mit Zähler (z.B. "Müller AG: 3 offen, 1 wartet").
3. **Alle Pendenzen**: Filterbar nach Status, Mandant, Priorität, Zeitraum; sortierbar nach Fälligkeit. Volltextsuche über Titel und Beschreibung.
4. **Wiederkehr-Regeln**: Verwaltung der Regeln, mit Vorschau der nächsten 3 zu erzeugenden Pendenzen pro Regel.
5. **Archiv**: Erledigte Pendenzen bleiben erhalten (nicht löschen!), filterbar nach Mandant und Zeitraum – für Rückfragen und Leistungsnachvollzug.

## Bedienung

- Schnellerfassung: Von überall mit einem Klick oder Tastenkürzel (n) eine neue Pendenz erfassen; Minimalfelder Titel + Fälligkeit reichen, Rest optional.
- Status ändern und Abhaken direkt in der Liste ohne Detailansicht (Ein-Klick-Aktionen).
- Beim Abhaken automatisch Erledigungsdatum setzen.
- Tastaturfreundlich: Pfeiltasten zur Navigation, Enter für Detail, Leertaste zum Abhaken.

## Startdaten (Seed)

Lege 4 Beispielmandanten an und sinnvolle Wiederkehr-Regeln dazu, z.B.:
- MWST-Abrechnung quartalsweise (Fälligkeit 60 Tage nach Quartalsende, Vorlauf 30 Tage)
- Lohnlauf monatlich (Fälligkeit 25. des Monats, Vorlauf 7 Tage)
- Zahlungslauf zweimal monatlich, falls machbar, sonst monatlich
- Jahresabschluss jährlich (Fälligkeit 30.06. des Folgejahres, Vorlauf 120 Tage)

Dazu einige Beispiel-Pendenzen in verschiedenen Status, inkl. einer überfälligen und einer mit "Warte auf Kunde".

## Vorgehen

Arbeite in dieser Reihenfolge und zeige mir nach jedem Schritt kurz den Stand:
1. Projektstruktur, Datenbank-Schema und Seed-Daten
2. Backend-API (CRUD für Mandanten, Pendenzen, Regeln + Erzeugungslogik mit Tests für die Idempotenz und die Fälligkeitslogik)
3. Frontend-Ansichten in der Reihenfolge Cockpit → Alle Pendenzen → Mandanten → Regeln → Archiv
4. Feinschliff: Tastenkürzel, Schnellerfassung, überfällig-Markierung

Schreibe für die Wiederkehr-Logik Unit-Tests, insbesondere für Quartals- und Jahreswechsel sowie Monatsenden (z.B. Regel "letzter Tag des Monats" im Februar).

---

## Hinweise zur Verwendung

- **Tech-Stack anpassen**: Falls du lieber etwas anderes willst (z.B. eine reine Desktop-App mit Tauri/Electron oder denselben Stack wie dein CrossFit Tracker), ersetze den Abschnitt "Technischer Rahmen" entsprechend.
- **Schrittweise arbeiten**: Der Abschnitt "Vorgehen" sorgt dafür, dass Claude Code nicht alles auf einmal baut. Prüfe nach Schritt 1 das Datenmodell, bevor es weitergeht – dort sind Korrekturen am billigsten.
- **Später erweiterbar**: E-Mail-Erinnerungen, Zeiterfassung pro Pendenz oder ein Import aus deinem bestehenden Excel-System kannst du in Folge-Prompts ergänzen. Erst das Fundament stabil bauen.
