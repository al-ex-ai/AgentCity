# Agent City

Give it a git repository. Get back a 3D city of the codebase that shows where coding agents write your code, and what that code costs you afterwards.

## The problem

Teams now ship a large share of their changes through coding agents (Claude Code, Codex, Cursor, Copilot and others). Engineering leads can say "AI wrote 40% of our code", but that number does not tell them what to do. It does not say where to review harder, where agents keep getting it wrong, where it is safe to delegate more, or where nobody understands the code anymore.

Existing tools cover half of the picture each:

- Code cities and behavioral analysis (CodeCharta, Git Truck, CodeScene) show hotspots, ownership and coupling, but know nothing about AI authorship.
- AI attribution tools and formats (git-ai, Agent Trace) record which agent wrote which lines, but do not show it or turn it into decisions.

Agent City joins the two.

## Who it is for

Tech leads, engineering managers and platform teams whose developers use coding agents and who need to decide how to review, delegate and verify that work.

## Every view must answer a decision

A view that only produces a fun fact does not ship. Each insight states the question, the signal, and the action it supports.

| # | Question | Signal | Action it supports |
|---|---|---|---|
| 1 | Where do we need stricter review? | Hotspots (large files that change often) weighted by the share of agent-assisted changes | Add owners or a second reviewer there |
| 2 | Where do agents struggle? | Rework: later commits to the same file within 48 hours of an agent-assisted commit, by folder and file type | Improve agent context for that area, or stop delegating it |
| 3 | Where can we delegate more? | High agent share with low rework, over enough commits to trust | Lighter review, more delegation |
| 4 | Where is the verifier missing? | Agent-changed files whose test file never changed, or that have no test at all | Write tests before delegating more |
| 5 | What does nobody understand anymore? | Files written almost entirely by agents with at most one human contributor | Assign an owner, run a walkthrough |
| 6 | What breaks when edited alone? | Files that change together without importing each other | Refactor, or add the pair to agent context |
| 7 | Is it getting better or worse? | Agent share and rework over time | Check whether context and rule changes work |

Version 1 ships insights 1, 2, 4, 5 and a first form of 7 (before and after agent adoption). Agent share is the color layer in every view.

### When a repository has no agent records

Most repositories have none, so every insight is also computed over all changes, and agent records add a second, agent-only view on top. Without per-commit records, the first commit that added an agent instruction file (`CLAUDE.md`, `AGENTS.md`, `.cursor/`, Copilot instructions and others) marks when the team started using agents, and the periods before and after are compared. Guessing per-commit authorship from commit size or style is left out: it would be wrong often enough to blame people for work they did themselves.

## What it does not claim

- It does not judge whether code is correct. Rework and missing tests are signals, not verdicts.
- Insight quality depends on attribution records. Commits with no record are shown as "no record", never as human.
- Rework counts follow-up commits by anyone. The commit messages are shown next to the number so a person decides whether it was a fix.

## How it works

```
repo (path or git URL)
   │
   ▼
analyzer  ── git history, file sizes, attribution sources
   │
   ▼
city.json ── versioned, documented format
   │
   ▼
viewer    ── 3D city, insight panels, fly-to findings
```

### Attribution sources, most precise first

1. git-ai notes (`refs/notes/ai`): per line, per agent and model
2. Agent Trace records: per range, vendor-neutral (planned; the v0.1 spec does not fix a storage location yet)
3. Claude Code transcripts on the local machine: per file edit, with timestamps
4. Commit trailers (`Co-Authored-By: Claude`, Copilot, Cursor, Aider and similar): per commit
5. None of the above: "no record"

For a repository given by URL, only sources 1, 2 and 4 exist. Transcripts live only on a developer's own machine.

### The city

- District: a folder. Building: a file.
- Footprint: lines of code. Height: number of commits.
- Color: share of agent-assisted commits, grey for no record.
- Markers per insight: rework roofs, missing-verifier flags, review hotspots.

## Principles

1. **Local first.** Analysis and viewing run on the user's machine. No upload, no telemetry.
2. **Minimal dependencies.** Analyzer and CLI use only Node.js built-ins. The viewer's single dependency is Three.js (MIT), vendored into the repo.
3. **No build step.** Plain JavaScript modules with JSDoc types. Clone and run.
4. **Honest data.** Unknown stays unknown. Every number on screen can be traced to commits.
5. **Public.** MIT license for all code and documentation.

## How people use it

| Mode | Status | How |
|---|---|---|
| CLI | v1 | `npx agent-city <path or git URL>` analyzes, writes `city.json`, opens the viewer locally |
| Static viewer site | v1 | GitHub Pages site that opens any `city.json` by drag and drop or link, plus a gallery of public repos |
| GitHub Action | later | Rebuilds the city on every push and publishes to the repo's own Pages site; works for private repos |
| Hosted "paste a URL" | maybe | Needs a server that clones untrusted repos; not planned until the cost and abuse limits are worked out |

## Stack

- Node.js 22.4 or later, built-in modules only (`child_process`, `fs`, `path`, `http`)
- Browser ES modules, Three.js vendored
- `city.json` schema documented in `docs/city-format.md`

## Milestones

Each step is its own commit.

1. Vision, license, repo skeleton (done)
2. `city.json` format spec (done)
3. Analyzer: git history, sizes, treemap layout (done)
4. Attribution: trailers and Claude Code transcripts, then git-ai notes (done)
5. Insights 1, 2 and 4 computed in the analyzer (done)
6. Viewer: city, hover, color layers (done)
7. Viewer: insight panels with fly-to and commit evidence (done)
8. CLI: path or URL, clone, analyze, serve, open (done)
9. Static viewer site and gallery (done)
10. First public release (waiting for approval to create the GitHub repo and publish to npm)

## Success test

A tech lead opens the city of their own repo and, within a minute, names one area to review harder, one area where agents struggle, and one place that needs tests, each backed by commits they can click through. If they cannot, the view is redesigned before anything new is added.
