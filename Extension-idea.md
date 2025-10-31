# Continuous AI Reviewer — Extension Description

Purpose

The Continuous AI Reviewer extension automatically listens for new Git commits in a workspace, determines which files changed between commits, and generates a human- and machine-readable review file (review/review.md) summarizing the changes and, in future, embedding an AI-generated review produced by a Copilot-style agent.

High-level flow

- Extension activates when VS Code starts (activationEvent: onStartupFinished).
- A Git watcher tracks the repository HEAD. Current implementation polls `git rev-parse HEAD` on an interval; when HEAD changes it runs `git diff --name-only <old> <new>` to obtain changed file list.
- The changed file paths and commit range are passed to an Agent component.
- The Agent component is responsible for contacting a remote AI (future GitHub Copilot Agent integration) or running local logic to produce a review markdown file at `review/review.md`.

Primary components and responsibilities

- GitWatcher (src/gitWatcher.ts)
  - Detects new commits. Current strategy: a safe CLI polling fallback using `git`.
  - Computes changed file list between commits using `git diff --name-only`.
  - Calls Agent.processChanges(files, oldHash, newHash) asynchronously.
  - Disposable (cleans up timers) and logs to the extension OutputChannel.

- Agent (src/agent.ts)
  - Current: a local stub that writes `review/review.md` with a timestamp, commit range, and file list.
  - Future: will call a Copilot Agent endpoint, sending a prompt and diffs, receiving a structured review, and writing it to `review/review.md`.
  - Must handle networking, retries, backoff, and secure credential storage (VS Code SecretStorage) when integrating with remote services.

- Extension entry (src/extension.ts)
  - Wires OutputChannel, creates Agent and GitWatcher instances, registers disposables.

Design contract (inputs / outputs / errors)

- Inputs
  - Workspace root path (folder where `.git/` exists).
  - Commit range (oldHash, newHash) and list of changed file paths.

- Outputs
  - A generated markdown file at `review/review.md` inside the workspace.
  - Optional logs written to the `Continuous AI Reviewer` Output channel.

- Error modes
  - No Git repo / no workspace folder: extension remains idle and logs a message.
  - Git CLI failures: watcher logs and continues polling; no review generated for that event.
  - Agent failures (network/auth): Agent logs the error; consider retry and fallback to a local summary.

Edge cases and considerations

- Large diffs: for very large commits (many files or large file contents), sending full diffs to a remote agent may be expensive. Consider:
  - Limiting total size of content sent.
  - Sending file lists + hunks for changed files, or extracting only changed lines.
  - Offloading heavy work to background tasks.

- Private repositories / secrets: never store credentials in plaintext. Use VS Code SecretStorage or prompt the user to provide tokens via secure channels.

- Multi-root workspaces: the extension currently uses the first workspace folder. Future improvement: support per-repository watchers when multiple workspace folders are open.

Testing plan

- Unit & integration testing will use `@vscode/test-electron` so tests run in a reproducible VS Code test host.
- We'll add both fast unit tests that exercise pure-Node logic (Agent file-writing) and integration tests that run inside the extension development host if needed.

Quality gates

- Build: `pnpm run compile` must succeed producing `out/` artifacts.
- Tests: `pnpm test` will compile and run the test suite using `@vscode/test-electron`.

How to run tests (developer)

1. Ensure dependencies are installed with pnpm:

```powershell
pnpm install
```

2. Run the test suite (this compiles the extension then launches an ephemeral VS Code instance to execute tests):

```powershell
pnpm test
```

Files added in this change

- `docs/EXTENSION_DESCRIPTION.md` — this document (design, contract, edge cases, and test plan).
- Test infra files added under `src/test/` and `src/test/suite/` (test runner and a sample `Agent` unit test).

Next steps

- Replace Agent stub with a networked integration that calls the Copilot Agent endpoint and securely manages credentials.
- Replace polling GitWatcher with event-driven detection via the VS Code Git extension API for more reliability and performance.
- Add more unit tests: GitWatcher behavior, edge-case diffs, and integration test that validates the full commit->review flow in a sample repo.
