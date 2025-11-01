import * as fs from "fs";
import * as path from "path";
import { IReviewProvider } from "./providers/IReviewProvider";
// Import vscode types only so TypeScript always has types available without
// forcing a runtime dependency on the `vscode` module (which isn't present
// when running unit tests outside of the VS Code test runner).
import type * as vscode from "vscode";

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

  constructor(
    workspaceRoot: string,
    outputChannel: vscode.OutputChannel | { appendLine(line: string): void },
    notifier?: Notifier
  ) {
    this.workspaceRoot = workspaceRoot;
    this.outputChannel = outputChannel;
    this.notifier = notifier;

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
      let reviewContent = "";
      for await (const fragment of chatResponse.text) {
        reviewContent += fragment;
      }

      cancellationTokenSource.dispose();

      if (reviewContent.trim().length === 0) {
        this.outputChannel.appendLine(
          "[Agent] Language model returned empty response, using stub"
        );
        return this.generateStubReview(files, oldHash, newHash);
      }

      this.outputChannel.appendLine(
        "[Agent] Successfully generated review using Language Model API"
      );

      return reviewContent;
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

    return `You are an expert code reviewer. Please provide a comprehensive code review for the following commit.

**Commit Range**: ${oldHash} → ${newHash}

**Changed Files (${files.length})**:
${fileList}

**Git Diff**:
\`\`\`diff
${truncatedDiff}
\`\`\`

Please provide a detailed code review in markdown format with the following sections:
1. **Summary**: Brief overview of the changes
2. **Code Quality**: Analysis of code quality, best practices, and potential issues
3. **Security Concerns**: Any security vulnerabilities or concerns
4. **Performance Considerations**: Performance implications of the changes
5. **Suggestions**: Specific recommendations for improvement

Keep the review professional, constructive, and actionable.`;
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
