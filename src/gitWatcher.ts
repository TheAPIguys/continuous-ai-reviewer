import * as vscode from "vscode";
import * as cp from "child_process";
import { promisify } from "util";
import { Agent } from "./agent";

const exec = promisify(cp.exec);

/**
 * GitWatcher monitors a Git repository for new commits and triggers
 * code review processing when changes are detected.
 *
 * Strategy: Polls `git rev-parse HEAD` on an interval to detect commit changes.
 * When a new commit is detected, runs `git diff --name-only` to get changed files.
 */
export class GitWatcher implements vscode.Disposable {
  private pollingInterval: NodeJS.Timeout | undefined;
  private lastHeadHash: string | undefined;
  private workspaceRoot: string;
  private agent: Agent;
  private outputChannel: vscode.OutputChannel;
  private readonly pollIntervalMs = 5000; // Poll every 5 seconds

  constructor(
    workspaceRoot: string,
    agent: Agent,
    outputChannel: vscode.OutputChannel
  ) {
    this.workspaceRoot = workspaceRoot;
    this.agent = agent;
    this.outputChannel = outputChannel;

    this.initialize();
  }

  /**
   * Start the polling loop to detect new commits.
   */
  private initialize(): void {
    this.outputChannel.appendLine(
      "[GitWatcher] Initializing Git watcher for: " + this.workspaceRoot
    );

    // Get initial HEAD hash
    this.getCurrentHeadHash()
      .then((hash) => {
        this.lastHeadHash = hash;
        this.outputChannel.appendLine(
          "[GitWatcher] Initial HEAD: " + (hash || "none")
        );
        this.startPolling();
      })
      .catch((error) => {
        this.outputChannel.appendLine(
          "[GitWatcher] Failed to get initial HEAD: " + error.message
        );
        // Still start polling in case repo is not yet initialized
        this.startPolling();
      });
  }

  /**
   * Start the polling interval to check for new commits.
   */
  private startPolling(): void {
    this.pollingInterval = setInterval(() => {
      this.checkForNewCommit();
    }, this.pollIntervalMs);

    this.outputChannel.appendLine(
      "[GitWatcher] Started polling (interval: " + this.pollIntervalMs + "ms)"
    );
  }

  /**
   * Check if HEAD has changed, indicating a new commit.
   */
  private async checkForNewCommit(): Promise<void> {
    try {
      const currentHash = await this.getCurrentHeadHash();

      if (!currentHash) {
        // No valid Git repo or detached state
        return;
      }

      if (this.lastHeadHash && this.lastHeadHash !== currentHash) {
        // New commit detected!
        this.outputChannel.appendLine(
          "[GitWatcher] New commit detected: " +
            this.lastHeadHash +
            " → " +
            currentHash
        );

        await this.handleNewCommit(this.lastHeadHash, currentHash);
      }

      this.lastHeadHash = currentHash;
    } catch (error) {
      // Log error but continue polling
      if (error instanceof Error) {
        this.outputChannel.appendLine(
          "[GitWatcher] Error during poll: " + error.message
        );
      }
    }
  }

  /**
   * Get the current HEAD commit hash.
   * Returns undefined if not in a valid Git repo.
   */
  private async getCurrentHeadHash(): Promise<string | undefined> {
    try {
      const { stdout } = await exec("git rev-parse HEAD", {
        cwd: this.workspaceRoot,
      });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Handle a newly detected commit by getting the changed files
   * and passing them to the Agent.
   */
  private async handleNewCommit(
    oldHash: string,
    newHash: string
  ): Promise<void> {
    try {
      const changedFiles = await this.getChangedFiles(oldHash, newHash);
      this.outputChannel.appendLine(
        "[GitWatcher] Changed files: " + JSON.stringify(changedFiles)
      );

      // Pass to Agent for processing
      await this.agent.processChanges(changedFiles, oldHash, newHash);
    } catch (error) {
      if (error instanceof Error) {
        this.outputChannel.appendLine(
          "[GitWatcher] Error processing commit: " + error.message
        );
      }
    }
  }

  /**
   * Get the list of files changed between two commits.
   */
  private async getChangedFiles(
    oldHash: string,
    newHash: string
  ): Promise<string[]> {
    try {
      const { stdout } = await exec(
        `git diff --name-only ${oldHash} ${newHash}`,
        { cwd: this.workspaceRoot }
      );
      return stdout.split("\n").filter((line) => line.trim().length > 0);
    } catch (error) {
      this.outputChannel.appendLine("[GitWatcher] Failed to get changed files");
      return [];
    }
  }

  /**
   * Clean up resources (stop polling interval).
   */
  dispose(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
      this.outputChannel.appendLine(
        "[GitWatcher] Polling stopped and disposed"
      );
    }
  }
}
