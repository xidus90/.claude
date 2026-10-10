# Agent-Panel: andere Sitzungen anzeigen

Baut auf `2026-10-09-agent-panel-design.md` und
`2026-10-09-agent-panel-optik-design.md` auf.

## 1. Ziel

Das Panel zeigt nicht nur die eigene Sitzung, sondern auf Wunsch eine andere:
um parallel laufende Sitzungen (etwa einen Team-Lauf in einem anderen Tab oder
Terminal) mitzulesen und um abgeschlossene Sitzungen im Rückblick anzusehen.
Die Auswahl geschieht über ein Dropdown oben rechts.

**Erfolg:** Aus dem Dropdown lässt sich jede der 20 zuletzt aktiven Sitzungen
beider Konten wählen; das Panel zeigt dann deren Agents, Kosten, Tokens und
Zeit so, wie es die eigene Sitzung zeigt, nur ohne Live-Werte.

## 2. Festlegungen

- **Welche Sitzungen:** alle Projekte beider Konfigurationsordner
  (`~/.claude` bzw. `CLAUDE_CONFIG_DIR`, und `~/.claude-b`), die 20 mit der
  jüngsten Änderung am Transkript.
- **Läuft:** ein Transkript, das in den letzten 60 Sekunden geschrieben wurde.
  Ein echtes Live-Signal gibt es nur für die eigene Sitzung.
- **Sortierung:** laufende zuerst, dann nach letzter Aktivität absteigend.
- **Eintrag:** `● Titel · Projekt · vor 3 min` (● läuft, ○ nicht); eine
  Sitzung aus `~/.claude-b` bekommt `· b` angehängt.
- **Titel:** der Sitzungstitel der App (`custom-title`-Zeile, Feld
  `customTitle`); fehlt er oder lautet er „Untitled session“ / „New session“,
  der letzte Prompt (`last-prompt`), sonst die ersten acht Zeichen der ID.
  Gekürzt auf 60 Zeichen und von Steuerzeichen gesäubert (`tidy`).
- **Projekt:** der letzte Teil des Arbeitsordners (`cwd` aus dem Transkript);
  bei einem Worktree dessen Name.

## 3. Ansatz

Das Skript liefert auch die Liste (Ansatz A). Verworfen: der Hook liest die
Ordner selbst über `$.fs` (Dateilogik im Hook, `register.ts` bliebe nicht ohne
eigene Logik) und jede Sitzung der Liste vorab zusammenfassen (für Kosten im
Dropdown; bei 20 Sitzungen und Transkripten über 100 MB zu langsam).

## 4. Aufbau

### Skript (`cli/`)

| Datei | Aufgabe |
|---|---|
| `cli/sessions.ts` (neu) | `listSessions(configs, now, read)`: geht über `<config>/projects/*/*.jsonl` aller Ordner, nimmt die 20 Dateien mit der jüngsten Änderung, liest von jeder die ersten 16 KB und die letzten 64 KB (der Sitzungstitel kann am Anfang stehen) und daraus Titel, letzten Prompt und `cwd`. Ergebnis je Sitzung `{ id, config, project, title, cwd, lastAt, isLive }`. |
| `cli/summarize.ts` | Neuer Modus `--list --home <dir> --config <dir>`: listet die Sitzungen aus `--config` und aus jedem Ordner `.claude` oder `.claude-*` im Home, der ein `projects/` hat, und druckt sie als eine JSON-Zeile. Der bisherige Aufruf bleibt; für eine fremde Sitzung bekommt er deren ID, Konfigurationsordner und `cwd`. |

Die Dateien unter `subagents/` sind keine Sitzungen und fehlen in der Liste.

### Hook (`hooks/`)

| Datei | Aufgabe |
|---|---|
| `hooks/view.ts` | `sessionsOf(json)`: prüft die Ausgabe von `--list` auf Typen wie `summaryOf`. `sessionLabel(s, now)`: der Eintrag. `buildView` bekommt `foreign: { title } \| null`: bei einer fremden Sitzung Titel „Sitzung: <Titel>“, Hinweis „nur aus dem Transkript“, keine „gemeldet“-Werte, keine Warnung „Preistabelle prüfen“, Lauf-Status des Leads aus `isLive`. |
| `hooks/register.ts` | Zustand: Liste und gewählte Sitzung (Vorgabe „Diese Sitzung“). Lädt die Liste nur bei offenem Panel, beim Öffnen und dann alle 10 s. Der Takt fasst die gewählte Sitzung mit ihrer ID, ihrem Konfigurationsordner und ihrem `cwd` zusammen; `$.agent.list()` und `$.session.usage()` gelten nur für die eigene. Das `Select` (Schlüssel `session`) steht in einer eigenen Zeile unter dem Titel, rechtsbündig: Die Beschriftung einer gewählten Sitzung ist breiter als der Platz neben dem Titel. Der Titel im Eintrag wird auf 40 Zeichen gekürzt. Keine eigene Logik. |

Die Öffnungsregeln (Team-Start, Schwarm) gelten weiter nur für die eigene
Sitzung.

## 5. Fehler

- Ein unlesbarer Ordner oder eine unlesbare Datei beim Auflisten wird
  übersprungen, nicht gemeldet: Die Liste ist Bequemlichkeit, kein Befund.
- Kaputte JSON-Zeilen im gelesenen Ende werden übersprungen.
- Scheitert der Listenaufruf, bleibt die letzte gute Liste; beim ersten Aufruf
  enthält das Dropdown nur „Diese Sitzung“. Keine Warnzeile.
- Gibt es das gewählte Transkript nicht mehr, zeigt das Panel einen Hinweis
  und springt auf „Diese Sitzung“ zurück.
- Die Auswahl lebt so lange wie der Hook; nach einem Neuladen des Plugins steht
  sie wieder auf „Diese Sitzung“.

## 6. Tests

- **Node (`cli/sessions.ts`, 100 %):** Sortierung, Grenze 20, `isLive` an der
  60-s-Grenze, Titel-Rangfolge, „Untitled/New session“ als fehlender Titel,
  kaputte Zeilen, unlesbare Datei, `subagents/` ausgelassen, beide
  Konfigurationsordner, `cwd` aus dem Transkript, `main` mit `--list`.
- **Node (`hooks/view.ts`):** `sessionLabel` (●/○, `· b`, Kürzung, Zeit),
  `sessionsOf` mit falschen Typen, `buildView` mit `foreign`.
- **Kit:** `Select` in der Titelzeile und im schmalen Panel in eigener Zeile;
  eine Auswahl ruft das Skript mit ID, Konfigurationsordner und `cwd` der
  gewählten Sitzung; die Liste lädt nur bei offenem Panel; eine verschwundene
  Sitzung führt zurück auf „Diese Sitzung“.
