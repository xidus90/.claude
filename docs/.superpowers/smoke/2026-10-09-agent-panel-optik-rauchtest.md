# Rauchtest Agent-Panel: neue Optik

- Datum: 2026-10-09
- Zweig: `claude/untitled-session-a838d0`
- Plugin: `agent-panel` 0.2.0 (`claude plugin install agent-panel@claude-config` nach dem Merge)
- Entwurf: `docs/.superpowers/specs/2026-10-09-agent-panel-optik-design.md`

Alle Punkte brauchen die Desktop-App, ein interaktives Terminal oder einen
laufenden Lead. Sie sind offen und vom Nutzer auszuführen; die Beobachtung
bleibt leer, bis jemand es gesehen hat.

## Darstellung

- [ ] **Desktop hell.** Erwartung: Kacheln (Kosten, Tokens, Zeit), Token-Streifen
  (in / out / cache read / cache write), Status-Balken und je Rolle eine Karte
  in der hellen Palette; im breiten Fenster eine Krabbe mit Kostüm in jeder Karte.
  Beobachtung: offen — vom Nutzer.
- [ ] **Desktop dunkel.** Erwartung: dieselben Elemente in der dunklen Palette,
  Kacheln, Spuren und alle vier Token-Farben gut lesbar.
  Beobachtung: offen — vom Nutzer.
- [ ] **Terminal schmal (< 70 Spalten).** Erwartung: Kacheln, Token-Streifen,
  Status-Balken und Rollen-Karten in Blockzeichen, keine Krabben.
  Beobachtung: offen — vom Nutzer.
- [ ] **Terminal breit (≥ 144 Spalten).** Erwartung: derselbe Aufbau in
  Blockzeichen, in jeder Karte eine Krabbe mit dem Kostüm der Rolle; sie läuft,
  solange ein Agent der Rolle läuft, und steht, wenn keiner mehr läuft.
  Beobachtung: offen — vom Nutzer.

## Bedienung

- [ ] **Einklappen aller drei Ebenen.** Erwartung: „Übersicht“, „Agents“ und
  jede Rolle klappen einzeln zu und wieder auf; „Alle einklappen“ und „Alle
  ausklappen“ wirken auf alle. Beobachtung: offen — vom Nutzer.
- [ ] **„Fertige ausblenden“.** Erwartung: ✓-Zeilen verschwinden in allen
  Rollen; eine Rolle, deren Agents alle fertig sind, zeigt dann nur ihren
  Kopf. Erneutes Klicken blendet die Zeilen wieder ein. Beobachtung: offen — vom Nutzer.

## Öffnen

- [ ] **Team-Lauf öffnet das Panel nach Schließen erneut.** Erwartung: Panel
  mit `/agent-panel` schließen, einen neuen Team-Lauf starten (Lücke seit dem
  letzten Team-Spawn ≥ 10 min): das Panel öffnet sich beim ersten Teammate des
  Laufs von selbst; der zweite Teammate desselben Laufs öffnet es nicht erneut.
  Beobachtung: offen — vom Nutzer.
- [ ] **Drei Subagenten in 30 s öffnen es.** Erwartung: Panel schließen, drei
  Subagenten innerhalb von 30 s starten: das Panel öffnet sich; drei Spawns
  über 31 s verteilt öffnen es nicht. Beobachtung: offen — vom Nutzer.

## Last

- [ ] **Ein Lauf mit vielen Agents bleibt flüssig.** Erwartung: Bei einem
  Lauf mit mehreren Dutzend Agents (etwa ein e2e-Teamlauf) reagiert das Panel
  ohne spürbare Verzögerung auf Einklappen und Statuswechsel; die Krabben
  bremsen die Sitzung nicht. Beobachtung: offen — vom Nutzer.
