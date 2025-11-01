import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Agent } from "../../agent";

class DummyOutputChannel {
  public lines: string[] = [];
  appendLine(line: string) {
    this.lines.push(line);
  }
}

class DummyNotifier {
  async showInformationMessage(message: string, ...actions: string[]) {
    return undefined; // don't open anything during tests
  }
  showErrorMessage(message: string) {
    // no-op
  }
  async executeCommand() {
    return undefined;
  }
}

suite("Agent", function () {
  const tmpDir = path.join(os.tmpdir(), `car-agent-test-${Date.now()}`);
  let output: DummyOutputChannel;
  let agent: Agent;

  suiteSetup(function () {
    fs.mkdirSync(tmpDir, { recursive: true });
    output = new DummyOutputChannel();
    const notifier = new DummyNotifier();
    agent = new Agent(tmpDir, output as unknown as any, notifier as any);
  });

  suiteTeardown(function () {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  test("writes a review file containing commit range and changed files", async function () {
    const files = ["foo.txt", "lib/bar.ts"];
    await agent.processChanges(files, "oldhash", "newhash");

    const reviewPath = path.join(tmpDir, "review", "review.md");
    assert.ok(fs.existsSync(reviewPath), "review.md should exist");

    const content = fs.readFileSync(reviewPath, "utf8");
    assert.ok(content.includes("oldhash"), "contains old hash");
    assert.ok(content.includes("newhash"), "contains new hash");
    for (const f of files) {
      assert.ok(content.includes(f), `contains changed file ${f}`);
    }
  });
});
