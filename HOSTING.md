# Pendenzenliste auf einem Server betreiben (Cloud)

Damit die App läuft, ohne dass dein PC eingeschaltet sein muss, wird sie auf einem
Server im Internet betrieben. Diese Anleitung richtet sich an eine technisch versierte
Person (SSH, Kommandozeile). Rechne mit 30–60 Minuten.

Die App bringt alles Nötige mit: ein `Dockerfile`, eine `docker-compose.yml` und eine
`Caddyfile`. Caddy holt automatisch ein gültiges HTTPS-Zertifikat.

---

## Was du brauchst

- **Ein Server (VPS)** mit Ubuntu 22.04/24.04, mind. 1 GB RAM. Kleinste Grösse genügt.
- **Eine (Sub-)Domain**, z.B. `pendenzen.estcontrolling.ch` – du hast `estcontrolling.ch`,
  also nur einen DNS-Eintrag ergänzen.
- Datenschutz: Als Treuhänder gehören Mandantendaten in die **Schweiz oder EU**.
  Empfohlen: **cloudscale.ch** (Rechenzentren in Bern/Zürich) oder **Infomaniak** (Genf).
  Kosten ca. CHF 5–13 / Monat.

---

## Schritt 1 – Server erstellen (Beispiel cloudscale.ch)

1. Konto auf [cloudscale.ch](https://www.cloudscale.ch) erstellen.
2. „Server erstellen": Ubuntu 24.04, Flavor **Flex-4** (kleinste), Region Rma/Lpg.
3. Deinen SSH-Public-Key hinterlegen (oder das generierte Root-Passwort notieren).
4. Nach dem Start die **öffentliche IPv4-Adresse** notieren (z.B. `5.102.xxx.xxx`).

## Schritt 2 – DNS-Eintrag setzen

Beim Verwalter deiner Domain `estcontrolling.ch` (Hostpoint/Metanet o.ä.) einen
**A-Eintrag** anlegen:

```
pendenzen.estcontrolling.ch   A   5.102.xxx.xxx
```

Bis das weltweit greift, können ein paar Minuten bis Stunden vergehen.

## Schritt 3 – Auf den Server verbinden und Docker installieren

```bash
ssh root@5.102.xxx.xxx

# Docker installieren
curl -fsSL https://get.docker.com | sh
```

## Schritt 4 – Projekt auf den Server bringen

Den Projektordner `Pendenzenliste` (ohne `node_modules`, ohne `backend/data`,
ohne `backend/.env`) auf den Server kopieren, z.B. mit `scp` vom PC aus:

```bash
scp -r "Pendenzenliste" root@5.102.xxx.xxx:/opt/pendenzenliste
```

oder das Projekt in ein privates Git-Repository legen und auf dem Server klonen.

## Schritt 5 – Domain in der Caddyfile eintragen

Auf dem Server:

```bash
cd /opt/pendenzenliste
nano Caddyfile
```

Die Zeile `pendenzen.estcontrolling.ch {` auf deine tatsächliche (Sub-)Domain anpassen.

## Schritt 6 – Starten

```bash
docker compose up -d
docker compose logs -f      # zum Mitschauen; mit Strg+C beenden (App läuft weiter)
```

Nach ~30 Sekunden ist die App unter **https://pendenzen.estcontrolling.ch** erreichbar.
Caddy hat automatisch ein HTTPS-Zertifikat besorgt.

---

## Schritt 7 – Daten vom PC übernehmen

Deine bisherigen Mandanten, Regeln, Pendenzen und Logins liegen in einer einzigen Datei:
`backend/data/pendenzen.sqlite`.

1. **Auf dem PC**: Pendenzenliste öffnen, unter „Einstellungen" das SMTP-Passwort
   einmal neu eingeben und speichern (damit es mit in die Datei wandert). Danach die
   App schliessen (Node im Task-Manager beenden).
2. Die Datei auf den Server ins Volume kopieren:

```bash
# Container kurz stoppen
docker compose stop app

# Datei vom PC hochladen (vom PC aus ausführen)
scp "backend/data/pendenzen.sqlite" root@5.102.xxx.xxx:/tmp/pendenzen.sqlite

# Auf dem Server ins Volume schieben
docker run --rm -v pendenzenliste_pendenzen-daten:/data -v /tmp:/quelle alpine \
  sh -c "cp /quelle/pendenzen.sqlite /data/pendenzen.sqlite"

docker compose start app
```

Jetzt sind alle Daten und Logins (Angelo, Irina) auf dem Server. Anmelden wie gewohnt.

> Wenn du **neu anfangen** willst statt zu migrieren: Schritt 7 überspringen. Beim ersten
> Aufruf legst du über „Passwort festlegen" das erste Benutzerkonto an (Name + E-Mail + Passwort).

---

## Schritt 8 – Handy einrichten

Auf jedem iPhone in Safari `https://pendenzen.estcontrolling.ch` öffnen, anmelden,
dann Teilen-Symbol → **„Zum Home-Bildschirm"**. Die App liegt dann mit eigenem Icon
auf dem Handy und funktioniert von überall – der PC muss nicht mehr laufen.

Der bisherige PC-Start (Desktop-Icon) wird nicht mehr gebraucht. Du kannst ihn löschen
oder als Notfall-Backup behalten – dann arbeitest du aber mit einer getrennten Datenbank.

---

## Wartung

**Backup** (regelmässig, z.B. per Cronjob auf dem Server):

```bash
docker run --rm -v pendenzenliste_pendenzen-daten:/data -v /root/backups:/backup alpine \
  sh -c "cp /data/pendenzen.sqlite /backup/pendenzen-$(date +%F).sqlite"
```

**Update einspielen** (nach Code-Änderungen):

```bash
cd /opt/pendenzenliste
# neuen Code hochladen / git pull
docker compose up -d --build
```

**Logs ansehen:** `docker compose logs -f app`

---

## Alternative: Fly.io (einfacher, aber Server in Frankfurt)

Wenn Schweizer Hosting nicht zwingend ist: [Fly.io](https://fly.io) deployt das
`Dockerfile` mit wenigen Befehlen, inkl. HTTPS und persistentem Volume. Für vertrauliche
Mandantendaten ist ein Schweizer/EU-Server aber die sauberere Wahl.
