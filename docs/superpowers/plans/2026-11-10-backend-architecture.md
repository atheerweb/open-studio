# Backend Architecture Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** Give a user opening a Laravel backend an explorable architecture map inside Open Studio.

**Architecture** Analyze eligible local source and adapt saved Understand Anything artifacts to a shared graph shape. The server manages revision checks and a per-folder cache. The workspace tab draws the graphs and opens verified source evidence.

**Tech stack** Node.js 24, Git, React, SVG, PowerShell.

**Spec** [Backend architecture design](../specs/2026-11-10-understand-anything-architecture-design.md).

## Global constraints

- Preserve the selected folder as the analysis boundary and exclude secrets, dependency trees, generated files, and symlinks.
- Never modify the backend files or install project hooks.
- Exercise the feature with the Lawsuit lifecycle in `nwc-legal` and keep Vue preview independent.

## Review focus

- Missing graph artifacts and restricted network still allow Laravel generation.
- Alternate transitions must be tied to source evidence.
- Imported paths outside the folder must never become source links.
- An unchanged source fingerprint must skip duplicate regeneration.
- Terminal failure must preserve the Git exit code and avoid reporting success.

## Tasks

- [x] Add `test/architecture.test.mjs` coverage for `analyzeArchitecture(files, artifacts)`, including local workflow extraction and dangling or unsafe artifact paths. Run it red, then add `server/architecture-graph.mjs` and run it green.
- [x] Add a snapshot, graph import, cache and refresh controller in `server/architecture.mjs`. Wire live folder lifecycle and Git success in `server/studio.mjs`. Verify cache reuse, evidence reads, and selected folder boundaries.
- [x] Add `server/architecture-terminal.ps1` for opt-in terminal completion markers, with ref checks as a fallback. Test pull and push with a disposable remote.
- [x] Add `src/architecture-panel.jsx` and workspace tab wiring for the three views, branch expansion, and the source inspector.
- [x] Build, run the test suite, and smoke-test the architecture endpoint against `nwc-legal`.

## Implementation decisions

- Use local Laravel analysis by default. With project consent, an adapter can invoke the user's installed Codex skills against an isolated snapshot and import the results. The runtime's output boundary is tested with a stand-in. The upstream source was inspected, and the skill was not run against the private Laravel project.
- Use additive changes in the current workspace. The checkout already has Git UI edits, so preserve those changes and avoid committing them.
