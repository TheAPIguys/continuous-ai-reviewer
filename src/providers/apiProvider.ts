import * as https from "https";
import * as cp from "child_process";
import { promisify } from "util";
import { IReviewProvider } from "./IReviewProvider";

const exec = promisify(cp.exec);

function postJson(
  host: string,
  path: string,
  body: any,
  apiKey: string
): Promise<any> {
  const data = JSON.stringify(body);
  const options = {
    hostname: host,
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      Authorization: `Bearer ${apiKey}`,
    },
  } as https.RequestOptions;

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const str = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(str));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write(data);
    req.end();
  });
}

/**
 * ApiProvider uses OpenAI's Chat Completions API to generate a code review.
 * It reads the API key from the OPENAI_API_KEY environment variable.
 * It can compute a git diff for the commit range if a workspaceRoot is
 * provided so the diff can be included in the prompt.
 */
export class ApiProvider implements IReviewProvider {
  private apiKey: string;
  private workspaceRoot?: string;
  private output?: { appendLine(msg: string): void };

  constructor(apiKey: string, workspaceRoot?: string, output?: any) {
    this.apiKey = apiKey;
    this.workspaceRoot = workspaceRoot;
    this.output = output;
  }

  private async computeDiff(oldHash: string, newHash: string): Promise<string> {
    if (!this.workspaceRoot) {
      return "";
    }
    try {
      const cmd = `git diff ${oldHash} ${newHash}`;
      const { stdout } = await exec(cmd, { cwd: this.workspaceRoot });
      this.output && this.output.appendLine("[ApiProvider] Obtained git diff");
      return stdout;
    } catch (e) {
      this.output &&
        this.output.appendLine("[ApiProvider] Failed to obtain git diff");
      return "";
    }
  }

  async generateReview(
    files: string[],
    oldHash: string,
    newHash: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("No API key for ApiProvider");
    }

    const fileList = files.map((f) => `- ${f}`).join("\n");

    const diff = await this.computeDiff(oldHash, newHash);

    const system = `You are a helpful code reviewer. Produce a concise, actionable code review in markdown based on the changed files and diffs provided. Include a summary, positives, issues, and suggested fixes where applicable.`;

    const user = `Commit range: ${oldHash} -> ${newHash}\n\nChanged files:\n${fileList}\n\nGit diff:\n\n${diff}\n\nPlease analyze and produce a markdown code review.`;

    const model =
      process.env.OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || "gpt-5-mini";

    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1500,
    };

    // Use OpenAI's API host
    const res = await postJson(
      "api.openai.com",
      "/v1/chat/completions",
      body,
      this.apiKey
    );

    if (
      res &&
      res.choices &&
      res.choices[0] &&
      res.choices[0].message &&
      res.choices[0].message.content
    ) {
      return res.choices[0].message.content as string;
    }

    throw new Error("Invalid response from API provider");
  }
}

export function tryCreateApiProviderFromEnv(
  workspaceRoot?: string,
  output?: any
): ApiProvider | undefined {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!key) {
    return undefined;
  }
  return new ApiProvider(key, workspaceRoot, output);
}
