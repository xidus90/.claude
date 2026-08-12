# Global CLAUDE.md

Diese Datei gilt für alle Projekte (User-Scope).

## Pläne

- **Für jeden Plan immer Superpowers nutzen.** Bevor ein Implementierungsplan
  erstellt wird, die Superpowers-Skills verwenden — zuerst
  `superpowers:brainstorming` (Anforderungen & Design klären), dann
  `superpowers:writing-plans` für den eigentlichen Plan. Niemals einen Plan ohne
  Superpowers schreiben.
- **Specs und Pläne liegen im Projekt-Repo.** Eine Superpowers-Spec gehört nach
  `docs/superpowers/specs/`, ein Implementierungsplan nach
  `docs/superpowers/plans/` — immer im Repo des Projekts, um das es geht. Nie
  in einem zentralen Ablageort, nie im Scratchpad. Ein Plan, der nicht neben
  dem Code liegt, den er beschreibt, wird nicht wiedergefunden.

## Subagenten

- **Subagenten laufen auf Opus.** Beim `Agent`-Tool immer `model: "opus"`
  setzen, nie `sonnet` — auch nicht für „einfache" Teilaufgaben. Dasselbe gilt
  für `opts.model` in Workflow-Skripten und für eigene Agent-Definitionen unter
  `.claude/agents/`.
- **Effort `low` ist der Standard.** `effort: "low"` beziehungsweise
  `opts.effort: 'low'`. Höher nur, wenn die Teilaufgabe es wirklich verlangt —
  und dann mit einer Begründung im Prompt des Subagenten.
- Begründung: Opus mit niedrigem Effort liefert verlässlichere Ergebnisse als
  Sonnet bei vergleichbarem Aufwand. Und gemischte Modellklassen machen die
  Ergebnisse mehrerer Subagenten untereinander unvergleichbar — man weiß nicht
  mehr, ob ein Unterschied aus der Aufgabe oder aus dem Modell kommt.
- **Grenze der Mechanisierung:** Diese Regel ist bewusst *nicht* als
  PreToolUse-Hook gebaut. Sie gilt durch Lesen, nicht durch Blocken.

## Sprachen

- **Dokumentation auf Deutsch.** Wikis, Specs, Design-Dokumente, README,
  Kommentare in Konfigurationsdateien, Prosa jeder Art.
- **Alles Maschinennahe auf Englisch.** Quellcode, Identifier, Code-Kommentare,
  Commit-Nachrichten, Branch-Namen, Log- und Fehlermeldungen, PR-Titel und
  -Beschreibungen, Dateinamen im Code.
- Grenzfall: Ein Design-Dokument bleibt deutsch, auch wenn es Codebeispiele
  enthält — der Code darin ist englisch, die Prosa drumherum deutsch.

## Kommentare

- **Nur kommentieren, was der Code nicht hergibt.** Kein Kommentar, der die
  Zeile darunter in Worten wiederholt. Kommentiere das *Warum*: die Absicht,
  den nicht offensichtlichen Grund, die Fallstricke, die Entscheidung gegen
  eine naheliegendere Lösung. Wenn ein Kommentar nötig scheint, um zu erklären
  *was* passiert, ist meist der Code das Problem.

## Tests und Qualität

Gilt für jedes Projekt mit Code, nicht nur für „große" Projekte.

- **TDD.** Erst der fehlschlagende Test, dann die Implementierung. Dafür die
  Skills `superpowers:test-driven-development` und
  `superpowers:verification-before-completion` nutzen.
- **Unit-Tests sind Pflicht.** Jedes Modul hat ein Testmodul. Kein Feature und
  kein Bugfix ohne Test.
- **100 % Code-Coverage.** Gemessen, nicht geschätzt. Tragfähig nur zusammen
  mit der Ausnahmeregel unten — ohne Ventil wäre die Zahl entweder eine Lüge
  oder eine Bremse.
- **Coverage-Ausschlüsse brauchen eine Begründung.** Eine Zeile darf nur mit
  einem begründenden Kommentar ausgenommen werden — bei Python also
  `# pragma: no cover  # <Grund>`, niemals nackt. Das Gleiche gilt für
  übersprungene Tests (`@unittest.skip("<Grund>")`).
- **Linting und Formatierung** laufen sauber durch, bevor etwas als fertig
  gilt. Keine unterdrückten Regeln ohne begründenden Kommentar.
- **Typisierung.** Statische Typen überall, wo die Sprache sie anbietet, und
  ein Typechecker, der ohne Fehler durchläuft. Kein `Any` und kein
  `# type: ignore` ohne begründenden Kommentar.
- **Für all das gibt es Hooks** — siehe Abschnitt *Regeln und Hooks*. Konkret:
  Linter und Typechecker nach dem Bearbeiten einer Quelldatei, Tests und
  Coverage-Schwelle bevor Arbeit als fertig gilt, dazu eine Prüfung, dass zu
  jedem Modul ein Testmodul existiert und dass Ausschlüsse begründet sind.
- **Grenze der Mechanisierung:** TDD selbst ist nicht prüfbar — kein Skript
  kann feststellen, dass der Test *vorher* geschrieben wurde. Erzwingbar sind
  nur die Artefakte. Und wo eine Sprache kein Coverage-Werkzeug hat (aktuell
  GDScript), gilt ersatzweise „jedes Modul hat Tests", und die Lücke wird als
  bekannte Einschränkung dokumentiert statt stillschweigend übergangen.

**Python-Werkzeuge** (per `uvx`, siehe Abschnitt *Python*): `ruff` für Linting
und Formatierung, `mypy` für Typen, `coverage` für die Messung.

## Regeln und Hooks

- **Was maschinell prüfbar ist, wird als Hook oder Skript gebaut.** Jede Regel
  in einer CLAUDE.md, die deterministisch entscheidbar ist, bekommt zusätzlich
  eine automatische Prüfung. Eine Regel, die nur als Prosa existiert, obwohl
  ein Skript sie prüfen könnte, wird über genügend Sessions zuverlässig
  gebrochen.
- Das entfernt die Regel **nicht** aus der CLAUDE.md: Erzwingen ersetzt
  Anleiten nicht. Eine Regel, die nur der Blocker kennt, wird durch Scheitern
  gelernt — Versuch, Blocker, Fehlermeldung, zweiter Versuch. Beides gilt,
  außer die Regel kostet mehr Platz als der Fehlschlag.
- Was Urteilsvermögen erfordert, bleibt bewusst Prosa. Ein Skript, das darüber
  entscheidet, erzeugt Scheinsicherheit.

## Python

- **Python >= 3.13.** Neue Projekte und Skripte setzen mindestens 3.13 voraus.
  Konkret: `requires-python = ">=3.13"` in `pyproject.toml` beziehungsweise im
  PEP-723-Header, `target-version = "py313"` für ruff, `python_version = 3.13`
  für mypy. Wo ein Werkzeug den Interpreter selbst wählt, wird die Version
  explizit mitgegeben statt auf einen Standard vertraut.
- **Immer `uv`, niemals `pip`.** Für Abhängigkeiten, virtuelle Umgebungen und
  das Ausführen von Skripten. Kein `pip install`, kein `python -m venv`, keine
  `requirements.txt` als primäre Quelle.
  - Projekte: `uv add`, `uv sync`, `uv run`, Abhängigkeiten in `pyproject.toml`
  - Einzelne Skripte: PEP-723-Header mit `dependencies` im Skript selbst,
    Aufruf über `uv run --script <datei>`. Damit ist ein Skript ohne
    Vorinstallation lauffähig.
  - Werkzeuge: `uvx <werkzeug>` statt globaler Installation
- **Imports stehen oben.** Alle `import`- und `from ... import`-Anweisungen
  gehören an den Dateianfang, auf Modulebene — nicht in Funktionen, Methoden
  oder Klassenkörper.
  - Wenn es wirklich keinen anderen Weg gibt (zirkulärer Import, teure oder
    optionale Abhängigkeit, Import mit Seiteneffekt), darf ein Import lokal
    stehen — dann aber **zwingend mit einem Kommentar, der die Begründung
    nennt**. Ein lokaler Import ohne Begründung ist ein Fehler.
  - Für rein typbezogene Zyklen ist der `TYPE_CHECKING`-Guard am Dateianfang
    die richtige Lösung, kein lokaler Import.

```python
def render(data: dict[str, int]) -> str:
    # Local import: pandas costs ~1s to import and only this path needs it.
    import pandas as pd

    return pd.DataFrame(data).to_string()
```
