import * as assert from "assert";
import * as path from "path";
import * as fakeVscode from "vscode";
import * as providerMod from "../../providers/copilotExtensionProvider";

describe("CopilotExtensionProvider (unit)", function () {
  afterEach(function () {
    if ((fakeVscode as any).__reset) {
      (fakeVscode as any).__reset();
    }
  });

  it("uses extension exported API when available", async function () {
    // Configure fake vscode to return an extension that exports generateReview
    (fakeVscode as any).__setFake({
      extensions: {
        getExtension: (id: string) => ({
          id: "GitHub.copilot",
          activate: async () => ({
            generateReview: async ({ prompt }: any) =>
              `REVIEW: ${prompt.slice(0, 20)}`,
          }),
          exports: {
            generateReview: async ({ prompt }: any) =>
              `REVIEW: ${prompt.slice(0, 20)}`,
          },
        }),
      },
      commands: {
        getCommands: async () => [],
        executeCommand: async () => undefined,
      },
    });

    const workspaceRoot = path.join(__dirname, "..", "..", "tmp");
    const output = { appendLine: (_: string) => {} } as any;

    const provider = new (providerMod as any).CopilotExtensionProvider(
      workspaceRoot,
      output
    );

    const res = await provider.generateReview(["a.txt"], "old", "new");
    assert.ok(typeof res === "string");
    assert.ok(res.startsWith("REVIEW:"), "should return review from API");
  });

  it("invokes Copilot command when API not present and returns UI-sent confirmation", async function () {
    (fakeVscode as any).__setFake({
      extensions: {
        getExtension: (id: string) => ({
          id: "GitHub.copilot",
          activate: async () => ({}),
          exports: {},
        }),
      },
      commands: {
        getCommands: async () => ["github.copilot.chat.open"],
        executeCommand: async (_cmd: string, _arg?: any) => undefined,
      },
    });

    const workspaceRoot = path.join(__dirname, "..", "..", "tmp");
    const output = { appendLine: (_: string) => {} } as any;

    const provider = new (providerMod as any).CopilotExtensionProvider(
      workspaceRoot,
      output
    );

    const res = await provider.generateReview(["a.txt"], "old", "new");
    assert.ok(typeof res === "string");
    assert.ok(
      res.startsWith("# Copilot (fallback) Review"),
      "should return confirmation that prompt was sent to UI"
    );
  });
});
