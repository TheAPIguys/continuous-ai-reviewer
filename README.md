# Continuous AI Reviewer

Automatically monitors your Git repository for new commits and generates AI-powered code reviews using GitHub Copilot. Reviews are displayed as inline decorations in your editor with smart line tracking.

## Features

### 🤖 Automatic Code Reviews
- Watches your Git repository for new commits
- Generates comprehensive AI reviews using GitHub Copilot's Language Model API
- Creates structured reviews with issues categorized by severity (high, medium, low)

### 📍 Smart Inline Decorations
- Issues appear as colored decorations in your editor:
  - 🔴 **Red** = High severity
  - 🟡 **Yellow** = Medium severity  
  - 🟢 **Green** = Low severity
- Decorations track code changes intelligently:
  - **Solid icon** = Exact line match (high confidence)
  - **Dashed icon** = Approximate match (code may have changed)

### ✅ Mark Issues as Fixed
- Click **"✅ Mark as Fixed"** button in issue hover tooltip
- Dismissed issues stay hidden across VS Code sessions
- Run **"Show All Dismissed Issues"** command to restore them
- Simple, user-controlled workflow - no auto-detection guesswork!

### 🎯 Rich Hover Details
Hover over any decorated line to see:
- Issue title and severity
- Detailed explanation
- Category (e.g., Security, Performance, Best Practices)
- AI-generated suggestions for fixes
- Commit SHA this review is based on

### 🔧 Customizable AI Models
- Select from available GitHub Copilot models
- Choose between standard and premium models (o1-preview, o1-mini, etc.)
- Configure via Command Palette: **"Select AI Model"**

## Requirements

- **GitHub Copilot subscription** (required for AI model access)
- **Git repository** in your workspace
- **VS Code 1.105.0+**

## Extension Settings

This extension contributes the following settings:

* `continuousAiReviewer.modelVendor`: The AI model vendor (default: `"copilot"`)
* `continuousAiReviewer.modelFamily`: The AI model family to use (default: `"gpt-4o"`)

## Commands

Access these from the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **`cRV`** - Quick alias to open the review file
- **`Continuous AI Reviewer: Open review file`** - Open `review/review.md`
- **`Continuous AI Reviewer: Select AI Model`** - Choose which Copilot model to use
- **`Continuous AI Reviewer: Generate Review Now`** - Manually trigger review for last commit
- **`Continuous AI Reviewer: Clear Decorations`** - Hide all issue decorations
- **`Continuous AI Reviewer: Show All Dismissed Issues`** - Restore dismissed issues

## How to Use

1. **Open a Git repository** in VS Code
2. **Make commits** as you normally would
3. **Extension automatically generates reviews** for each new commit
4. **Review issues** shown as inline decorations
5. **Hover over decorations** to see details and suggestions
6. **Click "Mark as Fixed"** on issues you've addressed
7. **Check `review/review.md`** for full review text

## Known Issues

- Extension only monitors the first workspace folder in multi-root workspaces
- Large diffs (>50KB) are truncated to prevent token overflow
- Stale issues (where line cannot be found) are hidden from decorations

## Release Notes

### 0.0.1

Initial release:
- Automatic Git commit monitoring
- AI-powered code reviews using GitHub Copilot
- Inline decorations with smart line tracking
- "Mark as Fixed" feature for dismissing issues
- Persistent dismissed issue tracking
- Model selection support

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
