# Pokerabend

Webanwendung für unseren Pokerabend: Zusagen, Essensabstimmung, Mitbringliste, Ergebnisse und Statistik.

- **Frontend:** statisches HTML/CSS/JavaScript ohne Build-Schritt, gehostet auf GitHub Pages
- **Backend:** Supabase (Postgres, Login, Row Level Security)
- **Rechte:** Jeder registriert sich selbst, der Admin schaltet frei. Nur der Admin legt Abende, Essensoptionen und Mitbring-Positionen an und trägt Ergebnisse ein.

## Funktionen

| Bereich | Wer | Was |
|---|---|---|
| Termine | automatisch | jeden Freitag 19:00 Uhr bei Vito, angelegt bis Ende 2027; der Admin kann einzelne Termine verschieben oder löschen |
| Frist | automatisch | alle Abstimmungen schließen am Spieltag um 10:00 Uhr (in der Datenbank erzwungen) |
| Teilnahme | alle | Dabei / Vielleicht / Abgesagt |
| Essen | nur wer „Dabei“ ist | je 0–2 Adana und 0–2 Wurst; Einkaufsliste mit Summen für die Essenskäufer |
| Mitbringen | alle | Cola, Wasser, Körner, Gummibärchen, Chips (wer zuerst zugreift) + Sonstiges mit Freitext |
| Platzierung | Admin, erst ab Beginn des Abends | vollständige Reihenfolge; die letzten 3 kaufen Essen |
| Statistik | alle | Siege, Essenskäufe, Ø-Platz, Rekorde, Verlauf, Filter nach Jahr; ältere Abende mit Sieger/Verlierer zählen mit |
| Spieler | Admin | Spieler gibt es auch ohne Account; beim Freischalten wird ein Account einem Spieler zugeordnet |
| Korrekturen | Admin | Zusagen und Essen kann der Admin auch nach der Frist ändern |
| Profilbilder | alle (eigenes), Admin (alle) | Upload im Profil, Anzeige in Listen, Platzierung und Statistik |

## Update auf Version 3 (Profilbilder)

1. Den Inhalt von `supabase/update_v3.sql` im Supabase **SQL Editor** ausführen. Alle bisherigen Daten bleiben erhalten. Das Skript legt den öffentlichen Speicher `avatars` mit Zugriffsregeln an.
2. Alle Dateien ins GitHub-Repo hochladen und vorhandene überschreiben, darunter die neue Datei `js/avatar.js`.
3. Die Seite in einem privaten Fenster öffnen oder mit Strg+F5 neu laden.

Profilbilder lädt jeder unter **Profil** hoch. Als Admin kannst du unter **Admin → Spieler** auch Spielern ohne Account ein Bild geben. Die Bilder werden im Browser auf 256×256 Pixel verkleinert und neu kodiert, dabei fallen Metadaten wie Standortdaten weg. Ein Bild ist über seinen Link ohne Login abrufbar; der Link ist aber nicht zu erraten.

## Update von Version 1 auf Version 2

1. Den Inhalt von `supabase/update_v2.sql` im Supabase **SQL Editor** ausführen. Abende, Abstimmungen und Ergebnisse aus Version 1 werden ersetzt, die Accounts bleiben erhalten. Dein Admin-Account wird automatisch dem Spieler „Mo“ zugeordnet.
2. Alle Dateien ins GitHub-Repo hochladen und vorhandene Dateien überschreiben.
3. Die Seite in einem privaten Fenster öffnen oder mit Strg+F5 neu laden.

## Einrichtung (ca. 15 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf https://supabase.com kostenlos registrieren und **New project** anlegen.
   Als Region **Frankfurt (eu-central-1)** wählen, damit die Daten in der EU liegen.
2. Im Projekt **SQL Editor → New query** öffnen, den kompletten Inhalt von `supabase/schema.sql` einfügen (nur bei Neuinstallation) und **Run** drücken.

### 2. Login konfigurieren
Unter **Authentication → Sign In / Providers → Email**:
- Email-Provider aktiv, **Confirm email** an (Standard)
- Mindestlänge Passwort auf 8 setzen

Unter **Authentication → URL Configuration**:
- **Site URL:** `https://mobsat.github.io/pokerabend/`
- **Redirect URLs:** `https://mobsat.github.io/pokerabend/` hinzufügen

Optional: Unter **Authentication → Emails** die Texte der Bestätigungs- und Passwort-Mails auf Deutsch umschreiben.

### 3. Schlüssel eintragen
Unter **Project Settings → API Keys** die Project-URL und den **Publishable Key** (bei älteren Projekten „anon public“) kopieren und in `js/config.js` eintragen.

> Der Publishable-Key ist für den Browser gedacht und darf im öffentlichen Repo stehen. Der Schutz der Daten läuft über die Row Level Security in der Datenbank.
> **Niemals** den `service_role`- bzw. Secret-Key eintragen.

### 4. Auf GitHub Pages veröffentlichen
1. Auf GitHub ein öffentliches Repo `pokerabend` unter `mobsat` anlegen.
2. Den Projektordner hochladen:
   ```bash
   cd pokerabend
   git init && git add . && git commit -m "Pokerabend"
   git branch -M main
   git remote add origin https://github.com/mobsat/pokerabend.git
   git push -u origin main
   ```
3. Im Repo **Settings → Pages → Source: Deploy from a branch**, Branch `main`, Ordner `/ (root)`.
4. Nach etwa einer Minute ist die App unter `https://mobsat.github.io/pokerabend/` erreichbar.

### 5. Dich zum Admin machen
1. In der App registrieren und den Link in der Bestätigungsmail anklicken.
2. Im Supabase **SQL Editor** ausführen (eigene Adresse einsetzen):
   ```sql
   update public.profiles
      set is_admin = true, approved = true
    where id = (select id from auth.users where email = 'deine@mail.de');
   ```
3. In der App auf „Erneut prüfen“ klicken.

### 6. Freunde einladen
Link in die Gruppe schicken. Jeder registriert sich, bestätigt seine Mail und du schaltest ihn unter **Admin** frei.

## Wichtig zu wissen

- **Mail-Limit:** Supabase verschickt Mails im Free-Plan über einen eigenen Server mit sehr niedrigem Stundenlimit. Wenn sich alle zehn gleichzeitig registrieren, kommen manche Bestätigungsmails eventuell erst später an. Abhilfe: unter **Authentication → Emails → SMTP Settings** einen eigenen Mailserver eintragen (z. B. ein Brevo-Gratiskonto) oder die Registrierungen über ein paar Stunden verteilen.
- **Pausierung:** Kostenlose Supabase-Projekte werden nach einer Woche ohne Aktivität pausiert. Bei regelmäßiger Nutzung passiert das nicht. Falls doch, im Dashboard auf **Restore** klicken; die Daten bleiben erhalten.
- **Account löschen:** im Supabase-Dashboard unter **Authentication → Users**. Dabei werden auch die Ergebnisse dieser Person entfernt. Wer nur nicht mehr mitspielen soll, wird besser unter **Admin** gesperrt, dann bleibt die Statistik erhalten.
- **Weitere Termine** (z. B. 2028) legst du im SQL Editor an:
  ```sql
  insert into public.evenings (starts_at)
  select (d::date + time '19:00') at time zone 'Europe/Berlin'
    from generate_series(date '2028-01-07', date '2028-12-29', interval '7 days') d;
  ```

## Sicherheit

- Alle Tabellen haben Row Level Security. Nicht freigeschaltete Accounts sehen nur ihr eigenes Profil.
- Niemand kann sich selbst freischalten oder zum Admin machen (Trigger `protect_profile_fields`).
- Feste Mitbring-Positionen sind pro Abend über einen eindeutigen Index geschützt, doppelte Vergabe ist ausgeschlossen.
- Frist, „Essen nur bei Zusage“ und „Platzierung erst ab Beginn“ werden in der Datenbank geprüft, nicht nur in der App.
- Das Frontend setzt alle Texte per `textContent` (kein `innerHTML`) und hat eine Content-Security-Policy, die nur eigene Skripte und Verbindungen zu `*.supabase.co` zulässt.
- `vendor/supabase.js` ist supabase-js 2.119.2, lokal eingebunden statt über ein CDN.
- Keine externen Schriftarten oder Tracker.

## Struktur

```
index.html            Einstieg, CSP
css/style.css         Design
js/config.js          Supabase-URL und Key
js/app.js             Routing, Login-Status
js/avatar.js          Profilbilder (Zuschnitt, Upload)
js/views/*.js         Ansichten (Login, Abende, Abend, Statistik, Admin, Profil)
supabase/schema.sql   Datenbank, Rechte, Funktionen
vendor/supabase.js    Supabase-Client
```
