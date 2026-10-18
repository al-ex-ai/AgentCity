# Changelog

## 0.1.0 (2026-10-17)

First version. Install with `npx github:al-ex-ai/AgentCity .` or try it at https://agentcity.al-ex.ai.

- CLI: analyze a local repository or a git URL, write `city.json`, serve the viewer on 127.0.0.1
- Attribution from git-ai notes, Claude Code transcripts and AI commit trailers; unrecorded changes stay "no record"
- Insights: review hotspots, rework, missing verifier and single-owner risk, each for all changes and, when records exist, for agent-assisted changes
- Agent adoption: finds the first agent instruction file and compares pace, change size, follow-ups and test habits before and after
- Viewer: 3D city with agent share, rework, verifier, owners and since-agents layers, agent or all-changes scope, verdict strip, ranked findings with fly-to and commit evidence, drag and drop, example gallery
- `city.json` format version 1, documented in `docs/city-format.md`
- Dependencies: Node.js built-ins only for the analyzer; Three.js r160 vendored for the viewer
