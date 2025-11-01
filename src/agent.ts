import * as fs from "fs";
import * as path from "path";
import { IReviewProvider } from "./providers/IReviewProvider";

// Notifier is an abstraction over VS Code's messaging/commands so unit tests
// don't need to require the `vscode` module at load time.
export interface Notifier {
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
  private outputChannel: any;
  private workspaceRoot: string;
  private provider?: IReviewProvider;
  private notifier?: Notifier;
  private fallbackProvider?: IReviewProvider;

  constructor(
    workspaceRoot: string,
    outputChannel: any,
    provider?: IReviewProvider,
    notifier?: Notifier,
    fallbackProvider?: IReviewProvider
  ) {
    this.workspaceRoot = workspaceRoot;
    this.outputChannel = outputChannel;
    this.provider = provider;
    this.notifier = notifier;
    this.fallbackProvider = fallbackProvider;

    // If no notifier was provided (runtime in VS Code), lazily require vscode
    if (!this.notifier) {
      try {
        // require at runtime so unit tests that run outside VS Code don't fail
        // when resolving the 'vscode' module.
        const vscode = require("vscode");
        this.notifier = {
          showInformationMessage: (msg: string, ...actions: string[]) =>
            vscode.window.showInformationMessage(msg, ...actions),
          showErrorMessage: (msg: string) =>
            vscode.window.showErrorMessage(msg),
          executeCommand: (cmd: string, ...args: any[]) =>
            vscode.commands.executeCommand(cmd, ...args),
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

      // Generate review content — prefer pluggable provider if available
      let reviewContent: string;
      // Prefer provider-based generation. If a provider exists, use it. If it
      // fails, fall back to generateReviewContent which itself will attempt to
      // use the Copilot extension if available.
      if (this.provider) {
        try {
          reviewContent = await this.provider.generateReview(
            files,
            oldHash,
            newHash
          );
        } catch (err) {
          this.outputChannel.appendLine(
            "[Agent] Provider failed, falling back to local generator: " +
              (err instanceof Error ? err.message : String(err))
          );
          reviewContent = await this.generateReviewContent(
            files,
            oldHash,
            newHash
          );
        }
      } else {
        reviewContent = await this.generateReviewContent(
          files,
          oldHash,
          newHash
        );
      }

      // If provider returned a fallback prompt (e.g., Copilot fallback),
      // and a fallbackProvider (API) is available, use it to generate a real review.
      if (
        this.fallbackProvider &&
        typeof reviewContent === "string" &&
        // Accept a few Copilot fallback variants. Some providers return
        // "# Copilot (fallback) Review" while others used to return
        // variants like "# Copilot Review (sent to Copilot UI)". Match
        // either form so the fallback provider gets invoked reliably.
        /^# Copilot.*Review/.test(reviewContent)
      ) {
        try {
          this.outputChannel.appendLine(
            "[Agent] Provider returned fallback prompt; invoking fallbackProvider"
          );
          const apiContent = await this.fallbackProvider.generateReview(
            files,
            oldHash,
            newHash
          );
          if (apiContent && apiContent.trim().length > 0) {
            reviewContent = apiContent;
          }
        } catch (e) {
          this.outputChannel.appendLine(
            "[Agent] fallbackProvider failed: " +
              (e instanceof Error ? e.message : String(e))
          );
        }
      }

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
   * Generate review content (stub implementation).
   *
   * This is a placeholder that creates a basic markdown structure.
   * Future: Replace with actual AI review generation.
   */
  private async generateReviewContent(
    files: string[],
    oldHash: string,
    newHash: string
  ): Promise<string> {
    // If a Copilot provider is present, try to use it first. This allows the
    // local fallback path to still leverage the Copilot extension when
    // available even if the primary provider call failed earlier.
    if (this.provider) {
      try {
        const fromProvider = await this.provider.generateReview(
          files,
          oldHash,
          newHash
        );
        if (fromProvider && fromProvider.trim().length > 0) {
          return fromProvider;
        }
      } catch (e) {
        this.outputChannel.appendLine(
          "[Agent] generateReviewContent: provider.generateReview failed: " +
            (e instanceof Error ? e.message : String(e))
        );
      }
    }

    // Otherwise, fall back to the existing local stub that writes a simple
    // markdown review with timestamp and file list.
    const timestamp = new Date().toISOString();
    const fileList = files.map((f) => `- ${f}`).join("\n");

    return `# Code Review\n\n**Generated**: ${timestamp}\n\n**Commit Range**: \`${oldHash}\` → \`${newHash}\`\n\n## Changed Files (${files.length})\n\n${fileList}\n\n## Review\n\nThis is an automated review stub. Future versions will include AI-generated analysis via Copilot Agent integration.\n\n---\n*Generated by Continuous AI Reviewer*\n`;
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
