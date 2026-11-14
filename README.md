# Ctrl+F++

A Chrome extension that finds what you mean, not just what you typed, and digs through linked pages to find it. Built at MadHacks 2026. Spec: docs/PRD.md.

## Getting started

**Teammates A, B and C (Claude Code):**

1. `git clone <repo url>` and `cd` into it.
2. Open Claude Code in the repo folder.
3. Paste this, with your own letter: `You are Teammate B. Read CLAUDE.md, then docs/tasks/teammate-b.md, and start.`

**Teammate D (no Claude Code):** open docs/tasks/teammate-d.md on GitHub and follow it in your browser. You can add and edit files right on github.com.

## Load the extension in Chrome

1. `cd extension && npm install && npm run build`
2. Go to chrome://extensions and turn on Developer mode.
3. Click "Load unpacked" and pick extension/dist.
4. After pulling new changes from main, rebuild and click the reload icon on the extension card.

## Who owns what

See the ownership table in CLAUDE.md. Status for each teammate is in docs/status/.
