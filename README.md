# Continuous AI Reviewer

Continuous AI Reviewer watches a Git repo and generates AI-powered code reviews using the VS Code Language Model API (Copilot). It surfaces findings as inline decorations, diagnostics (Problems panel), and a generated review file stored in the extension's global storage.

<!-- GIF: add a short demo GIF here (e.g. assets/demo.gif) -->

Summary
-------
- Automatic code review on new commits (or manual trigger)
- Inline editor decorations with hover details and quick actions
- Problems panel integration with Quick Fix to dismiss issues
- Select Copilot models and stream review generation

Quick links
-----------
- Code: `src/` (core implementation)
  - `src/agent.ts` — review generation, prompt building, file/diff gathering
  - `src/gitWatcher.ts` — detects commits and calls Agent
  - `src/decorationManager.ts` — editor decorations and hover UI
  - `src/diagnosticManager.ts` — Diagnostic API + Code Actions
  - `src/statusBarManager.ts` — progress/status UI
- Config: `package.json` (commands) and extension settings

Install & run
-------------
1. Clone the repo and open in VS Code.
2. Install dependencies with your package manager (pnpm is used in CI):

```powershell
pnpm install
pnpm run watch
```

3. Press F5 to launch an Extension Development Host.

Commands
--------
- `continuous-ai-reviewer.openReview` — Open generated review (stored in extension global storage)
- `continuous-ai-reviewer.generateReviewNow` — Generate a review for HEAD~1 → HEAD
- `continuous-ai-reviewer.selectModel` — Choose Copilot model
- `continuous-ai-reviewer.dismissIssue` — Dismiss an issue (used by UI)

Storage and persistence
-----------------------
- The generated `review.md` is stored in the extension global storage (not in the workspace) to avoid polluting git. See `Agent.writeReviewFile()` in `src/agent.ts`.
- Dismissed issues are persisted in `context.globalState` so they survive restarts.

Design notes & patterns
-----------------------
- Manager pattern: small single-responsibility managers (Decoration, Diagnostic, StatusBar) coordinate via the extension activation in `src/extension.ts`.
- Prompting: `Agent.buildReviewPrompt()` includes a git diff (now with 15-line context) and full file contents for files < 500 lines to give the model useful context.
- Light-weight syncing: diagnostics and decorations are bi-directionally synced when issues are dismissed.

Testing & development workflow
------------------------------
- Type-checking is performed via `tsc` (configured in `tsconfig.json`).
- Development builds use esbuild to produce `dist/extension.js`. The repo includes a `watch` task which runs both esbuild and `tsc` watchers.
- Run tests with the provided test task (see `package.json`).

Project-specific conventions
---------------------------
- Keep UI logic in manager classes under `src/` (e.g., `decorationManager.ts`).
- Prefer dynamic `require('vscode')` in runtime-only code to keep unit tests runnable outside VS Code.
- Use the extension's global storage for files that must not be committed to the workspace.

Troubleshooting
---------------
- If reviews aren't generated, ensure Copilot is signed in and the Language Model API is available.
- Large diffs are truncated (~50KB) to avoid token overflow; consider limiting repo size or adjusting prompt logic.

Contributing
------------
- Follow existing code patterns and tests under `src/test/`.
- Add unit tests for Agent logic (prompt building, file inclusion) where possible.

License
-------
MIT

Enjoy!
