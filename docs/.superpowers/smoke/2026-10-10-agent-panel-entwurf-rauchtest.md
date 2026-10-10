# Rauchtest Agent-Panel: Angleichung an den Entwurf

- Datum: 2026-10-10
- Zweig: `claude/design-vorgabe-check-219d41`
- Spec: `docs/.superpowers/specs/2026-10-09-agent-panel-optik-design.md`, Abschnitt 9
- Vorgabe: `entwurf-v5.html`, `einklappen-v4.html`

Automatisch geprüft: Unit-Tests (187, 100 % Coverage), Kit-Tests (44),
Typecheck, `claude plugin validate --strict`. In Chromium gemessen: Ein Balken
füllt 560 px, die Enden sind rund, die Anteile stimmen.

Offen und vom Nutzer auszuführen, nach `claude plugin install agent-panel@claude-config`:

- [ ] **Desktop dunkel, Panel ~600 px.** Erwartung: Kacheln, Streifen,
  Status-Balken und Kostenbalken über die volle Breite; Kacheln mit Hintergrund.
  Beobachtung: offen.
- [ ] **Desktop hell.** Erwartung: dasselbe in der hellen Palette, Karten weiß
  mit hellem Rand. Beobachtung: offen.
- [ ] **Desktop, Panel maximiert.** Erwartung: Balken über die volle Breite,
  Enden etwas oval. Beobachtung: offen.
- [ ] **Desktop: Köpfe und Knöpfe.** Erwartung: `▾ ÜBERSICHT`, Trennlinie,
  `▾ AGENTS` mit den drei Knöpfen rechts daneben; Krabben in den Karten.
  Beobachtung: offen.
- [ ] **Desktop: Zeilen.** Erwartung: Modell · Effort · Kosten · ⏱ rechtsbündig;
  Legende und Statuszeile farbig und verteilt. Beobachtung: offen.
- [ ] **Terminal schmal und breit.** Erwartung: Aufbau wie bisher, dazu farbige
  Legende und Statuszeile, `─`-Linie über AGENTS, Knöpfe als `[ … ]`.
  Beobachtung: offen.
