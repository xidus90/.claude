# Global CLAUDE.md

Langfassung mit allen Begründungen:
`~/.claude/archive/2026-08-22-claude-md-lang.md`.

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

## ultraloom: die Go-Befehle, und wann Python zu ersetzen ist

Stand 2026-09-10, gelesen aus `cmd/guard` und `cmd/init` im Repo `ultraloom`.
Beide Binaries werden aus dem Baum gebaut und sind git-ignoriert — ein altes
`ulinit.exe` kennt einen neuen Unterbefehl nicht.

**Es gibt zwei Stände, und sie driften.** Der Checkout baut nach
`./ulinit.exe`, und die Hooks rufen das `ulguard`/`ulinit` auf dem PATH, in
`~/go/bin`. Am 2026-09-10 kannte das PATH-Binary `check types` schon nicht mehr,
während der Checkout es hatte. Nach einer Änderung an `cmd/` also **beide**
bauen:

```
go build -o ulinit.exe ./cmd/init
go build -o "$HOME/go/bin/ulinit.exe" ./cmd/init
```

**Nicht `go install`.** Es benennt das Ergebnis nach dem Paketverzeichnis, also
`init.exe` und `guard.exe` — nicht `ulinit.exe` und `ulguard.exe`, die die
Hooks rufen. Es meldet dabei Erfolg und lässt die alten Binaries unberührt
liegen; am 2026-09-10 sind so zwei Streuner in `~/go/bin` entstanden, und die
Bahn war danach genauso alt wie vorher. `go build -o <zielname>` ist der Weg.

`ulguard` (aus `cmd/guard`) — drei der Formen lesen eine Nutzlast von stdin,
drei nicht; gegen `cmd/guard/main.go` nachgerechnet, welche Aufrufe `stdin`
überhaupt weitergereicht bekommen:

- ohne Unterbefehl, `--root` — die PreToolUse-Wache, der Policy-Erzwinger
  (**stdin**)
- `post-edit --root` — PostToolUse (**stdin**)
- `worktree-unlink --root` (**stdin**)
- `status` | `explain` | `doctor`, `--root` — drei Namen, ein Codeweg; kein stdin
- `worktree-link --root` — kein stdin
- `worktree-remove <pfad>` — von Hand, der Pfad als Argument statt `--root`;
  kein stdin

`ulinit` (aus `cmd/init`):

- ohne Unterbefehl — der Installer, mit `--root`, `--dry-run`, `--yes`,
  `--detect-only`, `--version` und den Antwortflags
- `check gofmt [pfade…]` — weil `gofmt -l` auch bei Befund mit 0 exitet
- `check types [--status-file=…]` — dmypy, und räumt eine Statusdatei weg,
  die ihren Daemon überlebt hat. **Vorbedingung:** der Aufruf ist
  festverdrahtet auf `uv run dmypy … run -- --no-error-summary --no-pretty`
  (`mypyArgs` in `cmd/init/check.go`). Ein Projekt, das dmypy ohne `uv` oder
  mit anderen mypy-Flags fährt, verliert die Flags bei der Umstellung. Und die
  Heilung selbst ist heute Windows-only: die Marker sind der Text der
  NamedPipe, auf POSIX wirft `connect()` eine nackte `FileNotFoundError`
- `check coverage --go-floor=N --summary=…`
- `check commit-msg <datei>`

**Wo eine Go-Form existiert und ein Projekt noch die Python-Form ruft — in
`.claude/settings.json` oder `.ultraloom/config.toml` —, ist zu migrieren.**
Der Grund ist gemessen, nicht vermutet: 10 warme Läufe am 2026-09-10 ergaben
für `uv run --script` auf einem leeren PEP-723-Skript 55 ms Median gegen 31 ms
für `ulinit`, und der Paket-Einstiegspunkt `ultraloom …` kostet ~253 ms gegen
~142 ms für das Binary daneben (Messung vom 2026-09-08). Bei einem Hook, der an
jedem Edit hängt, ist das der ganze Unterschied.

**Vorher aber nachrechnen, ob die Go-Form dieselbe Arbeit tut. Zweimal tut sie
es gar nicht, und `check types` nur unter der Vorbedingung oben:**

- `ulinit check commit-msg` ist **kein** Ersatz für `ultraloom commit-msg`. Die
  Go-Form ist eine festverdrahtete Wortlistenprüfung auf Englisch, nur die
  erste Zeile (`internal/commit/language.go`); die Python-Form liest `[commit]`
  aus der Konfiguration, kennt `--language en|de` und `--calibrate N`. Ein
  deutschsprachiges Projekt zerbricht an der Umstellung.
- `ulinit check coverage` ist halbgebaut: es prüft nur einen `--summary`, den
  man ihm reicht, misst selbst nichts und **gibt 0 zurück, wenn `--summary`
  leer ist** (`cmd/init/check.go`). Ein Tor, das grün meldet, wenn man ihm
  nichts gibt. `hooks/coverage-check.py` bleibt vorerst der Weg.

**Wofür es gar keine Go-Form gibt — hier ist nichts zu migrieren:** die vier
Sitzungshooks `ultraloom hook session-start|stop|subagent-start|subagent-stop`
und `ultraloom run|show|resume|replay|check`. Nur die beiden Pro-Edit-Hooks
sind Go.

## Arbeit am Wiki

- Fragen aus dem Wiki beantworten, nicht aus dem Gedächtnis: erst
  `docs/wiki/index.md`, dann in die Seiten. **Der MCP `brain` (ultra-brain) ist
  der zweite Griff** — erst die Dateien unter `docs/wiki/`, und die Suche nur,
  wenn dort nichts steht. `brain` indexiert dieses Repo als `project/space`, liest
  also dieselben Dateien und ist keine zweite Ablage.
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
