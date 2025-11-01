import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Agent } from "./agent";
import { GitWatcher } from "./gitWatcher";
import { tryCreateCopilotProvider } from "./providers/copilotExtensionProvider";

/**
 * This method is called when your extension is activated.
 * Activation occurs on VS Code startup (onStartupFinished event).
 */
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel(
    "Continuous AI Reviewer"
  );

  outputChannel.appendLine("Continuous AI Reviewer extension activated");

  // Get workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    outputChannel.appendLine(
      "No workspace folder open. Extension will remain idle."
    );
    context.subscriptions.push(outputChannel);
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  outputChannel.appendLine("Using workspace: " + workspaceRoot);

  // Create Agent and GitWatcher instances
  // Try to detect/activate a Copilot provider (async)
  let provider = undefined;
  try {
    provider = await tryCreateCopilotProvider(workspaceRoot, outputChannel);
  } catch (e) {
    outputChannel.appendLine(
      "[Extension] Error while creating Copilot provider: " +
        (e instanceof Error ? e.message : String(e))
    );
  }

  // Try to create an API provider from env (OPENAI_API_KEY) as fallback
  let apiProvider = undefined;
  try {
    // Lazy import to avoid requiring network libs at top-level
    const { tryCreateApiProviderFromEnv } = await import(
      "./providers/apiProvider.js"
    );
    apiProvider = tryCreateApiProviderFromEnv();
  } catch (e) {
    outputChannel.appendLine(
      "[Extension] Error while creating API provider: " +
        (e instanceof Error ? e.message : String(e))
    );
  }

  if (provider) {
    vscode.window.showInformationMessage(
      "Copilot extension detected and will be used for reviews"
    );
  } else if (apiProvider) {
    vscode.window.showInformationMessage(
      "No Copilot extension found — using API provider for reviews"
    );
  } else {
    vscode.window.showInformationMessage(
      "Copilot extension not available — using local review generator"
    );
  }

  const agent = new Agent(
    workspaceRoot,
    outputChannel,
    provider,
    undefined,
    apiProvider
  );
  const gitWatcher = new GitWatcher(workspaceRoot, agent, outputChannel);

  // Register command to open the generated review file from the Command Palette
  const openReviewCommand = "continuous-ai-reviewer.openReview";
  const openReviewDisposable = vscode.commands.registerCommand(
    openReviewCommand,
    async () => {
      const reviewFile = path.join(workspaceRoot, "review", "review.md");
      if (!fs.existsSync(reviewFile)) {
        vscode.window.showInformationMessage(
          "No review file found. Generate a review first."
        );
        return;
      }

      try {
        const doc = await vscode.workspace.openTextDocument(reviewFile);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(
          "Failed to open review file: " +
            (err instanceof Error ? err.message : String(err))
        );
      }
    }
  );

  // Alias command with a very short title (cRV) so users can type the short text quickly
  const cRvCommand = "continuous-ai-reviewer.cRV";
  const cRvDisposable = vscode.commands.registerCommand(
    cRvCommand,
    async () => {
      // Execute the main openReview command so behavior remains centralized
      await vscode.commands.executeCommand(openReviewCommand);
    }
  );

  // Register disposables for cleanup
  context.subscriptions.push(
    gitWatcher,
    outputChannel,
    openReviewDisposable,
    cRvDisposable
  );

  outputChannel.appendLine("Git watcher initialized and polling started");
}

/**
 * This method is called when your extension is deactivated.
 */
export function deactivate(): void {}
