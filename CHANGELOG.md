# Changelog

All notable changes to Continuous AI Reviewer are documented here. Follow [Keep a Changelog](https://keepachangelog.com/) for conventions.

## [Unreleased]

- Improve review context: include full file contents for files < 500 lines and expand git diff context to 15 lines.
- Store generated review in extension global storage instead of workspace to avoid polluting git.
- Status bar: show progress on auto-triggered reviews; thumbs-up UI when no issues found.

## [0.0.1] - Initial release

- Automatic Git commit monitoring
- AI-powered code reviews using GitHub Copilot
- Inline decorations with smart line tracking
- "Mark as Fixed" feature for dismissing issues
- Persistent dismissed issue tracking
- Model selection support