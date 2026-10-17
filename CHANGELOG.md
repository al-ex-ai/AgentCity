# Changelog

## 0.1.0 (unreleased)

First version.

- CLI: analyze a local repository or a git URL, write `city.json`, serve the viewer on 127.0.0.1
- Attribution from git-ai notes, Claude Code transcripts and AI commit trailers; unrecorded changes stay "no record"
- Insights: review hotspots, rework after agent commits, missing verifier
- Viewer: 3D city with agent share, rework and verifier layers, verdict strip, ranked findings with fly-to and commit evidence, drag and drop, example gallery
- `city.json` format version 1, documented in `docs/city-format.md`
- Dependencies: Node.js built-ins only for the analyzer; Three.js r160 vendored for the viewer
