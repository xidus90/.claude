# Geparkte Wurzeln im Agent-Team

Stand 2026-10-09. Nachtrag zu `docs/.superpowers/specs/2026-10-08-agent-team-design.md`
(im Folgenden „Hauptspec“). Anlass ist Befund 1 aus
`docs/.superpowers/smoke/2026-10-08-ende-zu-ende.md`.

## 1. Problem

Der Mensch kann eine Wurzel aufgeben: Vor der vierten Runde fragt der
Orchestrator, und „aufgeben“ ist eine Antwort (Hauptspec Abschnitt 4,
„Runden und Grenzen“). Die Tore kennen das aber nicht. `check_final`
(`scripts/teamgate_tasks.py`) verlangt für jede Wurzel mit einem `impl`- oder
`fix`-Task ein abgeschlossenes `[merge]`, einen Zweig, der Vorfahre des
Feature-Zweigs ist, und ein jüngstes `verify`-Urteil, das nicht `fail` ist.
Eine aufgegebene Wurzel hält `[final]` damit für immer. Im Ende-zu-Ende-Lauf
vom 2026-10-09 lehnte der Hook `[final]` nach „B3 aufgeben“ ab, und der Lauf
kam nicht mehr zum Ende.

## 2. Ziel

Eine Wurzel, die der Mensch aufgibt, heißt **geparkt**. Sie wird nicht
gemergt, ihr Zweig bleibt stehen, und sie hält weder `[final]` noch
`[cleanup]` auf. Der Abschlussbericht nennt sie mit Grund. Erfolg heißt: Ein
Lauf wie der vom 2026-10-09 kommt nach „B3 parken“ durch `final` und
`cleanup`, und der Feature-Zweig trägt alles außer B3.

## 3. Entscheidungen

1. **Befugnis: nur die Antwort des Menschen.** Geparkt wird ausschließlich
   über eine `AskUserQuestion` des Orchestrators. Ein `PostToolUse`-Hook liest
   die Antwort aus der Tool-Antwort des Harness und schreibt das Register.
   Kein Agent kann das Ereignis über einen Befehl auslösen; es gibt keinen
   CLI-Weg zum Parken.
2. **Umfang: jede Wurzel außer `F`.** T- und B-Wurzeln dürfen geparkt werden.
   Eine geparkte T-Wurzel heißt, dass dieser Plan-Task auf dem Feature-Zweig
   fehlt; der Bericht sagt das. `F` (die Wurzel der Nacharbeit nach einem
   gescheiterten `verify:final`) darf nicht geparkt werden, sonst ginge ein
   Lauf mit gescheiterter Endprüfung durch.
3. **Kein Entparken.** Wer es sich anders überlegt, bricht den Lauf ab oder
   legt die Arbeit in einem neuen Plan an.
4. **Kein automatisches Mitparken.** Hängt eine Wurzel von einer geparkten
   ab, fragt der Orchestrator den Menschen eigens nach dieser Wurzel.

## 4. Mechanismus

### 4.1 Die Frage

Der Orchestrator bietet in einer `AskUserQuestion` eine Option, deren Text
exakt `Park <wurzel>` lautet, etwa `Park B3`. Er tut das an drei Stellen:

- vor der vierten Runde einer Wurzel (Hauptspec Abschnitt 4, „Runden und Grenzen“),
- wenn der Hook `[final]` wegen einer Wurzel ablehnt,
- wenn eine Wurzel an einer geparkten hängt (Entscheidung 4).

Je Frage höchstens eine Park-Option. Der Text der Frage nennt den Grund; er
wird im Register gespeichert und im Bericht zitiert.

### 4.2 Der Hook

Neues Ereignis des Gate-Skripts: `team-gate.py --run <lauf> post-ask-user`,
eingetragen vom Starter als `PostToolUse` mit Matcher `AskUserQuestion`.

Er liest aus der Nutzlast die gestellten Fragen (`tool_input`) und die
gewählten Antworten (`tool_response`). Ist eine Antwort genau
`Park <wurzel>` (auch als frei getippter Text: getippt hat ihn der Mensch),
prüft er unter der Register-Sperre:

- die Wurzel hat Form `T<n>` oder `B<n>`,
- im Register steht mindestens ein Task dieser Wurzel,
- sie hat kein abgeschlossenes `[merge]`,
- sie ist nicht schon geparkt.

Treffen alle zu, hängt er an das Register

- `{"event": "parked", "gen": <generation>, "root": "<wurzel>", "question": "<fragetext>"}`
- und für jeden offenen Task der Wurzel ein `superseded`-Ereignis (auch für
  `[merge] <wurzel>`),

und schreibt `status.md` neu. Jede andere Antwort ist kein Fehler: Der Hook
tut nichts und endet mit 0.

**Fälschungsschutz.** Die `tool_response` erzeugt der Harness; ein Agent kann
sie nicht schreiben. `AskUserQuestion` haben nur `planner` und
`orchestrator` (Hauptspec Abschnitt 3). Schreiben in `tasks.jsonl` von Hand
bleibt die bekannte Grenze aus Hauptspec Abschnitt 11 und wird hier nicht
enger.

### 4.3 Register-Modell

`tasks()` kennt das Ereignis `parked`; es trägt `root` statt `task_id` und
gehört zu keinem Task. Ein `parked`-Ereignis für eine Wurzel ohne Task im
Register ist ein Fehler im Register (wie heute ein Ereignis für einen
unbekannten Task). Das Modell liefert neben Tasks und abgeschlossenen Tasks
die Menge der geparkten Wurzeln mit ihrer Frage.

### 4.4 Was die Tore anders machen

| Tor | Neu |
|---|---|
| `TaskCreated` | verweigert jeden Task, dessen Wurzel geparkt ist: „root <wurzel> is parked“ |
| `TaskCompleted`, `final` | geparkte Wurzeln fallen aus den Prüfungen „abgeschlossenes `[merge]`“, „Zweig ist Vorfahre des Feature-Zweigs“ und „jüngstes `verify`-Urteil nicht `fail`“; die Prüfung auf offene Tasks bleibt |
| `TaskCompleted`, `merge` | unverändert: das `[merge]` einer geparkten Wurzel ist geschlossen, ein neues lässt `TaskCreated` nicht zu |
| `PostToolUse` auf `AskUserQuestion` | neu, wie in 4.2 |
| `status.md` | Zustand `parked` für geparkte Wurzeln |

### 4.5 Fehlerfälle

`PostToolUse` kann nichts mehr verhindern; die Frage ist beantwortet. Der
Hook meldet deshalb nur, mit Exit 2 und Grund an den Orchestrator, und parkt
nicht, wenn

- die Nutzlast keine lesbaren Fragen und Antworten trägt,
- die gewählte Park-Option eine Wurzel nennt, die die Prüfungen in 4.2 nicht
  besteht (Form, unbekannt, gemergt, schon geparkt).

Ohne Laufordner endet der Hook mit 0 und schreibt nichts (Hauptspec
Abschnitt 15, Punkt 10).

## 5. Rollen, Bericht, Starter

- **`agents/orchestrator.md`:** die drei Stellen aus 4.1 mit dem exakten
  Optionsformat; der Bericht bekommt den Abschnitt „Parked roots“ mit
  Wurzel, Grund (die gespeicherte Frage) und ungemergtem Zweig; nach einem
  Parken legt er keine Tasks dieser Wurzel mehr an.
- **`agents/verifier.md`, `docs/agent-team/verdicts.md`:** `verify:final`
  prüft, dass jede geparkte Wurzel aus dem Register im Abschnitt „Parked
  roots“ des Berichts steht.
- **`scripts/claude-team.ps1`:** `New-TeamSettings` trägt den fünften Hook ein
  (`PostToolUse`, Matcher `AskUserQuestion`, Ereignis `post-ask-user`); der
  Pester-Test hält ihn fest.
- **Aufräumen:** unverändert. Der ungemergte Zweig einer geparkten Wurzel
  steht in der Ausgabe von `git branch --no-merged`, die schon heute als
  „keep and report“ in die Beschreibung von `[cleanup]` geht.

## 6. Rauchtest 15

Vor dem Bau wird gemessen, was die Nutzlast von `PostToolUse` auf
`AskUserQuestion` enthält: ob `tool_response` die gewählte Antwort
strukturiert trägt, in welcher Form (Liste, Zuordnung Frage → Antwort,
freier Text), und wie eine frei getippte Antwort („Other“) erscheint. Die
Messung nennt die Claude-Code-Version.

**Rückfall**, wenn die Antwort nicht in der Nutzlast steht: Parken nur durch
den Menschen im eigenen Terminal, `team-gate.py --run <lauf> park <wurzel>
<grund>`. Die Befehlsprüfung (`teamgate_cmd.py`) verweigert diesen Aufruf in
jeder Sitzung des Laufs. Prüfungen und Register-Einträge wie in 4.2.

## 7. Tests

- Hook: gewählte Option `Park B3`; eine andere Option; frei getippt
  `Park B3`; `Park F`; unbekannte Wurzel; gemergte Wurzel; schon geparkte
  Wurzel; Nutzlast ohne Antworten; kein Laufordner.
- Register: `parked` schließt die offenen Tasks der Wurzel; `parked` für eine
  unbekannte Wurzel ist ein Registerfehler.
- `TaskCreated` auf eine geparkte Wurzel wird verweigert, auf eine andere
  nicht.
- `final` mit einer geparkten, ungemergten Wurzel geht durch; ohne Parken
  wird es wie heute abgelehnt.
- `status.md` zeigt `parked`.
- Starter: der fünfte Hook mit Matcher und Zeitlimit.
- Mutanten je Regel einzeln.

## 8. Nicht in diesem Nachtrag

- Bytecode des Tors, der das Aufräumen blockiert (Befund 2 des Protokolls).
- Rollen, die über den Plan hinausgehen (Befund 3).
- Entparken.

## 9. Änderungen an der Hauptspec

Der Plan trägt diesen Nachtrag an diesen Stellen der Hauptspec ein:
Lebenszyklus mit Phase 2 und „Runden und Grenzen“ (Abschnitt 4), Status
(Abschnitt 5), Task-Ereignisse und Hook-Tabelle (Abschnitt 6), Starter
(Abschnitt 7), Aufräumen (Abschnitt 8), Fehlerfälle (Abschnitt 9),
Rauchtest 15 (Abschnitt 10), Tests (Abschnitt 12) und die Grenzfälle
(Abschnitt 15).
