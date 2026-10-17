# city.json format, version 1

`city.json` is the contract between the analyzer and the viewer. Any tool can produce a file in this format and open it in the Agent City viewer.

All timestamps are ISO 8601 strings in UTC. All paths are repository-relative and use forward slashes.

## Top level

```json
{
  "format": "agent-city",
  "version": 1,
  "generator": "agent-city 0.1.0",
  "generatedAt": "2026-10-17T18:00:00.000Z",
  "repo": { },
  "params": { },
  "attribution": { },
  "adoption": { },
  "totals": { },
  "layout": { },
  "commits": [ ],
  "files": [ ],
  "insights": [ ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `format` | string | Always `"agent-city"` |
| `version` | integer | Format version. Readers must reject versions they do not know |
| `generator` | string | Tool and version that wrote the file |
| `generatedAt` | string | When the file was written |

## repo

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Display name, usually the folder or repository name |
| `source` | string | The path or URL the analysis ran on. URLs have credentials removed |
| `head` | string | Commit SHA that was analyzed |
| `branch` | string or null | Branch name at analysis time |
| `firstCommitAt` | string | Oldest analyzed commit |
| `lastCommitAt` | string | Newest analyzed commit |

## params

The settings the numbers depend on, so a reader can interpret them.

| Field | Type | Meaning |
|---|---|---|
| `reworkWindowHours` | number | Follow-up window used for rework, default 48 |
| `minAgentCommits` | number | Minimum agent-assisted commits before a file can appear in rework or hotspot findings, default 3 |
| `exclude` | string[] | Path patterns left out of the analysis |
| `since` | string or null | Only commits after this date were analyzed |

## attribution

Which sources contributed, and what period they cover.

```json
{
  "sources": [
    { "id": "git-ai", "commits": 0 },
    { "id": "trailer", "commits": 44 },
    { "id": "claude-transcript", "edits": 137, "from": "2026-09-12T...", "to": "2026-10-17T..." }
  ],
  "coveredFrom": "2026-09-12T..."
}
```

| Field | Type | Meaning |
|---|---|---|
| `sources[].id` | string | `git-ai`, `claude-transcript` or `trailer`. `agent-trace` is reserved for when that spec settles on a storage location |
| `sources[].commits` | number | Commits attributed by this source |
| `sources[].edits` | number | For transcripts, agent file edits found inside the repository |
| `sources[].from`, `to` | string | Time range the source covers |
| `coveredFrom` | string or null | Start of continuous coverage. Commits before it are only covered when a commit-level source (trailer, git-ai) marks them |

A file commit is **covered** when a source could have recorded agent involvement for it. A covered commit with no agent record counts as human. An uncovered commit counts as no record.

## totals

| Field | Type | Meaning |
|---|---|---|
| `commits` | number | Commits analyzed |
| `files` | number | Files in the city |
| `fileCommits` | number | Sum over files of commits touching the file |
| `covered` | number | File commits that are covered |
| `agent` | number | File commits that are agent-assisted |
| `rework` | number | Follow-up file commits inside the rework window |
| `testFiles` | number | Files recognized as tests |

## layout

| Field | Type | Meaning |
|---|---|---|
| `size` | number | Side length of the square city in layout units |
| `districts` | object[] | `{ path, depth, x, y, w, h }` for each folder. `depth` 1 is a top-level folder |

Every file also carries `x, y, w, h` in the same units. `x` and `y` are the corner nearest the origin.

## commits

Commits referenced by files and insights, oldest first. Files and insights refer to commits by index into this array.

| Field | Type | Meaning |
|---|---|---|
| `sha` | string | Full SHA |
| `at` | string | Committer date |
| `author` | string | Author name |
| `subject` | string | First line of the message |
| `agent` | boolean | At least one file in this commit is agent-assisted |
| `via` | string or null | Commit-level source that marked it (`git-ai`, `trailer`), else null |

## files

| Field | Type | Meaning |
|---|---|---|
| `path` | string | File path |
| `lines` | number | Lines at `head` |
| `commits` | number | Commits that touched the file |
| `churn` | number | Lines added plus removed across those commits |
| `authors` | number | Distinct human authors |
| `firstAt`, `lastAt` | string | First and last change |
| `covered` | number | Covered commits touching the file |
| `agent` | number | Agent-assisted commits touching the file |
| `rework` | number | Commits inside the rework window after an agent-assisted commit |
| `followUps` | number | Commits inside the rework window after any previous commit to the file |
| `isTest` | boolean | The file is a test |
| `test` | string or null | Path of the matching test file, if one exists |
| `log` | array | `[commitIndex, flags]` per commit touching the file. Flag bits: 1 agent-assisted, 2 covered, 4 follow-up after an agent-assisted commit, 8 matching test changed within the window, 16 follow-up after any commit |
| `x`, `y`, `w`, `h` | number | Footprint in layout units |

## adoption

When the repository contains agent instruction files, the analyzer finds the first commit that added one and compares the periods before and after it. This needs no per-commit attribution. `null` when no instruction file was ever committed.

Recognized files: `CLAUDE.md`, `.claude/`, `AGENTS.md`, `.cursorrules`, `.cursor/`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.windsurfrules`, `.windsurf/`, `.clinerules`, `.aider*`, `GEMINI.md`, `.continue/`.

| Field | Type | Meaning |
|---|---|---|
| `at` | string | Date of the first commit that added an instruction file |
| `commit` | number | Index of that commit |
| `tools` | string[] | Tools the instruction files belong to |
| `markers` | object[] | `{ path, tool, since }` for instruction files present at `head` |
| `before`, `after` | object or null | Period metrics, see below. `before` is null when agents were set up in the first commit |
| `comparable` | boolean | Both periods have at least 10 commits |

Period metrics: `from`, `to`, `commits`, `commitsPerWeek`, `medianLinesPerCommit`, `filesPerCommit`, `followUpRate` (share of file commits flagged 16), `testWithSourceRate` (share of commits touching source that also touch a test file).

## insights

Findings ranked by score inside each type and scope. Each one states its numbers in words and points at the commits behind it.

| Field | Type | Meaning |
|---|---|---|
| `type` | string | `review-hotspot`, `rework`, `missing-verifier` or `single-owner` |
| `scope` | string | `all`: computed over every change. `agent`: computed over agent-assisted changes, only present when agent records exist |
| `path` | string | File the finding is about. `""` means the whole repository |
| `score` | number | Ranking value inside its type and scope. Not comparable across types |
| `summary` | string | One sentence with the numbers behind the finding |
| `evidence` | number[] | Commit indexes that support it, latest 20 |

Every type has an `all` version so a repository with no agent records still gets findings. "Enough commits" below means at least 5 for `all` and at least `minAgentCommits` agent-assisted commits for `agent`.

### review-hotspot

Large files that change often. `all`: `score = commits × log2(lines + 1)`. `agent`: the same, multiplied by `agent / covered`.

### rework

Files that keep getting quick follow-up commits. `all`: `score = followUps / commits`. `agent`: `score = rework / agent`. Ties broken by the count. Evidence lists the follow-up commits.

### missing-verifier

Source files whose changes come without a matching test change inside the window, or that have no test file. `score` is the number of unchecked changes. When the repository has no test files at all, one repository-level finding replaces the per-file list.

### single-owner

Knowledge risk. `all`: source files only one person has ever changed; when the whole repository has one author, one repository-level finding replaces the list. `agent`: files where at least 80% of recorded changes were agent-assisted and at most one human touched them.

## Compatibility

New optional fields may appear within version 1. Removing or changing the meaning of a field requires version 2.
