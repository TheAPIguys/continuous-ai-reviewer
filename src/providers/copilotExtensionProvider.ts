import * as vscode from "vscode";
import * as cp from "child_process";
import { promisify } from "util";
// path not used here (kept minimal); remove unused import
import { IReviewProvider } from "./IReviewProvider";

const exec = promisify(cp.exec);

/**
 * CopilotExtensionProvider attempts to use a locally installed GitHub Copilot
 * extension (if present) to generate a code review. It falls back to returning
 * the raw git diff prompt if the extension doesn't expose a callable API.
 */
export class CopilotExtensionProvider implements IReviewProvider {
  private workspaceRoot: string;
  private output: vscode.OutputChannel;
  private ext: vscode.Extension<any> | undefined;

  constructor(workspaceRoot: string, output: vscode.OutputChannel) {
    this.workspaceRoot = workspaceRoot;
    this.output = output;

    // Try to find Copilot under a few likely extension IDs
    this.ext =
      vscode.extensions.getExtension("GitHub.copilot") ||
      vscode.extensions.getExtension("github.copilot") ||
      vscode.extensions.getExtension("GitHub.copilot-nightly");

    if (!this.ext) {
      this.output.appendLine("[CopilotProvider] Copilot extension not found");
    } else {
      this.output.appendLine(
        "[CopilotProvider] Found Copilot extension: " + this.ext.id
      );
    }
  }

  public async generateReview(
    files: string[],
    oldHash: string,
    newHash: string
  ): Promise<string> {
    // First, compute the git diff for the commit range (best-effort)
    let diff = "";
    try {
      const cmd = `git diff ${oldHash} ${newHash}`;
      const { stdout } = await exec(cmd, { cwd: this.workspaceRoot });
      diff = stdout;
      this.output.appendLine("[CopilotProvider] Obtained git diff");
    } catch (err) {
      this.output.appendLine(
        "[CopilotProvider] Failed to get git diff, continuing with file list"
      );
    }

    const fileList = files.map((f) => `- ${f}`).join("\n");

    // Build a concise prompt to send to Copilot (or return as fallback)
    const prompt = `Please write a human-readable code review for the following commit range:\n\nCommit: ${oldHash} -> ${newHash}\n\nChanged files:\n${fileList}\n\nGit diff:\n\n${diff}`;

    // If Copilot extension is available, try to activate it and call an exported API
    if (this.ext) {
      try {
        const activated = await this.ext.activate();
        const api = this.ext.exports || activated;

        // Try a few common API method names that a hypothetical Copilot
        // extension might expose for programmatic prompts. This is defensive
        // — if none exist we fall back to returning the prompt.
        const candidateFns = [
          "generateReview",
          "provideReview",
          "requestReview",
          "review",
          "requestCopilotReview",
        ];

        for (const name of candidateFns) {
          const fn = api && api[name];
          if (typeof fn === "function") {
            this.output.appendLine(
              `[CopilotProvider] Calling Copilot API method: ${name}`
            );
            try {
              const result = await fn({ prompt, files, oldHash, newHash });
              if (typeof result === "string" && result.trim().length > 0) {
                this.output.appendLine(
                  "[CopilotProvider] Received review from Copilot API"
                );
                return result;
              }
            } catch (e) {
              this.output.appendLine(
                `[CopilotProvider] Copilot API method ${name} threw: ${
                  e instanceof Error ? e.message : String(e)
                }`
              );
            }
          }
        }

        // As a last attempt, if the extension exports a generic `request`-style
        // method that accepts a command name, try invoking a review-related
        // command key if present.
        if (api && typeof api.request === "function") {
          try {
            const result = await api.request("generateReview", { prompt });
            if (typeof result === "string" && result.trim().length > 0) {
              this.output.appendLine(
                "[CopilotProvider] Received review from Copilot API via request()"
              );
              return result;
            }
          } catch (e) {
            this.output.appendLine(
              "[CopilotProvider] api.request('generateReview') failed"
            );
          }
        }
      } catch (e) {
        this.output.appendLine(
          "[CopilotProvider] Error activating/using Copilot extension: " +
            (e instanceof Error ? e.message : String(e))
        );
      }
    }

    // Fallback: return the prompt so Agent can persist a review-like file.
    this.output.appendLine(
      "[CopilotProvider] Falling back to prompt-based review"
    );
    return `# Copilot (fallback) Review\n\n${prompt}`;
  }
}

/**
 * Create a CopilotExtensionProvider synchronously — it will detect extension
 * presence. Returns undefined if no Copilot extension is installed.
 */
export async function tryCreateCopilotProvider(
  workspaceRoot: string,
  output: vscode.OutputChannel
): Promise<CopilotExtensionProvider | undefined> {
  const ext =
    vscode.extensions.getExtension("GitHub.copilot") ||
    vscode.extensions.getExtension("github.copilot") ||
    vscode.extensions.getExtension("GitHub.copilot-nightly");

  if (!ext) {
    return undefined;
  }

  // Try to activate the extension to ensure programmatic APIs (if any) are available
  try {
    await ext.activate();
    output.appendLine(
      "[CopilotProvider] Copilot extension activated successfully"
    );
  } catch (e) {
    const msg =
      (e instanceof Error && e.message) || (e ? String(e) : "Unknown error");
    output.appendLine(
      "[CopilotProvider] Failed to activate Copilot extension: " + msg
    );
    // Notify the user that activation failed
    vscode.window.showErrorMessage(
      "Copilot extension found but activation failed: " + msg
    );
    return undefined;
  }

  // Return provider instance
  return new CopilotExtensionProvider(workspaceRoot, output);
}
