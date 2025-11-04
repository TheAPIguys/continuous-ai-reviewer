import * as vscode from "vscode";

/**
 * StatusBarManager handles displaying review progress in VS Code's status bar
 */
export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];
  private reviewInProgress = false;
  private animationInterval?: NodeJS.Timeout;

  // Animation frames for the searching icon
  private animationFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private currentFrame = 0;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;

    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100 // Priority - show early in status bar
    );
    this.statusBarItem.command = "continuous-ai-reviewer.openReview";
    this.statusBarItem.tooltip = "Click to open code review";
  }

  /**
   * Show that review is in progress
   */
  showReviewInProgress(): void {
    this.reviewInProgress = true;
    this.currentFrame = 0;

    this.outputChannel.appendLine("[StatusBar] Review in progress");

    // Start animation
    this.animationInterval = setInterval(() => {
      if (this.reviewInProgress) {
        const frame = this.animationFrames[this.currentFrame];
        this.statusBarItem.text = `🔍 ${frame} Analyzing code...`;
        this.currentFrame =
          (this.currentFrame + 1) % this.animationFrames.length;
      }
    }, 100);

    this.statusBarItem.show();
  }

  /**
   * Show that review is complete with issue count
   * If there are unresolved issues, the status bar will persist
   */
  showReviewComplete(issueCount: number): void {
    this.reviewInProgress = false;

    // Stop animation
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = undefined;
    }

    let statusText: string;
    if (issueCount === 0) {
      // No issues found - show thumbs up
      statusText = `👍 Review complete - No issues found!`;
    } else if (issueCount === 1) {
      statusText = `✅ Review complete (1 issue)`;
    } else {
      statusText = `✅ Review complete (${issueCount} issues)`;
    }

    this.statusBarItem.text = statusText;

    this.outputChannel.appendLine(
      `[StatusBar] Review complete - ${
        issueCount === 0
          ? "No issues found!"
          : issueCount === 1
          ? "1 issue"
          : `${issueCount} issues`
      } found`
    );

    this.statusBarItem.show();

    // Only auto-hide if there are no issues
    // Keep visible if there are unresolved issues
    if (issueCount === 0) {
      setTimeout(() => {
        if (!this.reviewInProgress) {
          this.hide();
        }
      }, 3000);
    }
  }
  /**
   * Show error in status bar
   */
  showReviewError(error: string): void {
    this.reviewInProgress = false;

    // Stop animation
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = undefined;
    }

    this.statusBarItem.text = `❌ Review failed: ${error}`;

    this.outputChannel.appendLine(`[StatusBar] Review error: ${error}`);

    this.statusBarItem.show();

    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.hide();
    }, 5000);
  }

  /**
   * Hide the status bar item
   */
  hide(): void {
    if (!this.reviewInProgress) {
      this.statusBarItem.hide();
    }
  }

  /**
   * Clear the status bar
   */
  clear(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = undefined;
    }
    this.reviewInProgress = false;
    this.statusBarItem.hide();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }
    this.statusBarItem.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
