import * as assert from "assert";
import { GitWatcher } from "../../gitWatcher";

class DummyOutputChannel {
  public lines: string[] = [];
  appendLine(line: string) {
    this.lines.push(line);
  }
}

suite("GitWatcher (unit)", function () {
  test("forwards changed files to Agent.processChanges", async function () {
    // Create a dummy agent that records the last call
    const dummyAgent: any = {
      last: null,
      async processChanges(files: string[], oldHash: string, newHash: string) {
        this.last = { files, oldHash, newHash };
      },
    };

    const out = new DummyOutputChannel();

    // Create an object with GitWatcher prototype without running constructor
    const gw = Object.create(GitWatcher.prototype) as any as GitWatcher;

    // Assign required fields directly
    (gw as any).workspaceRoot = ".";
    (gw as any).agent = dummyAgent;
    (gw as any).outputChannel = out;

    // Stub getChangedFiles to return a predictable list
    (gw as any).getChangedFiles = async (oldHash: string, newHash: string) => {
      return ["a.txt", "b.js"];
    };

    // Call the handler directly
    await (gw as any).handleNewCommit("oldhash", "newhash");

    assert.ok(dummyAgent.last, "Agent.processChanges should have been called");
    assert.deepStrictEqual(dummyAgent.last.files, ["a.txt", "b.js"]);
    assert.strictEqual(dummyAgent.last.oldHash, "oldhash");
    assert.strictEqual(dummyAgent.last.newHash, "newhash");
  });
});
