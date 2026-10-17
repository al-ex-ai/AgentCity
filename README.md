# Agent City

A 3D city of your codebase that shows where coding agents write your code, and what that code costs you afterwards: where to review harder, where agents struggle, and where tests are missing.

**Live demo: [agentcity.al-ex.ai](https://agentcity.al-ex.ai)**

![git-truck as a city, colored by how much of each file's history came after the team adopted coding agents](docs/screenshot.png)

Files are buildings, folders are districts. Footprint is lines of code, height is how often the file changes, and color is the share of changes that were agent-assisted.

```
npx agent-city .                                   # analyze the current repository
npx agent-city https://github.com/owner/repo.git   # or any git URL you can clone
```

The analysis runs on your machine, writes `<repo>.city.json`, and opens the viewer on `http://127.0.0.1`. Nothing is uploaded.

## What it answers

Every view is there to support a decision.

| Question | Signal | What you can do |
|---|---|---|
| **Where do we need stricter review?** | Large files that change often | Add owners or a second reviewer there |
| **What keeps getting reworked? Where do agents struggle?** | Commits to the same file within 48 hours of the previous one, or of an agent-assisted one | Improve the agent's context for that area, or stop delegating it |
| **Where is the verifier missing?** | Source files whose test never changes alongside them, or that have no test | Write the tests before delegating more |
| **What does only one person know?** | Files a single person changed, or that agents wrote with one human | Assign a second owner, run a walkthrough |
| **What changed since agents arrived?** | Pace, change size, follow-ups and test habits before and after the first agent instruction file (`CLAUDE.md`, `AGENTS.md`, `.cursor/`, Copilot instructions and others) | Check whether adoption is improving the work or just speeding it up |

Every insight works on all changes, so a repository with no agent records still gets findings. When agent records exist, switch to **Agent changes** to see the same questions for agent-assisted work only.

Click a finding to fly to the building and see the commits behind it. Color layers: agent share, rework, verifier, owners, and "since agents".

See [VISION.md](VISION.md) for the full set of questions planned.

## Where attribution comes from

Agent City only counts what something actually recorded. A change with no record is shown as "no record", never as human.

| Source | Precision | Available for |
|---|---|---|
| [git-ai](https://github.com/git-ai-project/git-ai) notes (`refs/notes/ai`) | Per line | Any repo that uses git-ai, local or by URL |
| Claude Code transcripts (`~/.claude/projects`) | Per file edit | Local repositories on the machine where the agent ran |
| Commit trailers (`Co-Authored-By: Claude`, Copilot, Cursor, Aider, Devin and others) | Per commit | Any repo, local or by URL |

Agent edits made through shell commands are not visible in transcripts, so the agent share is a lower bound.

## Options

```
agent-city [repo] [options]

  -o, --out <file>        Where to write city.json (default: ./<repo>.city.json)
      --no-open           Do not open the browser
      --no-serve          Only write city.json
  -p, --port <n>          Port for the local viewer
      --since <date>      Only analyze commits after this date
  -x, --exclude <glob>    Leave matching paths out, repeatable
      --rework-hours <n>  Follow-up window for rework (default 48)
      --transcripts <dir> Claude Code transcript folder
      --no-transcripts    Do not read Claude Code transcripts
      --keep-clone        Keep the temporary clone of a URL
```

## Viewer only

The viewer is a static site in [`viewer/`](viewer). Open any `city.json` with the button or by dropping the file, or link to one with `?city=<url>`. With no file, it shows the landing page and example cities. [agentcity.al-ex.ai](https://agentcity.al-ex.ai) serves this folder as is; [`deploy/`](deploy) has the git hook that publishes it.

## The city.json format

The analyzer and the viewer talk through a documented, versioned file format: [docs/city-format.md](docs/city-format.md). Other tools can write it and use the viewer.

## Design choices

- **Local first.** No upload, no telemetry. The viewer server binds to 127.0.0.1.
- **Minimal dependencies.** The analyzer and CLI use only Node.js built-ins. The viewer's one dependency, Three.js (MIT), is vendored in `viewer/vendor/three`.
- **No build step.** Plain JavaScript modules with JSDoc types.

Requires Node.js 22.4 or later and git.

## Limits

- It does not judge whether code is correct. Rework and missing tests are signals for a person to check, which is why every number links to its commits.
- Rework counts follow-up commits by anyone, so continuing work and fixing a mistake look the same. Read the commit messages.
- Renames are followed, but files deleted before HEAD are not shown.
- Test matching uses file naming conventions (`foo.test.ts`, `test_foo.py`, `foo_test.go`, `FooTest.java`, `__tests__/`).

## Develop

```
node --test                     # unit tests
node bin/agent-city.js .        # analyze this repository and open the viewer
node scripts/build-gallery.js   # rebuild the example gallery
```

## License

[MIT](LICENSE). Three.js is MIT licensed, see [viewer/vendor/three/LICENSE](viewer/vendor/three/LICENSE).
