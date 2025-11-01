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

  if (provider) {
    vscode.window.showInformationMessage(
      "Copilot extension detected and will be used for reviews"
    );
  } else {
    vscode.window.showInformationMessage(
      "Copilot extension not available — using local review generator"
    );
  }

  const agent = new Agent(workspaceRoot, outputChannel, provider, undefined);
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

  // Register command to select AI model
  const selectModelCommand = "continuous-ai-reviewer.selectModel";
  const selectModelDisposable = vscode.commands.registerCommand(
    selectModelCommand,
    async () => {
      try {
        // Get current configuration
        const config = vscode.workspace.getConfiguration(
          "continuousAiReviewer"
        );
        const currentVendor = config.get<string>("modelVendor", "copilot");
        const currentFamily = config.get<string>("modelFamily", "gpt-4o");

        outputChannel.appendLine(
          "[Extension] Fetching available language models..."
        );

        // Dynamically fetch all available Copilot models
        const availableModels = await vscode.lm.selectChatModels({
          vendor: currentVendor,
        });

        if (availableModels.length === 0) {
          vscode.window.showWarningMessage(
            "No language models available. Please ensure GitHub Copilot is installed and you are signed in."
          );
          return;
        }

        outputChannel.appendLine(
          `[Extension] Found ${availableModels.length} available models`
        );

        // Create a map to deduplicate by family and track model details
        const modelFamilyMap = new Map<
          string,
          {
            family: string;
            version: string;
            id: string;
            maxInputTokens: number;
          }
        >();

        for (const model of availableModels) {
          const existing = modelFamilyMap.get(model.family);
          // Keep the model with the highest version or most tokens
          if (
            !existing ||
            model.version > existing.version ||
            model.maxInputTokens > existing.maxInputTokens
          ) {
            modelFamilyMap.set(model.family, {
              family: model.family,
              version: model.version,
              id: model.id,
              maxInputTokens: model.maxInputTokens,
            });
          }
        }

        // Build quick pick options from available models
        const modelOptions = Array.from(modelFamilyMap.values()).map(
          (model) => {
            const isCurrent = model.family === currentFamily;
            const icon = isCurrent ? "$(check)" : "$(circle-outline)";

            // Determine if model is premium (o1 models count for premium)
            const isPremium =
              model.family.includes("o1-preview") ||
              model.family.includes("o1-mini");

            // Determine icon based on model family
            let familyIcon = "$(robot)";
            if (model.family.includes("gpt-4")) {
              familyIcon = "$(star)";
            } else if (model.family.includes("gpt-3")) {
              familyIcon = "$(zap)";
            } else if (model.family.includes("o1")) {
              familyIcon = "$(beaker)";
            } else if (model.family.includes("mini")) {
              familyIcon = "$(run)";
            }

            // Add kind for grouping
            const kind = isPremium
              ? vscode.QuickPickItemKind.Default
              : vscode.QuickPickItemKind.Default;

            return {
              label: `${icon} ${familyIcon} ${model.family}`,
              description: `v${
                model.version
              } • ${model.maxInputTokens.toLocaleString()} tokens${
                isPremium ? " • Premium" : ""
              }`,
              detail: isCurrent ? "Currently selected" : undefined,
              value: model.family,
              picked: isCurrent,
              isPremium,
            };
          }
        );

        // Sort: Non-premium first (alphabetically), then premium (alphabetically)
        modelOptions.sort((a, b) => {
          // If current selection, always put it first
          if (a.picked && !b.picked) {
            return -1;
          }
          if (!a.picked && b.picked) {
            return 1;
          }

          // Group by premium status
          if (a.isPremium !== b.isPremium) {
            return a.isPremium ? 1 : -1; // Non-premium first
          }

          // Within same group, sort alphabetically
          return a.value.localeCompare(b.value);
        });

        // Add separator between non-premium and premium
        const separatorIndex = modelOptions.findIndex((opt) => opt.isPremium);
        if (separatorIndex > 0 && separatorIndex < modelOptions.length) {
          modelOptions.splice(separatorIndex, 0, {
            label: "Premium Models",
            kind: vscode.QuickPickItemKind.Separator,
          } as any);
        }

        const selected = await vscode.window.showQuickPick(modelOptions, {
          placeHolder: `Current model: ${currentVendor}/${currentFamily}`,
          title: "Select AI Model for Code Reviews",
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (selected) {
          try {
            await config.update(
              "modelFamily",
              selected.value,
              vscode.ConfigurationTarget.Global
            );
            outputChannel.appendLine(
              `[Extension] Model updated to: ${currentVendor}/${selected.value}`
            );
            vscode.window.showInformationMessage(
              `AI model updated to: ${currentVendor}/${selected.value}`
            );
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(
              `Failed to update model: ${errorMsg}`
            );
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(
          `[Extension] Error fetching models: ${errorMsg}`
        );
        vscode.window.showErrorMessage(
          `Failed to fetch available models: ${errorMsg}`
        );
      }
    }
  );

  // Register disposables for cleanup
  context.subscriptions.push(
    gitWatcher,
    outputChannel,
    openReviewDisposable,
    cRvDisposable,
    selectModelDisposable
  );

  outputChannel.appendLine("Git watcher initialized and polling started");
}

/**
 * This method is called when your extension is deactivated.
 */
export function deactivate(): void {}
