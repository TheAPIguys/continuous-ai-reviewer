# Continuous AI Reviewer

Continuous AI Reviewer watches a Git repo and generates AI-powered code reviews using the VS Code Language Model API (Copilot). It surfaces findings as inline decorations, diagnostics (Problems panel), and a generated review file stored in the extension's global storage.

## Demo

![Continuous AI Reviewer Demo](assets/demo.gif)

## Features
-----------
- **Automatic code reviews** — Watches your Git repository and generates AI-powered reviews on new commits
- **Manual trigger** — Generate a review anytime with the "Generate Review Now" command
- **Inline editor feedback** — View issues directly in your editor with decorations, hover details, and quick actions
- **Problems panel integration** — See all issues in the Problems panel with Quick Fix options to dismiss them
- **Model selection** — Choose your preferred Copilot model before generating reviews
- **Real-time streaming** — Reviews are generated and streamed in real-time

## Usage
--------
### Commands
- `continuous-ai-reviewer.openReview` — Open the generated review
- `continuous-ai-reviewer.generateReviewNow` — Manually generate a review for the latest commit
- `continuous-ai-reviewer.selectModel` — Choose which Copilot model to use for reviews

### How It Works
1. The extension watches your Git repository for new commits
2. When a commit is detected, it automatically generates an AI-powered code review
3. Issues are displayed as inline decorations in the editor and in the Problems panel
4. Dismiss issues individually or view the full review file at any time

## Getting Help & Support
-------------------------
### Report Issues
Found a bug or have a feature request? [Report it on GitHub](https://github.com/TheAPIguys/continuous-ai-reviewer/issues)

### Contribute to the Project
We welcome contributions! Help us improve Continuous AI Reviewer by [contributing on GitHub](https://github.com/TheAPIguys/continuous-ai-reviewer)

## Troubleshooting
-----------------
- **No reviews generating?** Ensure GitHub Copilot is installed, you're signed in, and have granted the necessary permissions
- **Issues not showing?** Check the "Continuous AI Reviewer" output channel for debug information
- **Performance issues?** Large diffs may be truncated (~50KB) to avoid token limits. Consider the size of your commits

License
-------
MIT

Enjoy!
