import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { Agent } from "../../agent";

describe("integration: Agent writes review for git changes", function () {
  // git operations and file writes may take a moment
  this.timeout(10000);

  it("creates review/review.md after a commit change", async () => {
    // Create temp workspace
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "car-integ-"));

    // Initialize a new git repo
    execSync("git init", { cwd: tmp });
    // Set local user so commits succeed
    execSync('git config user.email "test@example.com"', { cwd: tmp });
    execSync('git config user.name "Test User"', { cwd: tmp });

    // Create initial file and commit
    const filePath = path.join(tmp, "file.txt");
    fs.writeFileSync(filePath, "initial\n", "utf8");
    execSync("git add .", { cwd: tmp });
    execSync('git commit -m "initial commit"', { cwd: tmp });

    const oldHash = execSync("git rev-parse HEAD", { cwd: tmp })
      .toString()
      .trim();

    // Modify file and commit again
    fs.appendFileSync(filePath, "change\n", "utf8");
    execSync("git add .", { cwd: tmp });
    execSync('git commit -m "second commit"', { cwd: tmp });

    const newHash = execSync("git rev-parse HEAD", { cwd: tmp })
      .toString()
      .trim();

    // Determine changed files between commits
    const changed = execSync(`git diff --name-only ${oldHash} ${newHash}`, {
      cwd: tmp,
    })
      .toString()
      .split("\n")
      .filter((l) => l.trim().length > 0);

    // Create a simple outputChannel stub
    const outputChannel = { appendLine: (_: string) => undefined } as any;

    // Provide a notifier stub to avoid requiring vscode
    const notifier = {
      showInformationMessage: async () => undefined,
      showErrorMessage: () => undefined,
      executeCommand: async () => undefined,
    } as any;

    const agent = new Agent(tmp, outputChannel, undefined, notifier);

    // Call processChanges which should write review/review.md
    await agent.processChanges(changed, oldHash, newHash);

    const reviewPath = path.join(tmp, "review", "review.md");
    assert.ok(
      fs.existsSync(reviewPath),
      `Expected review file at ${reviewPath}`
    );

    const content = fs.readFileSync(reviewPath, "utf8");
    // Basic assertions: should include commit hashes and changed file list
    assert.ok(content.includes(oldHash), "review should include old hash");
    assert.ok(content.includes(newHash), "review should include new hash");
    changed.forEach((f) => assert.ok(content.includes(f)));

    // Cleanup - remove temp dir
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});
