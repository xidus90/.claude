# Agent-Panel: Optik

Stand: 2026-10-09. Status: Entwurf zur Freigabe. Baut auf
`2026-10-09-agent-panel-design.md` auf; was dort steht, gilt weiter, soweit
hier nichts anderes steht.

## 1. Ziel

Das Panel soll in der Desktop-App grafisch werden und im Terminal denselben
Aufbau bekommen, so weit das Terminal es kann. Die Entwürfe liegen unter
`.superpowers/brainstorm/242-1791577358/content/` (nicht versioniert);
maßgeblich sind `entwurf-v5.html`, `einklappen-v4.html` und `kostueme-v2.html`.

Was der Nutzer festgelegt hat:

- **Aufbau:** Summen als Kacheln, Token-Streifen, Status-Balken, Rollen als
  Karten mit Kostenbalken und je Agent einem Token-Streifen (Entwürfe A + C,
  Variante 1).
- **Desktop und Terminal:** beide bekommen den Aufbau (Antwort B).
- **Krabben:** im breiten Fenster eine Pixel-Krabbe in der Karte jeder Rolle,
  je Rolle ein eigenes Kostüm; läuft ein Agent der Rolle, läuft die Krabbe.
- **Einklappen:** Übersicht, Agents und jede Rolle einzeln; „Fertige
  ausblenden“, „Alle einklappen“, „Alle ausklappen“ rechtsbündig neben der
  Überschrift „Agents“.
- **Hell und dunkel:** das Panel folgt dem Theme von Claude Code, ohne eigenen
  Umschalter.
- **Effort** hinter dem Modell, **⏱** vor der Dauer jeder Agent-Zeile (nicht in
  der Kachel).
- **Automatisch öffnen** beim ersten Teammate eines Team-Laufs und wenn
  mindestens drei Agents innerhalb von 30 s starten — auch nachdem der Nutzer
  das Panel geschlossen hat.
- **Neue Rolle `browser-tester`** (browser-use / Playwright) bekommt ein
  Kostüm. Die Rolle selbst (Definition, Werkzeuge, Orchestrator-Regeln) ist
  nicht Teil dieser Spec.

### Nicht-Ziele

- Kein eigener Theme-Umschalter, keine Einstellungen.
- Keine Speicherung des Klapp-Zustands über die Sitzung hinaus.
- Kein `Client`-Element (Ansatz 3 verworfen: ohne `$`, kaum dokumentiert).

## 2. Grundlagen

Gelesen am 2026-10-09 in `.claude-plugin/types/claude-code/index.d.ts`
(Claude Code 2.1.295).

1. **`Svg`** gibt es nur in der Desktop-App. Props: `source` (SVG-Dokument,
   höchstens 131.072 Zeichen), `alt` (Pflicht), optional `width`/`height` in
   CSS-Pixeln, `isInteractive`. Ohne `isInteractive` zeichnet die App es als
   Bild; CSS-Animationen darin laufen (savvy-progress nutzt das).
2. **`Raster`** gibt es nur im Terminal. Props: `key`, `columns` (1–512),
   `rows` (1–256), `cells` = base64 aus `columns × rows` Tripeln
   `[codePoint, Vordergrund, Hintergrund]` als little-endian u32; jedes Zeichen
   ist ein druckbares BMP-Zeichen der Breite 1, Farbe `0x00RRGGBB` oder
   `0x01000000` für die Terminal-Vorgabe.
3. **Klicks** kommen nur über `Button` beim Plugin an; ein SVG kann keine
   Knöpfe tragen.
4. **Theme:** `$.config.list()` liefert eine Zeile mit `key === 'theme'`.
   Text-Elemente können Theme-Schlüssel als Farbe nehmen (`text`, `inactive`,
   `subtle`, `success`, `error`, `warning`, …).
5. **Effort** steht in jeder Transkript-Zeile auf oberster Ebene als
   `"effort": "low" | "medium" | …` (gemessen am e2e-Lauf vom 2026-10-09).
6. **Pane-Breite:** `e.props.bodyColumns` beim `ui.render` eines `Pane`.
7. **Vorbild Krabbe:** savvy-progress 1.2.0 (claude-kit, MIT-Lizenz,
   © 2026 johnnyvizz) zeichnet eine 24×18-Pixel-Krabbe auf einem 30×28-Raster
   mit Kostümen und CSS-Lauf-Animation.

## 3. Ansatz

Gemischt (Ansatz 1): Das Gerüst bleibt aus `Box`, `Text` und `Button`
(Überschriften, Klapp-Knöpfe, Agent-Zeilen). Die grafischen Stücke —
Kacheln, Token-Streifen, Status-Balken, Kostenbalken, Krabben — zeichnet in
der Desktop-App je ein kleines `Svg`, im Terminal eine Blockzeichen-Fassung (Balken aus unteren Halbblöcken `▄`, eine halbe Zeile hoch). Ein Anteil über null bekommt in jedem Balken mindestens eine Zelle (im SVG ein Achtzigstel der Breite), auch wenn er darauf abgerundet würde; die Zelle geht von der Spur, sonst vom breitesten Anteil ab
bzw. ein `Raster`. Alle Zeichnungen erzeugen reine Funktionen, die mit Node
getestet werden.

Verworfen: nur `Box`/`Text` (in der Desktop-App zu grob, Krabben brauchen
ohnehin SVG/Raster); `Client` (siehe Nicht-Ziele).

## 4. Aufbau

| Einheit | Aufgabe | |
|---|---|---|
| `cli/transcript.ts` | merkt sich je Datei den zuletzt gesehenen `effort` | geändert |
| `cli/summarize.ts` | gibt `effort` in die Zusammenfassung weiter | geändert |
| `shared/summary.ts` | `AgentSummary.effort: string` (leer, wenn keiner bekannt) | geändert |
| `hooks/view.ts` | Anzeige-Daten: Abschnitte, Gruppen, Zeilen, Zähler je Status (gesamt und je Rolle), Anteile der Token-Arten (gesamt, je Agent), Kostenanteil je Rolle, Kostüm je Rolle, Zusammenfassungszeilen, „Fertige ausblenden“ | geändert |
| `hooks/sprites.ts` | Pixel-Daten der Krabbe und der Kostüme (Abschnitt 6) | neu |
| `hooks/art.ts` | reine Funktionen: SVG-Texte (Kacheln, Streifen, Balken, Krabbe) je Palette; Raster-Zellen (Krabbe, Balken) und Blockzeichen-Balken fürs Terminal | neu |
| `hooks/open.ts` | entscheidet, ob ein Spawn das Panel öffnet (Abschnitt 5, „Automatisch öffnen“) | neu |
| `hooks/register.ts` | Verdrahtung: Theme lesen, je `e.surface` die Fassung wählen, Klapp-Zustand halten, `open.ts` fragen | geändert |

`hooks/register.ts` bleibt ohne eigene Logik (Ausschluss aus der Coverage wie
bisher); jede Entscheidung liegt in `view.ts`, `art.ts` oder `open.ts`.

## 5. Anzeige und Verhalten

### Reihenfolge

1. **Kopf:** Titel (`Lauf <id> · Gen 1–n` bzw. „Diese Sitzung“).
2. **▾ Übersicht:** drei Kacheln Kosten (≈), Tokens, Zeit; darunter der
   Token-Streifen gesamt mit den Zahlen je Art (in, out, cache read,
   cache write).
3. **▾ Agents:** rechtsbündig in derselben Zeile „Fertige ausblenden“, „Alle
   einklappen“, „Alle ausklappen“; im schmalen Panel (unter 70 Spalten) stehen
   sie in einer eigenen Zeile darunter, die umbricht. Darunter der Status-Balken ohne Zahlen und
   eine Zeile mit den Zahlen: ● läuft, ✓ fertig, ✗ gescheitert, ⊘ abgebrochen.
4. **Rollen-Karten**, jede einzeln einklappbar. Kopf: Krabbe (breit),
   ▾/▸ Name, Zähler je Status, Kosten; darunter der Kostenbalken (Anteil der
   Rolle an den Gesamtkosten). Je Agent: Statuspunkt, Task,
   `Modell · Effort · $Kosten · ⏱ Dauer` (ohne Effort, wenn keiner bekannt),
   darunter der Token-Streifen des Agents.

Keine Legende am Ende.

### Eingeklappt

- Übersicht: `≈ $4.12 · 1.8M · 38:12`.
- Agents: die Zähler je Status.
- Rolle: Krabbe, Name, Zähler, Kosten.

In einer Rollen-Karte steht über jedem Agent eine Leerzeile, also auch zwischen
dem Kostenbalken der Rolle und dem ersten Agent.

„Fertige ausblenden“ blendet ✓-Zeilen in allen Rollen aus; eine Rolle, deren
Agents alle fertig sind, zeigt dann nur ihren Kopf und den Kostenbalken.

Eine Karte zeigt höchstens 150 Zeilen und darunter „… N weitere Agents“: Das
Terminal zeichnet einen Pane nur bis 100 000 Zeichen Text und schnitte den Rest
sonst stumm ab.

`/agent-panel` zählt einen Pane, der unaufgefordert geöffnet wurde und im
schmalen Terminal ungezeichnet wartet (`isPlaced` false), als geschlossen: Der
Befehl zeigt ihn dann, statt ihn zu schließen, und der Takt startet für ihn kein
`node`.

### Zustand

Klapp- und Ausblende-Zustand gelten für die laufende Sitzung (Modulvariable).
Ein Neuladen des Moduls setzt alles auf offen.

### Breite

`bodyColumns ≥ 70` gilt als breit: Krabben werden gezeichnet. Darunter keine
Krabben, sonst gleicher Aufbau.

### Krabben

- Läuft ein Agent der Rolle (●), läuft die Krabbe: Beine und Körper wippen,
  das Kostüm-Teil bewegt sich mit. Sonst steht sie still.
- `@media (prefers-reduced-motion: reduce)` schaltet die Animation ab
  (Desktop). Im Terminal gibt es keine Animation.

### Farben

| Bedeutung | Farbe |
|---|---|
| ● läuft | `#1d6fb8` |
| ✓ fertig | `#2f8a52` |
| ✗ gescheitert | `#c0392b` |
| ⊘ abgebrochen | `#b07a12` |
| Token in | `#8f8cf4` |
| Token out | `#5fbf8f` |
| Token cache read | hell `#d8d5ce`, dunkel `#5a5853` |
| Token cache write | `#f0b35b` |
| Kostenbalken | `#8f8cf4` |

Hintergründe der SVG-Stücke: hell Kachel `#f1efea`, Balkenspur `#efece6`;
dunkel Kachel `#2b2a28`, Balkenspur `#3a3936`. Texte in `Text`-Elementen über
Theme-Schlüssel (`text`, `inactive` für Nebeninfos, Statusfarben wie oben).

### Theme

Enthält der Wert der `theme`-Zeile aus `$.config.list()` „dark“, gilt die
dunkle Palette, sonst die helle. Schlägt das Lesen fehl oder fehlt die Zeile:
hell. Das Theme wird bei `session.start` und bei jedem Takt neu gelesen.

### Automatisch öffnen

Ein `agent.spawn`, der nicht verweigert wurde, öffnet das Panel, wenn
**eines** gilt:

- **A:** `e.isTeammate` ist gesetzt und in den 10 Minuten davor ist kein
  Teammate gestartet (der erste Teammate eines Laufs oder einer neuen
  Generation).
- **B:** Mit diesem Spawn sind es mindestens 3 Spawns innerhalb der letzten
  30 s.

Ist das Panel schon offen, passiert nichts. Das Öffnen geschieht ohne Fokus;
im Terminal greift die Regel von Claude Code (sichtbar erst ab 144 Spalten,
nachdem der Nutzer es einmal geöffnet hat ab 110). Schwellen als Konstanten in
`open.ts`.

## 6. Kostüme

Je Rolle eine Krabbe auf dem 30×28-Raster (Körper in `#D97757`, Augen
`#1F1E1D`) mit Kostüm-Teil:

| Rolle | Kostüm |
|---|---|
| Lead (Orchestrator) | Krone |
| implementer-backend | Bauhelm |
| implementer-frontend | Pinsel |
| implementer-infra | Schraubenschlüssel |
| implementer-ux | Barett |
| verifier | Lupe |
| code-reviewer | Brille |
| security-reviewer | Schild |
| bug-hunter | Kescher |
| cleaner | Besen |
| explorer | Kompass |
| researcher | Buch |
| planner | Karte |
| browser-tester | Browserfenster mit drei Punkten und Mauszeiger |
| alle anderen | ohne Kostüm |

Zuordnung über den Rollennamen aus der Zusammenfassung (ohne Plugin-Präfix).
Rollen, deren Name `browser` oder `playwright` enthält, bekommen das
browser-tester-Kostüm. Die Pixel-Daten folgen dem Entwurf
`kostueme-v2.html`.

**Terminal:** dieselbe Krabbe verkleinert auf 15×14 Pixel (jede zweite Spalte
und Zeile), als `Raster` mit Halbblöcken (`▀`, oberes Pixel Vordergrund,
unteres Hintergrund): 15 Spalten × 7 Zeilen.

**Herkunft:** Krabbenform und Lauf-Animation nach savvy-progress (MIT); der
Lizenzhinweis steht im Kopf von `hooks/sprites.ts`. Die Kostüme sind eigene
Entwürfe.

## 7. Fehlerfälle

- **SVG-Größe:** Jedes Stück ist ein eigenes kleines SVG; keines darf 131.072
  Zeichen überschreiten. Ein Test prüft das mit 200 Agents in einer Rolle.
- **Unbekannte Rolle:** Krabbe ohne Kostüm.
- **Kein Effort:** Zeile ohne Effort.
- **Theme unbekannt/Fehler:** helle Palette.
- **Zeichenfunktion wirft:** Das Panel zeigt die Textfassung von heute und
  darüber eine Warnzeile `⚠ Grafik: <Meldung>`; die Sitzung läuft weiter.

## 8. Tests

- **`hooks/art.ts`, `hooks/sprites.ts`, `hooks/open.ts`:** Node-Tests,
  100 % Zeilen/Zweige/Funktionen.
  - SVG: enthält die Breiten der Anteile und die Farben der gewählten
    Palette; Animation nur bei laufender Krabbe; enthält den
    `prefers-reduced-motion`-Block; bleibt unter der Größengrenze.
  - Raster: `cells` ist gültiges base64 der Länge `columns × rows × 12` Bytes;
    nur Zeichen der Breite 1.
  - Kostüme: jede Datei unter `agents/` plus `browser-tester` hat ein Kostüm;
    unbekannt → ohne Kostüm; `x:browser-agent` → browser-tester.
  - Öffnen: erster Teammate öffnet; zweiter Teammate desselben Laufs nicht;
    Teammate nach 10 min Pause öffnet; drittes Spawn in 30 s öffnet; zwei
    Spawns nicht; drei Spawns über 31 s verteilt nicht.
- **`hooks/view.ts`:** Effort in der Zeile (mit und ohne), Zähler je Rolle,
  Zusammenfassungszeilen, „Fertige ausblenden“, Anteile der Token-Arten
  (Summe 100 %, alle null).
- **`cli/transcript.ts`:** Effort aus der letzten Zeile, die einen hat.
- **Kit (`hooks/register.test.ts`):** Desktop zeichnet `Svg`, Terminal `Text`
  und `Raster`; Krabben erst ab 70 Spalten; Klapp-Knöpfe und „Fertige
  ausblenden“ wirken; das Panel öffnet beim Team-Start erneut, nachdem es
  geschlossen wurde; eine werfende Zeichenfunktion ergibt die Textfassung mit
  Warnzeile.
- **Von Hand**, Protokoll unter `docs/.superpowers/smoke/`: Desktop und
  Terminal je hell und dunkel, schmales und breites Panel, ein Lauf mit vielen
  Agents.

## 9. Nachtrag 2026-10-10: Angleichung an den Entwurf

Der erste Stand wich in der Desktop-App sichtbar von `entwurf-v5.html` und
`einklappen-v4.html` ab. Was hier steht, geht den Abschnitten 3–5 vor.

- **Breite:** Balken, Streifen und die Trennlinie sind SVGs mit 1600 px
  eigener Breite und `preserveAspectRatio="none"`, die `height` wird als Prop
  mitgegeben. Der Host zeichnet sie auf die Breite des Platzes, also gestreckt.
  Die runden Enden sind für ein Panel von 560 px bemessen. Gemessen in
  Chromium am 2026-10-10: Auch ein SVG ohne `viewBox` wird nur in der Breite
  gestreckt, Text darin also gestaucht.
- **Kacheln** sind deshalb `Box`/`Text` mit dem Kachel-Hintergrund, kein SVG.
- **Breit:** In der Desktop-App gilt das Panel immer als breit (Krabben,
  Werkzeuge neben der Überschrift); die 70-Spalten-Schwelle gilt nur im
  Terminal.
- **Abschnittsköpfe** in grauen Großbuchstaben (`▾ ÜBERSICHT`, `▾ AGENTS`),
  über „Agents“ eine Trennlinie (Desktop: SVG, Terminal: `─`).
- **Werkzeuge** sind echte Knöpfe (`variant` `secondary`); „Fertige
  ausblenden“ ist eingeschaltet `primary`.
- **Farbig:** Token-Legende (■ in der Token-Farbe, Zahl fett, über die Breite
  verteilt), Statuszeile (verteilt) und die Zähler im Rollenkopf und im
  eingeklappten „Agents“-Kopf.
- **Agent-Zeile:** Modell, Effort, Kosten und Dauer rechtsbündig.
- **Karten** in der Desktop-App mit eigenem Hintergrund und Rand
  (hell `#ffffff`/`#e9e7e2`, dunkel `#262523`/`#3a3936`); im Terminal nicht.
- **Titel** `Lauf <id>`, dahinter gedimmt `· Gen 1–n`.
- **Krabbe** 36×34 px wie im Entwurf.
