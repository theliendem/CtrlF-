# Ctrl+F++: rules for Claude

We're building Ctrl+F++ at MadHacks 2026 (submissions close Sunday Nov 15 at 12:00 PM; we submit by 11:00 AM). One developer (Neil) with one Claude Code. The spec is docs/PRD.md; read it before writing code and follow it.

## How to work

- Build in the PRD's milestone order. Finish and verify each milestone in Chrome before starting the next.
- Commit and push after every working step and at the end of every milestone. Small commits, clear messages. Run the build before every push, and never push something that doesn't build or load.
- Demo-first: when you hit an edge case the demo doesn't need, skip it, leave a `// LATER:` comment at the spot, and add a line to docs/LATER.md. Don't build it.
- If something in the PRD is wrong or impossible in Chrome, stop and tell Neil, with one recommended fix. Don't quietly work around it.
- Keep explanations short and give one recommendation, not a list of options.
- Feature freeze is Sunday 6 AM. After that, bug fixes and demo hardening only.

## Hard rules

- All project code is written during MadHacks. Packages and frameworks are fine.
- The crawler is read-only: GET requests only. Never click buttons, submit forms, or fetch Canvas quizzes, submissions, grades, inbox or people pages.
- No LLMs and no sending page text to servers. The model runs on-device.
- Never commit tokens, passwords or personal data.
- Highlights use the CSS Custom Highlight API. Never edit a page's HTML.

## Tech

- Manifest V3, Vite, TypeScript (strict).
- The model, parsing and fetching live in an offscreen document. The service worker only routes messages and runs the queue.
- Shared message and data types live in one file (src/shared/types.ts). Don't invent message shapes inline.
