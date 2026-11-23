# Pokerabend

Webanwendung für unseren Pokerabend: Zusagen, Essensabstimmung, Mitbringliste, Ergebnisse und Statistik.

- **Frontend:** statisches HTML/CSS/JavaScript ohne Build-Schritt, gehostet auf GitHub Pages
- **Backend:** Supabase (Postgres, Login, Row Level Security)
- **Rechte:** Jeder registriert sich selbst, der Admin schaltet frei. Nur der Admin legt Abende, Essensoptionen und Mitbring-Positionen an und trägt Ergebnisse ein.

## Funktionen

| Bereich | Wer | Was |
|---|---|---|
| Teilnahme | alle | Dabei / Vielleicht / Abgesagt, Übersicht inkl. „Keine Antwort“ |
| Essen | Admin legt Optionen an, alle stimmen ab | eine Stimme pro Person, änderbar; die letzten 3 Plätze werden als Essenskäufer angezeigt |
| Mitbringen | Admin legt Positionen an | wer zuerst „Bringe ich mit“ drückt, blockiert die Position; eigene kann man wieder abgeben |
| Ergebnis | Admin | vollständige Platzierung per Sortierliste, vorbelegt mit allen Zusagen |
| Statistik | alle | Siege, Top 3, Ø-Platz, Siegquote, Essenskäufe, Rekorde, Verlauf, Filter nach Jahr |
| Abend abschließen | Admin | danach sind keine Zusagen, Stimmen oder Mitbring-Änderungen mehr möglich |

## Einrichtung (ca. 15 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf https://supabase.com kostenlos registrieren und **New project** anlegen.
   Als Region **Frankfurt (eu-central-1)** wählen, damit die Daten in der EU liegen.
2. Im Projekt **SQL Editor → New query** öffnen, den kompletten Inhalt von `supabase/schema.sql` einfügen und **Run** drücken.

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
- **Anzahl der Essenskäufer** ändern: `FOOD_BUYERS` in `js/config.js`.

## Sicherheit

- Alle Tabellen haben Row Level Security. Nicht freigeschaltete Accounts sehen nur ihr eigenes Profil.
- Niemand kann sich selbst freischalten oder zum Admin machen (Trigger `protect_profile_fields`).
- Mitbring-Positionen werden nur über die Funktionen `claim_item`/`release_item` vergeben; das ist atomar, doppelte Vergabe ist ausgeschlossen.
- Das Frontend setzt alle Texte per `textContent` (kein `innerHTML`) und hat eine Content-Security-Policy, die nur eigene Skripte und Verbindungen zu `*.supabase.co` zulässt.
- `vendor/supabase.js` ist supabase-js 2.119.2, lokal eingebunden statt über ein CDN.
- Keine externen Schriftarten oder Tracker.

## Struktur

```
index.html            Einstieg, CSP
css/style.css         Design
js/config.js          Supabase-URL und Key
js/app.js             Routing, Login-Status
js/views/*.js         Ansichten (Login, Abende, Abend, Statistik, Admin, Profil)
supabase/schema.sql   Datenbank, Rechte, Funktionen
vendor/supabase.js    Supabase-Client
```
