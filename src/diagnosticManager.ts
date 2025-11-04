import * as vscode from "vscode";
import { Issue, ReviewResponse } from "./agent";
import * as path from "path";

// Forward declaration for circular dependency
export interface IDecorationManager {
  dismissIssue(issueKey: string): void;
  clearDismissedIssues(): void;
}

/**
 * DiagnosticManager handles displaying code review issues in VS Code's Problems panel
 * using the Diagnostic API. This integrates with the native Problems panel UI.
 */
export class DiagnosticManager implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private outputChannel: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];

  // Track dismissed issues so they don't appear in diagnostics
  private dismissedIssues: Set<string> = new Set();

  // Current issues by file
  private issuesByFile: Map<string, Issue[]> = new Map();

  // Reference to decoration manager for syncing dismissals
  private decorationManager?: IDecorationManager;

  constructor(
    private workspaceRoot: string,
    outputChannel: vscode.OutputChannel
  ) {
    this.outputChannel = outputChannel;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection(
      "continuous-ai-reviewer"
    );

    // Register code action provider for "Mark as Fixed" actions
    this.registerCodeActionProvider();
  }

  /**
   * Set the decoration manager for syncing dismissals
   */
  setDecorationManager(decorationManager: IDecorationManager): void {
    this.decorationManager = decorationManager;
  }

  /**
   * Register a code action provider for dismissing issues
   */
  private registerCodeActionProvider(): void {
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      {
        provideCodeActions: (document, range, context) => {
          const actions: vscode.CodeAction[] = [];

          // Check if any of our diagnostics are in this range
          for (const diagnostic of context.diagnostics) {
            if (
              diagnostic.source === "Continuous AI Reviewer" &&
              diagnostic.code
            ) {
              // Extract issue ID from code (format: "CAR-1")
              const codeStr = String(diagnostic.code);
              const match = codeStr.match(/CAR-(\d+)/);
              if (match) {
                const issueId = parseInt(match[1], 10);
                const filename = document.uri.fsPath.replace(
                  this.workspaceRoot,
                  ""
                );
                const cleanFilename = filename.startsWith(path.sep)
                  ? filename.slice(1)
                  : filename;

                // Create "Mark as Fixed" action
                const markFixedAction = new vscode.CodeAction(
                  "✅ Mark as Fixed",
                  vscode.CodeActionKind.QuickFix
                );
                markFixedAction.command = {
                  title: "Mark as Fixed",
                  command: "continuous-ai-reviewer.dismissIssue",
                  arguments: [
                    `${cleanFilename}:${issueId}:${
                      diagnostic.message.split("\n")[0]
                    }`,
                  ],
                };
                markFixedAction.isPreferred = true;

                actions.push(markFixedAction);
              }
            }
          }

          return actions;
        },
      }
    );

    this.disposables.push(codeActionProvider);
  }

  /**
   * Update diagnostics with new review data
   */
  updateDiagnostics(reviewResponse: ReviewResponse): void {
    this.outputChannel.appendLine(
      `[DiagnosticManager] Updating diagnostics with ${reviewResponse.issues.length} issues`
    );

    // Clear previous diagnostics
    this.diagnosticCollection.clear();

    // Index issues by file
    this.issuesByFile.clear();

    for (const issue of reviewResponse.issues) {
      const filePath = vscode.Uri.file(
        path.join(this.workspaceRoot, issue.filename)
      );

      if (!this.issuesByFile.has(filePath.fsPath)) {
        this.issuesByFile.set(filePath.fsPath, []);
      }
      this.issuesByFile.get(filePath.fsPath)!.push(issue);
    }

    // Create diagnostics for each file
    for (const [filePath, issues] of this.issuesByFile) {
      const diagnostics: vscode.Diagnostic[] = [];

      for (const issue of issues) {
        // Skip dismissed issues
        if (this.isIssueDismissed(issue)) {
          this.outputChannel.appendLine(
            `[DiagnosticManager] Skipping dismissed issue: ${issue.title}`
          );
          continue;
        }

        const diagnostic = this.createDiagnostic(issue);
        diagnostics.push(diagnostic);
      }

      // Set diagnostics for this file
      if (diagnostics.length > 0) {
        this.diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics);
        this.outputChannel.appendLine(
          `[DiagnosticManager] Added ${
            diagnostics.length
          } diagnostic(s) for ${path.basename(filePath)}`
        );
      }
    }

    this.outputChannel.appendLine(
      `[DiagnosticManager] Diagnostics updated successfully`
    );
  }

  /**
   * Create a diagnostic for a single issue
   */
  private createDiagnostic(issue: Issue): vscode.Diagnostic {
    // Map severity to DiagnosticSeverity
    const severity = this.mapSeverity(issue.severity);

    // Line number is 1-based in Issue, but 0-based in VS Code
    const lineNum = (issue.line || 1) - 1;

    // Create range for the entire line
    const range = new vscode.Range(lineNum, 0, lineNum, 1000);

    // Build message with full details
    const message = this.buildDiagnosticMessage(issue);

    // Create diagnostic
    const diagnostic = new vscode.Diagnostic(range, message, severity);

    // Set source
    diagnostic.source = "Continuous AI Reviewer";

    // Add code for easier identification
    diagnostic.code = `CAR-${issue.id}`;

    // Add tags for quick filtering
    if (issue.severity === "high") {
      diagnostic.tags = [vscode.DiagnosticTag.Unnecessary]; // Visual indicator
    }

    return diagnostic;
  }

  /**
   * Map issue severity to VS Code DiagnosticSeverity
   */
  private mapSeverity(
    severity: "low" | "medium" | "high"
  ): vscode.DiagnosticSeverity {
    switch (severity) {
      case "high":
        return vscode.DiagnosticSeverity.Error; // 🔴 Red
      case "medium":
        return vscode.DiagnosticSeverity.Warning; // 🟡 Yellow
      case "low":
        return vscode.DiagnosticSeverity.Information; // 🟢 Blue
    }
  }

  /**
   * Build a detailed message for the diagnostic
   */
  private buildDiagnosticMessage(issue: Issue): string {
    let message = `${issue.title}`;

    if (issue.category) {
      message += ` (${issue.category})`;
    }

    if (issue.comments) {
      message += `\n${issue.comments}`;
    }

    if (issue.suggestion) {
      message += `\nSuggestion: ${issue.suggestion}`;
    }

    return message;
  }

  /**
   * Dismiss an issue (removes it from diagnostics and decorations)
   */
  dismissIssue(filename: string, issueId: number): void {
    const key = `${filename}:${issueId}`;
    this.dismissedIssues.add(key);

    this.outputChannel.appendLine(
      `[DiagnosticManager] Dismissed issue: ${key}`
    );

    // Update diagnostics to remove dismissed issue
    const filePath = vscode.Uri.file(path.join(this.workspaceRoot, filename));
    const issues = this.issuesByFile.get(filePath.fsPath);

    if (issues) {
      const diagnostics: vscode.Diagnostic[] = [];

      for (const issue of issues) {
        if (!this.isIssueDismissed(issue)) {
          diagnostics.push(this.createDiagnostic(issue));
        }
      }

      if (diagnostics.length > 0) {
        this.diagnosticCollection.set(filePath, diagnostics);
      } else {
        this.diagnosticCollection.delete(filePath);
      }
    }

    // Also notify decoration manager to sync dismissal
    if (this.decorationManager) {
      // Reconstruct the issue key in the format expected by decoration manager
      // Format: "filename:id:title"
      const issues = this.issuesByFile.get(filePath.fsPath);
      if (issues) {
        const issue = issues.find((i) => i.id === issueId);
        if (issue) {
          const decorationKey = `${issue.filename}:${issue.id}:${issue.title}`;
          this.decorationManager.dismissIssue(decorationKey);
        }
      }
    }
  }

  /**
   * Clear all dismissed issues (show them again)
   */
  clearDismissedIssues(): void {
    this.dismissedIssues.clear();
    this.outputChannel.appendLine(
      "[DiagnosticManager] Cleared all dismissed issues"
    );

    // Also sync with decoration manager
    if (this.decorationManager) {
      this.decorationManager.clearDismissedIssues();
    }

    // Refresh diagnostics
    this.updateDiagnosticsFromCurrentIssues();
  }

  /**
   * Clear all diagnostics
   */
  clearDiagnostics(): void {
    this.diagnosticCollection.clear();
    this.issuesByFile.clear();
    this.outputChannel.appendLine(
      "[DiagnosticManager] Cleared all diagnostics"
    );
  }

  /**
   * Check if an issue is dismissed
   */
  private isIssueDismissed(issue: Issue): boolean {
    const key = `${issue.filename}:${issue.id}`;
    return this.dismissedIssues.has(key);
  }

  /**
   * Update diagnostics from current issues (used after clearing dismissed)
   */
  private updateDiagnosticsFromCurrentIssues(): void {
    this.diagnosticCollection.clear();

    for (const [filePath, issues] of this.issuesByFile) {
      const diagnostics: vscode.Diagnostic[] = [];

      for (const issue of issues) {
        if (!this.isIssueDismissed(issue)) {
          diagnostics.push(this.createDiagnostic(issue));
        }
      }

      if (diagnostics.length > 0) {
        this.diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics);
      }
    }

    this.outputChannel.appendLine(
      "[DiagnosticManager] Diagnostics refreshed after clearing dismissed"
    );
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.diagnosticCollection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
