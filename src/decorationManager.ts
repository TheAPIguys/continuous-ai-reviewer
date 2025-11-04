import * as vscode from "vscode";
import { Issue, ReviewResponse } from "./agent";
import * as path from "path";

/**
 * Confidence level for issue location accuracy
 */
export type LocationConfidence = "exact" | "approximate" | "stale";

/**
 * Decorated issue with current location information
 */
interface DecoratedIssue {
  issue: Issue;
  confidence: LocationConfidence;
  currentLine: number | null;
}

/**
 * DecorationManager handles displaying code review issues as editor decorations
 * with hover tooltips and smart line tracking when code changes.
 */
export class DecorationManager implements vscode.Disposable {
  private outputChannel: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];

  // Decoration types for each severity level
  private highSeverityDecoration: vscode.TextEditorDecorationType;
  private mediumSeverityDecoration: vscode.TextEditorDecorationType;
  private lowSeverityDecoration: vscode.TextEditorDecorationType;

  // Decoration types for approximate matches (with warning indicator)
  private highSeverityApproxDecoration: vscode.TextEditorDecorationType;
  private mediumSeverityApproxDecoration: vscode.TextEditorDecorationType;
  private lowSeverityApproxDecoration: vscode.TextEditorDecorationType;

  // Current review data indexed by file path
  private issuesByFile: Map<string, Issue[]> = new Map();
  private currentReviewCommit?: string;

  // Hover provider
  private hoverProvider?: vscode.Disposable;

  constructor(
    private workspaceRoot: string,
    outputChannel: vscode.OutputChannel
  ) {
    this.outputChannel = outputChannel;

    // Create decoration types for exact matches
    this.highSeverityDecoration = this.createDecorationType("high", false);
    this.mediumSeverityDecoration = this.createDecorationType("medium", false);
    this.lowSeverityDecoration = this.createDecorationType("low", false);

    // Create decoration types for approximate matches
    this.highSeverityApproxDecoration = this.createDecorationType("high", true);
    this.mediumSeverityApproxDecoration = this.createDecorationType(
      "medium",
      true
    );
    this.lowSeverityApproxDecoration = this.createDecorationType("low", true);

    // Register hover provider
    this.registerHoverProvider();

    // Listen to editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.applyDecorationsToEditor(editor);
        }
      })
    );

    // Apply decorations to all visible editors initially
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.applyDecorationsToEditor(editor);
    });
  }

  /**
   * Create a decoration type for a specific severity level
   */
  private createDecorationType(
    severity: "high" | "medium" | "low",
    approximate: boolean
  ): vscode.TextEditorDecorationType {
    const colors = {
      high: { gutter: "#ff4444", border: "#ff4444", background: "#ff444410" },
      medium: {
        gutter: "#ffaa00",
        border: "#ffaa00",
        background: "#ffaa0010",
      },
      low: { gutter: "#44ff44", border: "#44ff44", background: "#44ff4410" },
    };

    const icons = {
      high: "error",
      medium: "warning",
      low: "info",
    };

    const color = colors[severity];
    const icon = icons[severity];

    return vscode.window.createTextEditorDecorationType({
      gutterIconPath: approximate
        ? vscode.Uri.parse(
            `data:image/svg+xml,${encodeURIComponent(
              this.createApproximateIcon(color.gutter)
            )}`
          )
        : vscode.Uri.parse(
            `data:image/svg+xml,${encodeURIComponent(
              this.createIcon(color.gutter)
            )}`
          ),
      gutterIconSize: "contain",
      overviewRulerColor: color.gutter,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      backgroundColor: color.background,
      borderWidth: approximate ? "1px" : undefined,
      borderStyle: approximate ? "dashed" : undefined,
      borderColor: approximate ? color.border : undefined,
      isWholeLine: true,
    });
  }

  /**
   * Create SVG icon for exact match
   */
  private createIcon(color: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" fill="${color}" stroke="white" stroke-width="1"/>
      <text x="8" y="11" text-anchor="middle" fill="white" font-size="10" font-weight="bold">!</text>
    </svg>`;
  }

  /**
   * Create SVG icon for approximate match (with warning indicator)
   */
  private createApproximateIcon(color: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" fill="${color}" stroke="white" stroke-width="1" stroke-dasharray="2,1"/>
      <text x="8" y="11" text-anchor="middle" fill="white" font-size="10" font-weight="bold">?</text>
    </svg>`;
  }

  /**
   * Update decorations with new review data
   */
  updateReview(reviewResponse: ReviewResponse, reviewCommit: string): void {
    this.outputChannel.appendLine(
      `[DecorationManager] Updating review with ${reviewResponse.issues.length} issues`
    );

    // Clear existing decorations
    this.clearDecorations();

    // Index issues by file
    this.issuesByFile.clear();
    this.currentReviewCommit = reviewCommit;

    for (const issue of reviewResponse.issues) {
      // Add review commit to issue if not already present
      if (!issue.reviewCommit) {
        issue.reviewCommit = reviewCommit;
      }

      const filePath = path.join(this.workspaceRoot, issue.filename);
      if (!this.issuesByFile.has(filePath)) {
        this.issuesByFile.set(filePath, []);
      }
      this.issuesByFile.get(filePath)!.push(issue);
    }

    this.outputChannel.appendLine(
      `[DecorationManager] Indexed issues across ${this.issuesByFile.size} files`
    );

    // Apply decorations to all visible editors
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.applyDecorationsToEditor(editor);
    });
  }

  /**
   * Clear all decorations
   */
  clearDecorations(): void {
    this.outputChannel.appendLine(
      "[DecorationManager] Clearing all decorations"
    );
    vscode.window.visibleTextEditors.forEach((editor) => {
      editor.setDecorations(this.highSeverityDecoration, []);
      editor.setDecorations(this.mediumSeverityDecoration, []);
      editor.setDecorations(this.lowSeverityDecoration, []);
      editor.setDecorations(this.highSeverityApproxDecoration, []);
      editor.setDecorations(this.mediumSeverityApproxDecoration, []);
      editor.setDecorations(this.lowSeverityApproxDecoration, []);
    });
  }

  /**
   * Apply decorations to a specific editor
   */
  private applyDecorationsToEditor(editor: vscode.TextEditor): void {
    const filePath = editor.document.uri.fsPath;
    const issues = this.issuesByFile.get(filePath);

    if (!issues || issues.length === 0) {
      return;
    }

    this.outputChannel.appendLine(
      `[DecorationManager] Applying decorations to ${path.basename(
        filePath
      )} (${issues.length} issues)`
    );

    // Group decorations by severity and confidence
    const highExact: vscode.DecorationOptions[] = [];
    const mediumExact: vscode.DecorationOptions[] = [];
    const lowExact: vscode.DecorationOptions[] = [];
    const highApprox: vscode.DecorationOptions[] = [];
    const mediumApprox: vscode.DecorationOptions[] = [];
    const lowApprox: vscode.DecorationOptions[] = [];

    const fileContent = editor.document.getText();

    for (const issue of issues) {
      const location = this.findCurrentLine(issue, fileContent);

      if (
        !location ||
        location.currentLine === null ||
        location.confidence === "stale"
      ) {
        // Skip stale issues for now
        continue;
      }

      // Convert to 0-based line number
      const lineNumber = location.currentLine - 1;

      // Safety check
      if (lineNumber < 0 || lineNumber >= editor.document.lineCount) {
        continue;
      }

      const line = editor.document.lineAt(lineNumber);
      const range = line.range;

      const decoration: vscode.DecorationOptions = {
        range,
        hoverMessage: this.createHoverMessage(issue, location.confidence),
      };

      // Add to appropriate decoration array
      if (location.confidence === "exact") {
        if (issue.severity === "high") {
          highExact.push(decoration);
        } else if (issue.severity === "medium") {
          mediumExact.push(decoration);
        } else {
          lowExact.push(decoration);
        }
      } else {
        // approximate
        if (issue.severity === "high") {
          highApprox.push(decoration);
        } else if (issue.severity === "medium") {
          mediumApprox.push(decoration);
        } else {
          lowApprox.push(decoration);
        }
      }
    }

    // Apply all decorations
    editor.setDecorations(this.highSeverityDecoration, highExact);
    editor.setDecorations(this.mediumSeverityDecoration, mediumExact);
    editor.setDecorations(this.lowSeverityDecoration, lowExact);
    editor.setDecorations(this.highSeverityApproxDecoration, highApprox);
    editor.setDecorations(this.mediumSeverityApproxDecoration, mediumApprox);
    editor.setDecorations(this.lowSeverityApproxDecoration, lowApprox);

    this.outputChannel.appendLine(
      `[DecorationManager] Applied ${
        highExact.length + mediumExact.length + lowExact.length
      } exact, ${
        highApprox.length + mediumApprox.length + lowApprox.length
      } approximate decorations`
    );
  }

  /**
   * Find the current line number for an issue using smart matching
   */
  private findCurrentLine(
    issue: Issue,
    fileContent: string
  ): { currentLine: number; confidence: LocationConfidence } | null {
    if (!issue.line) {
      return null;
    }

    const lines = fileContent.split("\n");

    // Try exact line number first
    if (issue.lineContent) {
      const originalLineContent = issue.lineContent.trim();
      const currentLineContent = lines[issue.line - 1]?.trim();

      if (currentLineContent === originalLineContent) {
        return { currentLine: issue.line, confidence: "exact" };
      }

      // Search nearby lines (±10 lines)
      for (let offset = -10; offset <= 10; offset++) {
        if (offset === 0) {
          continue; // Already checked
        }

        const checkLine = issue.line + offset;
        if (checkLine < 1 || checkLine > lines.length) {
          continue;
        }

        const checkContent = lines[checkLine - 1]?.trim();
        if (checkContent === originalLineContent) {
          return { currentLine: checkLine, confidence: "approximate" };
        }
      }

      // Full file search as last resort
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === originalLineContent) {
          return { currentLine: i + 1, confidence: "approximate" };
        }
      }
    } else {
      // No line content stored, just use the line number (less reliable)
      if (issue.line > 0 && issue.line <= lines.length) {
        return { currentLine: issue.line, confidence: "approximate" };
      }
    }

    // Could not find the line - mark as stale
    return { currentLine: issue.line, confidence: "stale" };
  }

  /**
   * Create hover message for an issue
   */
  private createHoverMessage(
    issue: Issue,
    confidence: LocationConfidence
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;

    // Add confidence warning for approximate matches
    if (confidence === "approximate") {
      md.appendMarkdown(
        "⚠️ **Note**: This issue location is approximate (code may have changed)\n\n"
      );
    }

    // Add severity emoji
    const severityEmoji =
      issue.severity === "high"
        ? "🔴"
        : issue.severity === "medium"
        ? "🟡"
        : "🟢";

    md.appendMarkdown(`${severityEmoji} **${issue.title}**\n\n`);
    md.appendMarkdown(`**Severity**: ${issue.severity}\n\n`);
    md.appendMarkdown(`**Category**: ${issue.category}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`${issue.comments}\n\n`);

    if (issue.suggestion) {
      md.appendMarkdown(`**💡 Suggestion**: ${issue.suggestion}\n\n`);
    }

    if (issue.reviewCommit) {
      md.appendMarkdown(
        `\n\n---\n*Review based on commit: \`${issue.reviewCommit.substring(
          0,
          7
        )}\`*`
      );
    }

    return md;
  }

  /**
   * Register hover provider for additional issue details
   */
  private registerHoverProvider(): void {
    this.hoverProvider = vscode.languages.registerHoverProvider(
      { scheme: "file" },
      {
        provideHover: (document, position, token) => {
          const filePath = document.uri.fsPath;
          const issues = this.issuesByFile.get(filePath);

          if (!issues) {
            return null;
          }

          const lineNumber = position.line + 1; // Convert to 1-based

          // Find issues on this line
          const fileContent = document.getText();
          for (const issue of issues) {
            const location = this.findCurrentLine(issue, fileContent);
            if (location && location.currentLine === lineNumber) {
              return new vscode.Hover(
                this.createHoverMessage(issue, location.confidence)
              );
            }
          }

          return null;
        },
      }
    );

    this.disposables.push(this.hoverProvider);
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clearDecorations();
    this.highSeverityDecoration.dispose();
    this.mediumSeverityDecoration.dispose();
    this.lowSeverityDecoration.dispose();
    this.highSeverityApproxDecoration.dispose();
    this.mediumSeverityApproxDecoration.dispose();
    this.lowSeverityApproxDecoration.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
