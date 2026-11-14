# Ctrl+F++: rules for every Claude on this team

We're building Ctrl+F++ at MadHacks 2026 (Nov 14-15). Four teammates (A, B, C, D) work in parallel on this one repo. Three of them each run their own Claude Code on their own clone, so you are one of several Claudes merging into the same main branch. These rules keep us from breaking each other.

## Before you write any code

1. Your human told you which teammate you are. If they didn't, ask.
2. Read docs/PRD.md, then your task file docs/tasks/teammate-<letter>.md.
3. Read shared/contracts.ts and shared/engine-api.ts. These are the interfaces everyone codes against.
4. Read every file in docs/status/ to see what the others have done and what they need.
5. Run `git checkout main && git pull` so you start from the latest main, then create your branch (see Git workflow below).

## Folder ownership

Only edit files you own. Anything else is read-only for you.

| Path | Owner |
| --- | --- |
| CLAUDE.md, README.md, docs/PRD.md, docs/tasks/ | A |
| shared/contracts.ts, shared/engine-api.ts, shared/engine-stub.ts | A |
| shared/fixtures/synthetic/ | A |
| shared/fixtures/canvas/, shared/fixtures/queries.json | D |
| extension/manifest.json, extension/package.json, build config | A |
| extension/src/background/, extension/src/offscreen/ | A |
| extension/src/sources/ (except pdf.ts) | A |
| engine/, extension/src/engine/, extension/src/sources/pdf.ts | B |
| extension/src/content/, extension/src/sidepanel/, extension/src/pdfviewer/ | C |
| databricks/, docs/devpost.md, docs/pitch.md | D |
| docs/status/teammate-<x>.md | That teammate only |

Need a change in a file you don't own (a new contract field, a new npm dependency, a manifest permission)? Don't make it. Write it under "Needs from others" in your own status file, tell your human, and keep working against a local stub.

## Git workflow: short-lived branches, merge often

Nobody commits or pushes directly to main. Every change goes through a branch and a pull request. Folder ownership still keeps conflicts rare; branches make sure main only ever gets code that builds.

1. **Start each step from fresh main:**
   ```
   git checkout main && git pull
   git checkout -b <letter>/<short-topic>      # e.g. b/search-topk, c/highlight-scroll
   ```
2. **Commit small and often** on your branch. Start every commit message with your letter: `[B] search() returns top-k with keyword boost`.
3. **Before pushing:** `git fetch origin && git rebase origin/main`, then run the build (`npm run build` in extension/, plus `wasm-pack build` if you touched engine/). Only push if the build passes.
4. **Push the branch and open a PR:**
   ```
   git push -u origin <letter>/<short-topic>
   gh pr create --base main --fill
   ```
   PR title starts with your letter too: `[B] search() returns top-k`.
5. **Merge it yourself** once the build passes and the PR only touches files you own: `gh pr merge --squash --delete-branch`. If it touches shared/ or anything another teammate owns, ask that owner (through your human) to approve first.
6. **Then start the next step** from step 1. Keep branches short-lived: merge at least every 30 to 45 minutes. A branch that lives for hours will drift and conflict.

Rules:

- Never push to main, never force push to main, never rewrite main's history. Force pushing your own branch after a rebase is fine (`git push --force-with-lease`).
- If a rebase conflicts in a file you don't own, stop, run `git rebase --abort`, and tell your human.
- Unfinished work stays behind a stub or a flag so main always builds and loads in Chrome.
- Teammate D (github.com only): when committing in the browser, pick "Create a new branch for this commit and start a pull request", then click "Merge pull request" on the next page.

## Status files

Update your own docs/status/teammate-<x>.md in every PR, so it lands on main together with the work (keep it short, newest at top):

- **Works now:** what someone else can use right now
- **Next:** what you're doing next
- **Needs from others:** requests, each tagged with who it's for
- **Notes:** anything others must know (changed behavior, known bugs)

Before starting each new step, pull main and re-read the other status files. If someone needs something from you, handle it first when it's small.

## Hard rules

- All code is written during MadHacks. Packages and frameworks are fine; prewritten project code is not.
- The crawler is read-only: GET requests only. Never click buttons, submit forms, or call anything that changes state. Never fetch Canvas quizzes, submissions, grades, inbox or people pages.
- Never put tokens, passwords or API keys in the repo.
- Never commit personal data. Canvas fixtures must have student names removed.
- Build against fixtures first, so your part works before anyone else's is done.
- Canvas must work 100% before polishing anything for other sites.

## Tech conventions

- TypeScript, strict mode, ES modules. The extension is Manifest V3, built with Vite.
- Rust lives in engine/, built with `wasm-pack build --target web`. Teammate B commits the built package into extension/src/engine/pkg/ so nobody else needs a Rust toolchain.
- Until B's engine is ready, everything uses shared/engine-stub.ts (keyword scoring with the same interface). Swapping to the real engine must be a one-line change.
- Messages between parts use the types in shared/contracts.ts. Don't invent message shapes inline.
