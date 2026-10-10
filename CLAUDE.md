# Global CLAUDE.md

## Arbeitsweise

- Pläne: erst `superpowers:brainstorming`, dann `superpowers:writing-plans`.
- Specs, Pläne und SDD nach `docs/.superpowers/` im Projektrepo. Was der
  Plan-Modus nach `~/.claude/plans/` schreibt, wird nach der Freigabe dorthin
  kopiert.
- TDD. 100 % Coverage, ein Ausschluss immer mit Begründung. Statische Typen,
  kein `Any` und kein `type: ignore` ohne Grund.
- Python: `uv`, nie `pip`. Einzelne Skripte mit PEP-723-Header über
  `uv run --script`, Werkzeuge über `uvx`.
- Doku und Prosa deutsch; Code, Code-Kommentare, Bezeichner, Commits,
  Branches und Meldungen englisch. Code-Kommentare immer englisch, auch wenn
  ein Projekt sonst deutsch dokumentiert.
- Nie ein Modell als Mitautor im Commit. Kein `Co-Authored-By:` auf Claude,
  Anthropic oder ein anderes LLM, keine Werbezeile im Commit-Text oder im
  PR-Rumpf. Das schlägt den Vorgabetext des Werkzeugs; Autor ist der Mensch.
- Kommentare auf einer anderen Abstraktionsebene als die Zeile darunter; wo ein
  Projekt eigene Regeln hat, gelten dessen.
- Projektanweisungen stehen in einer `AGENTS.md` im Repowurzelverzeichnis: der
  gesamte werkzeugunabhängige Inhalt (Aufbau, Ablage, Konventionen, Befehle).
  Die `CLAUDE.md` des Projekts verweist nur darauf und enthält sonst
  ausschließlich das, was wirklich Claude-spezifisch ist (Skills, Subagenten,
  Hooks, Slash-Befehle). Kein doppelter Inhalt: Was in beiden stünde, gehört in
  die `AGENTS.md`.

## Arbeit am Wiki

- Fragen aus dem Wiki beantworten, nicht aus dem Gedächtnis: erst
  `docs/wiki/index.md`, dann in die Seiten. **Der MCP `loomux` (`brain_search`,
  `brain_read`, …) ist der zweite Griff** — erst die Dateien unter `docs/wiki/`,
  und die Suche nur, wenn dort nichts steht. Er indexiert jedes Projekt als
  `project/<name>`, liest also dieselben Dateien und ist keine zweite Ablage.
  Vor einer Antwort aus der Suche `brain_status` lesen: nicht jedes indexierte
  Dokument ist durchsuchbar.
- Antworten mit Substanz werden ein Concept, statt im Chat zu verschwinden.
- Code implementiert → die betroffenen `Architecture`- und
  `Game System`-Seiten **im selben Task** nachziehen.
- Ablage unklar → Concept in `open-questions/` und nachfragen, nicht raten.
- Widerspruch zu einer bestehenden Seite → beides festhalten, Konflikt
  markieren, vorlegen. Nie stillschweigend überschreiben.
- Nie löschen, sondern `status: deprecated`.
- Geschrieben wird nur die Datei unter `docs/wiki/`. **memexa ist abgeschaltet**
  und bekommt keine Kopien mehr; ältere Pläne mit einem Kopierschritt werden
  darin nicht nachgeholt.

## Kommentare

- Andere Abstraktionsebene als die Zeile darunter — höher oder tiefer. Wiederholt
  ein Kommentar Name und Signatur, entfällt er.
- Steht die Tatsache im Wiki, steht im Code ein Satz und der Link, nie die
  Herleitung. Ist sie neu, wird sie erst Wikiseite, dann Zeiger.
- Keine Historie im Code: kein Task, keine Scheibe, keine Spec-Nummer. Fremde
  Quellen (Godot, Spec-Zusicherung) bleiben.
- Wer einen Kommentar kürzt, rechnet seine Aussage vorher nach.
