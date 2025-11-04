import * as fs from "fs";
import * as path from "path";
import { IReviewProvider } from "./providers/IReviewProvider";
// Import vscode types only so TypeScript always has types available without
// forcing a runtime dependency on the `vscode` module (which isn't present
// when running unit tests outside of the VS Code test runner).
import type * as vscode from "vscode";

// Define the JSON schema for AI responses
export interface Issue {
  id: number;
  severity: "low" | "medium" | "high";
  filename: string;
  line?: number;
  title: string;
  comments: string;
  category: string;
  suggestion?: string;
  // Line tracking for smart decoration positioning
  lineContent?: string; // The actual content of the line with the issue
  contextBefore?: string[]; // 2 lines before the issue (for matching)
  contextAfter?: string[]; // 2 lines after the issue (for matching)
  reviewCommit?: string; // The commit SHA this review is based on
}

export interface ReviewResponse {
  issues: Issue[];
}

// Notifier is an abstraction over VS Code's messaging/commands so unit tests
// don't need to require the `vscode` module at load time.
export interface Notifier {
  // Use vscode.Thenable types where appropriate so callers get the same
  // shape as the real VS Code API.
  showInformationMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined>;
  showErrorMessage(message: string): void;
  executeCommand(command: string, ...args: any[]): Promise<any>;
}

/**
 * Callback for when a review is completed
 */
export type ReviewCompletedCallback = (
  reviewResponse: ReviewResponse,
  reviewCommit: string
) => void;

/**
 * Agent handles the processing of changed files and generation of review files.
 *
 * Current implementation: Local stub that writes a review markdown file with
 * timestamp, commit range, and file list.
 *
 * Future: Will integrate with Copilot Agent endpoint to generate AI-powered reviews.
 */
export class Agent {
  // Prefer the real OutputChannel type when available, otherwise accept a
  // minimal appendLine-compatible stub (used in tests).
  private outputChannel:
    | vscode.OutputChannel
    | { appendLine(line: string): void };
  private workspaceRoot: string;
  private notifier?: Notifier;
  private extensionContext?: vscode.ExtensionContext;
  private reviewInProgress: boolean = false;
  private onReviewCompleted?: ReviewCompletedCallback;

  constructor(
    workspaceRoot: string,
    outputChannel: vscode.OutputChannel | { appendLine(line: string): void },
    notifier?: Notifier,
    extensionContext?: vscode.ExtensionContext
  ) {
    this.workspaceRoot = workspaceRoot;
    this.outputChannel = outputChannel;
    this.notifier = notifier;
    this.extensionContext = extensionContext;

    // If no notifier was provided (runtime in VS Code), lazily require vscode
    if (!this.notifier) {
      try {
        // At runtime we still require the `vscode` module, but the file now
        // has a type-only import for `vscode` so TypeScript tooling always
        // provides types. The dynamic require keeps tests working outside
        // of the VS Code environment.
        const vscodeModule = require("vscode") as typeof import("vscode");
        this.notifier = {
          showInformationMessage: (msg: string, ...actions: string[]) =>
            // wrap Thenable in a Promise so this Notifier surface remains a
            // Promise-based API and is easy to use in tests.
            Promise.resolve(
              vscodeModule.window.showInformationMessage(msg, ...actions)
            ),
          showErrorMessage: (msg: string) =>
            vscodeModule.window.showErrorMessage(msg),
          executeCommand: (cmd: string, ...args: any[]) =>
            Promise.resolve(vscodeModule.commands.executeCommand(cmd, ...args)),
        };
      } catch (e) {
        // No-op notifier when running in unit test environment
        this.notifier = {
          showInformationMessage: async () => undefined,
          showErrorMessage: () => undefined,
          executeCommand: async () => undefined,
        };
      }
    }
  }

  /**
   * Set callback to be invoked when a review is completed
   */
  setOnReviewCompleted(callback: ReviewCompletedCallback): void {
    this.onReviewCompleted = callback;
  }

  /**
   * Process changed files and generate a review.
   *
   * @param files List of changed file paths
   * @param oldHash Previous commit hash
   * @param newHash New commit hash
   */
  async processChanges(
    files: string[],
    oldHash: string,
    newHash: string
  ): Promise<void> {
    try {
      this.outputChannel.appendLine(
        "[Agent] Processing changes for commit range: " +
          oldHash +
          ".." +
          newHash
      );
      if (this.reviewInProgress) {
        this.outputChannel.appendLine(
          "[Agent] Review already in progress, skipping new request"
        );
        this.notifier?.showInformationMessage(
          "A code review is already in progress. Please wait for it to complete."
        );
        return;
      }
      // Generate review content using the new Language Model API
      // We no longer use the provider pattern since vscode.lm is the official API
      const reviewContent = await this.generateReviewContent(
        files,
        oldHash,
        newHash
      );

      // Write review file
      await this.writeReviewFile(reviewContent);

      this.outputChannel.appendLine(
        "[Agent] Review file generated successfully"
      );

      // Notify the user that the review has been generated and offer to open it
      try {
        const action = await this.notifier!.showInformationMessage(
          "Code review generated",
          "Open review"
        );
        if (action === "Open review") {
          await this.notifier!.executeCommand(
            "continuous-ai-reviewer.openReview"
          );
        }
      } catch (e) {
        // Ignore notification failures but log
        this.outputChannel.appendLine(
          "[Agent] Notification failed: " +
            (e instanceof Error ? e.message : String(e))
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        this.outputChannel.appendLine(
          "[Agent] Error processing changes: " + error.message
        );
        // Also notify the user of the failure
        try {
          this.notifier!.showErrorMessage(
            "Failed to generate code review: " + error.message
          );
        } catch (e) {
          // ignore
        }
      }
    }
  }

  /**
   * Generate review content using VS Code Language Model API.
   *
   * Uses vscode.lm to access Copilot models and generate AI-powered code reviews.
   */
  private async generateReviewContent(
    files: string[],
    oldHash: string,
    newHash: string
  ): Promise<string> {
    // Try to use VS Code Language Model API (vscode.lm)

    this.reviewInProgress = true;
    try {
      // Dynamically import vscode module for runtime access
      const vscodeModule = require("vscode") as typeof import("vscode");

      this.outputChannel.appendLine(
        "[Agent] Attempting to use VS Code Language Model API"
      );

      // Get model configuration from VS Code settings
      const config = vscodeModule.workspace.getConfiguration(
        "continuousAiReviewer"
      );
      const modelVendor = config.get<string>("modelVendor", "copilot");
      const modelFamily = config.get<string>("modelFamily", "gpt-4o");

      this.outputChannel.appendLine(
        `[Agent] Configured model: ${modelVendor}/${modelFamily}`
      );

      // Select a Copilot chat model using configured settings
      const models = await vscodeModule.lm.selectChatModels({
        vendor: modelVendor,
        family: modelFamily,
      });

      if (models.length === 0) {
        this.outputChannel.appendLine(
          "[Agent] No Copilot models available, falling back to stub"
        );
        return this.generateStubReview(files, oldHash, newHash);
      }

      const model = models[0];
      this.outputChannel.appendLine(
        `[Agent] Using model: ${model.vendor}/${model.family}/${model.version}`
      );

      // Get git diff for the commit range
      const diffContent = await this.getGitDiff(oldHash, newHash);

      // Build the prompt for the language model
      const prompt = this.buildReviewPrompt(
        files,
        oldHash,
        newHash,
        diffContent
      );

      // Create chat messages
      const messages = [vscodeModule.LanguageModelChatMessage.User(prompt)];

      // Send request to the language model with a cancellation token
      const cancellationTokenSource =
        new vscodeModule.CancellationTokenSource();
      const token = cancellationTokenSource.token;

      this.outputChannel.appendLine(
        "[Agent] Sending review request to language model..."
      );

      const chatResponse = await model.sendRequest(messages, {}, token);

      // Stream and collect the response
      let rawResponse = "";
      for await (const fragment of chatResponse.text) {
        rawResponse += fragment;
      }

      cancellationTokenSource.dispose();

      if (rawResponse.trim().length === 0) {
        this.outputChannel.appendLine(
          "[Agent] Language model returned empty response, using stub"
        );
        return this.generateStubReview(files, oldHash, newHash);
      }

      // Parse JSON response
      let reviewResponse: ReviewResponse;
      try {
        // Clean the response by removing any markdown code blocks if present
        let jsonString = rawResponse.trim();
        if (jsonString.startsWith("```json")) {
          jsonString = jsonString
            .replace(/^```json\s*/, "")
            .replace(/\s*```$/, "");
        } else if (jsonString.startsWith("```")) {
          jsonString = jsonString.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }

        reviewResponse = JSON.parse(jsonString);

        // Validate the response structure
        if (!reviewResponse.issues || !Array.isArray(reviewResponse.issues)) {
          throw new Error(
            "Invalid response structure: missing or invalid 'issues' array"
          );
        }

        // Add reviewCommit to each issue
        reviewResponse.issues.forEach((issue) => {
          issue.reviewCommit = newHash;
        });

        console.log(reviewResponse);

        this.outputChannel.appendLine(
          `[Agent] Successfully parsed ${reviewResponse.issues.length} issues from AI response`
        );
      } catch (parseError) {
        this.outputChannel.appendLine(
          "[Agent] Failed to parse JSON response: " +
            (parseError instanceof Error
              ? parseError.message
              : String(parseError))
        );
        this.outputChannel.appendLine(
          "[Agent] Raw response: " + rawResponse.substring(0, 500)
        );
        return this.generateStubReview(files, oldHash, newHash);
      }

      // Store the JSON data in extension context
      if (this.extensionContext) {
        const commitRange = `${oldHash}..${newHash}`;
        const storedReviews = this.extensionContext.globalState.get<{
          [key: string]: ReviewResponse;
        }>("reviews", {});
        storedReviews[commitRange] = reviewResponse;
        await this.extensionContext.globalState.update(
          "reviews",
          storedReviews
        );
        this.outputChannel.appendLine(
          "[Agent] Stored review data in extension context"
        );
      }

      // Notify DecorationManager if callback is set
      if (this.onReviewCompleted) {
        this.onReviewCompleted(reviewResponse, newHash);
      }

      // Generate markdown from the parsed issues
      const markdownContent = this.generateMarkdownFromIssues(
        reviewResponse,
        files,
        oldHash,
        newHash
      );

      this.outputChannel.appendLine(
        "[Agent] Successfully generated review using Language Model API"
      );

      return markdownContent;
    } catch (error) {
      // Handle Language Model errors
      this.outputChannel.appendLine(
        "[Agent] Exception caught in generateReviewContent"
      );

      if (error && (error as any).constructor.name === "LanguageModelError") {
        const lmError = error as any;
        this.outputChannel.appendLine(
          `[Agent] LanguageModelError: ${lmError.message} (code: ${lmError.code})`
        );

        if (lmError.cause) {
          this.outputChannel.appendLine(
            `[Agent] Cause: ${lmError.cause.message || String(lmError.cause)}`
          );
        }

        // Show user-friendly error message based on error code
        if (lmError.message?.includes("consent")) {
          this.outputChannel.appendLine(
            "[Agent] User has not given consent to use Language Models"
          );
          this.notifier?.showErrorMessage(
            "Please grant permission to use GitHub Copilot for code reviews"
          );
        } else if (lmError.message?.includes("quota")) {
          this.outputChannel.appendLine(
            "[Agent] Language Model quota exceeded"
          );
          this.notifier?.showErrorMessage(
            "Language model quota exceeded. Try again later."
          );
        }
      } else if (error instanceof Error) {
        this.outputChannel.appendLine(
          "[Agent] Error using Language Model API: " + error.message
        );
        this.outputChannel.appendLine("[Agent] Stack: " + error.stack);
      } else {
        this.outputChannel.appendLine(
          "[Agent] Unknown error: " + String(error)
        );
      }

      // Fall back to stub review
      this.outputChannel.appendLine(
        "[Agent] Falling back to stub review due to error"
      );
      return this.generateStubReview(files, oldHash, newHash);
    } finally {
      this.reviewInProgress = false;
    }
  }

  /**
   * Get git diff for the commit range.
   */
  private async getGitDiff(oldHash: string, newHash: string): Promise<string> {
    try {
      const cp = require("child_process");
      const { promisify } = require("util");
      const exec = promisify(cp.exec);

      const cmd = `git diff ${oldHash} ${newHash}`;
      const { stdout } = await exec(cmd, { cwd: this.workspaceRoot });

      this.outputChannel.appendLine(
        `[Agent] Retrieved git diff (${stdout.length} bytes)`
      );

      return stdout;
    } catch (error) {
      this.outputChannel.appendLine(
        "[Agent] Failed to get git diff: " +
          (error instanceof Error ? error.message : String(error))
      );
      return "";
    }
  }

  /**
   * Build a structured prompt for the language model.
   */
  private buildReviewPrompt(
    files: string[],
    oldHash: string,
    newHash: string,
    diffContent: string
  ): string {
    const fileList = files.map((f) => `- ${f}`).join("\n");

    // Limit diff size to prevent token overflow (max ~50KB)
    const maxDiffSize = 50000;
    const truncatedDiff =
      diffContent.length > maxDiffSize
        ? diffContent.substring(0, maxDiffSize) +
          "\n\n... (diff truncated due to size) ..."
        : diffContent;

    return `You are a senior software engineer conducting a code review. Analyze the following commit and provide feedback in JSON format.

**Commit Range**: ${oldHash} → ${newHash}

**Changed Files (${files.length})**:
${fileList}

**Git Diff**:
\`\`\`diff
${truncatedDiff}
\`\`\`

Please respond with a JSON object containing an array of issues found in the code changes. Each issue should have the following structure:

{
  "issues": [
    {
      "id": <unique number starting from 1>,
      "severity": "low" | "medium" | "high",
      "filename": "<relative path to file>",
      "line": <line number if applicable, otherwise omit>,
      "lineContent": "<the exact content of the line with the issue (for tracking)>",
      "title": "<brief title of the issue>",
      "comments": "<detailed explanation of the issue>",
      "category": "<one of: code-quality, security, performance, bug, style, documentation, testing>",
      "suggestion": "<optional: specific recommendation for how to fix the issue>"
    }
  ]
}

Guidelines:
- Be critical but constructive
- Focus on real issues, not nitpicks
- Include line numbers when possible
- **IMPORTANT**: Include the exact line content in "lineContent" field for accurate tracking
- Cover code quality, security, performance, and potential bugs
- Only include issues that are relevant to the changes
- If no issues found, return an empty issues array

Respond only with valid JSON, no additional text or markdown formatting.`;
  }

  /**
   * Generate a stub review when Language Model API is unavailable.
   */
  private generateStubReview(
    files: string[],
    oldHash: string,
    newHash: string
  ): string {
    const timestamp = new Date().toISOString();
    const fileList = files.map((f) => `- ${f}`).join("\n");

    return `# Code Review\n\n**Generated**: ${timestamp}\n\n**Commit Range**: \`${oldHash}\` → \`${newHash}\`\n\n## Changed Files (${files.length})\n\n${fileList}\n\n## Review\n\nThis is an automated review stub. The Language Model API was unavailable.\n\nTo enable AI-powered reviews:\n1. Ensure GitHub Copilot extension is installed and activated\n2. Sign in to GitHub Copilot\n3. Grant necessary permissions when prompted\n\n---\n*Generated by Continuous AI Reviewer*\n`;
  }

  /**
   * Generate markdown content from parsed issues.
   */
  private generateMarkdownFromIssues(
    reviewResponse: ReviewResponse,
    files: string[],
    oldHash: string,
    newHash: string
  ): string {
    const timestamp = new Date().toISOString();
    const fileList = files.map((f) => `- ${f}`).join("\n");
    const issues = reviewResponse.issues;

    let markdown = `# Code Review\n\n**Generated**: ${timestamp}\n\n**Commit Range**: \`${oldHash}\` → \`${newHash}\`\n\n## Changed Files (${files.length})\n\n${fileList}\n\n`;

    if (issues.length === 0) {
      markdown += `## Review\n\n✅ **No issues found.** The code changes look good!\n\n`;
    } else {
      markdown += `## Issues Found (${issues.length})\n\n`;

      // Group issues by severity
      const highSeverity = issues.filter((i) => i.severity === "high");
      const mediumSeverity = issues.filter((i) => i.severity === "medium");
      const lowSeverity = issues.filter((i) => i.severity === "low");

      // Sort issues by severity (high first) and then by id
      const sortedIssues = [...highSeverity, ...mediumSeverity, ...lowSeverity];

      for (const issue of sortedIssues) {
        const severityEmoji =
          issue.severity === "high"
            ? "🔴"
            : issue.severity === "medium"
            ? "🟡"
            : "🟢";

        markdown += `### ${severityEmoji} ${issue.title}\n\n`;
        markdown += `**File**: \`${issue.filename}\`\n`;
        if (issue.line) {
          markdown += `**Line**: ${issue.line}\n`;
        }
        markdown += `**Severity**: ${issue.severity}\n`;
        markdown += `**Category**: ${issue.category}\n\n`;
        markdown += `${issue.comments}\n\n`;
        if (issue.suggestion) {
          markdown += `**Suggestion**: ${issue.suggestion}\n\n`;
        }
        markdown += `---\n\n`;
      }

      // Summary by severity
      markdown += `## Summary\n\n`;
      if (highSeverity.length > 0) {
        markdown += `- 🔴 **High severity**: ${highSeverity.length} issue${
          highSeverity.length > 1 ? "s" : ""
        }\n`;
      }
      if (mediumSeverity.length > 0) {
        markdown += `- 🟡 **Medium severity**: ${mediumSeverity.length} issue${
          mediumSeverity.length > 1 ? "s" : ""
        }\n`;
      }
      if (lowSeverity.length > 0) {
        markdown += `- 🟢 **Low severity**: ${lowSeverity.length} issue${
          lowSeverity.length > 1 ? "s" : ""
        }\n`;
      }
      markdown += `\n`;
    }

    markdown += `---\n*Generated by Continuous AI Reviewer*\n`;
    return markdown;
  }

  /**
   * Write the review content to review/review.md
   */
  private async writeReviewFile(content: string): Promise<void> {
    const reviewDir = path.join(this.workspaceRoot, "review");
    const reviewFile = path.join(reviewDir, "review.md");

    // Create review directory if it doesn't exist
    if (!fs.existsSync(reviewDir)) {
      fs.mkdirSync(reviewDir, { recursive: true });
      this.outputChannel.appendLine("[Agent] Created review directory");
    }

    // Write review file
    fs.writeFileSync(reviewFile, content, "utf-8");
    this.outputChannel.appendLine("[Agent] Review written to: " + reviewFile);
  }
}
