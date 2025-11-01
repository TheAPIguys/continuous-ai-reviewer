import * as https from "https";
import { IReviewProvider } from "./IReviewProvider";

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
 */
export class ApiProvider implements IReviewProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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

    const system = `You are a helpful code reviewer. Produce a concise, actionable code review in markdown based on the changed files and diffs provided. Include a summary, positives, issues, and suggested fixes where applicable.`;

    const user = `Commit range: ${oldHash} -> ${newHash}\n\nChanged files:\n${fileList}\n\nPlease analyze and produce a markdown code review.`;

    const body = {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 800,
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

export function tryCreateApiProviderFromEnv(): ApiProvider | undefined {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!key) {
    return undefined;
  }
  return new ApiProvider(key);
}
