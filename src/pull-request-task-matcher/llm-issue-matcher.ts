import { callLlm, sanitizeLlmResponse } from "@ubiquity-os/plugin-sdk";
import { retry } from "@ubiquity-os/plugin-sdk/helpers";
import OpenAI from "openai";
import { Context } from "../types/index";
import { IssueSummary, MatchSuggestion, PullRequestDiff, PullRequestSummary } from "./types";

export type IssueMatcherConfig = {
  maxIssuesPerLlmCall: number;
};

type LlmResult = {
  suggestions: MatchSuggestion[];
};

const MAX_TOTAL_ISSUES_FACTOR = 3;

const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODE = new Set(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"]);

export class LlmIssueMatcher {
  constructor(
    private readonly _context: Context,
    private readonly _config: IssueMatcherConfig
  ) {}

  async match(pr: PullRequestSummary, diff: PullRequestDiff, issues: IssueSummary[]): Promise<MatchSuggestion[]> {
    const ordered = this._orderIssuesByHeuristic(pr, diff, issues);
    const maxTotalIssues = this._config.maxIssuesPerLlmCall * MAX_TOTAL_ISSUES_FACTOR;
    const limited = ordered.length > maxTotalIssues ? ordered.slice(0, maxTotalIssues) : ordered;

    const chunks = this._chunkIssues(limited, this._config.maxIssuesPerLlmCall);
    const results = await Promise.all(chunks.map((chunk) => this._matchChunk(pr, diff, chunk)));

    const byKey = new Map<string, MatchSuggestion>();
    for (const r of results) {
      for (const s of r) {
        const key = `${s.owner}/${s.repo}#${s.number}`;
        const existing = byKey.get(key);
        if (!existing || s.confidence > existing.confidence) byKey.set(key, s);
      }
    }

    return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
  }

  private _chunkIssues(issues: IssueSummary[], size: number): IssueSummary[][] {
    if (issues.length <= size) return [issues];
    const chunks: IssueSummary[][] = [];
    for (let i = 0; i < issues.length; i += size) {
      chunks.push(issues.slice(i, i + size));
    }
    return chunks;
  }

  private async _matchChunk(pr: PullRequestSummary, diff: PullRequestDiff, issues: IssueSummary[]): Promise<MatchSuggestion[]> {
    const allowedKeys = new Set(issues.map((i) => `${i.owner}/${i.repo}#${i.number}`));

    const payload = {
      pullRequest: {
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        body: pr.body,
      },
      diff: diff.text,
      issues: issues.map((i) => ({
        owner: i.owner,
        repo: i.repo,
        number: i.number,
        title: i.title,
        body: i.body,
        labels: i.labels,
        url: i.url,
      })),
    };

    const system =
      "You match GitHub pull requests to the most likely existing open issues. " +
      "Only return suggestions from the provided issues list; do not invent owners/repos/issue numbers. " +
      "Return only valid JSON. Confidence must be between 0 and 1.";

    const user =
      "Given the pull request and its diff plus candidate issues, return the best matching issues. " +
      "Prefer issues whose title/body aligns with code changes and file paths. " +
      "If none match, return { suggestions: [] }. " +
      "Keep confidence conservative unless the match is clear. " +
      "Output format: { suggestions: [{ owner, repo, number, confidence, reason }] }.";

    const prompt = `${user}\n\n${JSON.stringify(payload)}`;

    try {
      return await retry(
        async () => {
          const text = await this._getCompletionText(system, prompt);
          if (!text) {
            throw new Error("Empty LLM response");
          }

          const parsed = JSON.parse(sanitizeLlmResponse(text)) as LlmResult;
          if (!parsed?.suggestions?.length) return [];

          return parsed.suggestions
            .map((s) => ({
              owner: s.owner,
              repo: s.repo,
              number: s.number,
              confidence: this._clamp01(s.confidence),
              reason: s.reason,
            }))
            .filter((s) => Number.isFinite(s.confidence) && s.owner && s.repo && Number.isFinite(s.number))
            .filter((s) => allowedKeys.has(`${s.owner}/${s.repo}#${s.number}`));
        },
        {
          maxRetries: 5,
          onError: (err) => {
            this._context.logger.info("LLM match attempt failed; retrying.", {
              err,
            });
          },
          isErrorRetryable: (error) => this._isRetryableLlmError(error),
        }
      );
    } catch (err) {
      this._context.logger.info("LLM match failed after retries; skipping chunk.", {
        err,
      });
      return [];
    }
  }

  private _isRetryableLlmError(error: unknown): boolean {
    if (error instanceof SyntaxError) return true;

    const { message, status, code } = this._getErrorMeta(error);
    const normalized = message.toLowerCase();

    if (normalized.includes("missing openrouter_api_key")) return false;
    if (normalized.includes("missing ubiquitykerneltoken")) return false;
    if (normalized.includes("kernel attestation")) return false;

    if (typeof status === "number" && RETRYABLE_HTTP_STATUS.has(status)) return true;
    if (code && RETRYABLE_ERROR_CODE.has(code)) return true;

    if (normalized.includes("rate") && normalized.includes("limit")) return true;
    if (normalized.includes("timeout")) return true;
    if (normalized.includes("invalid json")) return true;
    if (normalized.includes("empty llm response")) return true;

    return true;
  }

  private _getErrorMeta(error: unknown): { message: string; status?: number; code?: string } {
    if (!error || typeof error !== "object") return { message: String(error) };

    const maybe = error as { message?: unknown; status?: unknown; code?: unknown };
    const message = typeof maybe.message === "string" ? maybe.message : "";
    const status = typeof maybe.status === "number" ? maybe.status : undefined;
    const code = typeof maybe.code === "string" ? maybe.code : undefined;
    return { message, status, code };
  }

  private async _getCompletionText(system: string, user: string): Promise<string | null> {
    const openRouter = this._context.config.openRouter;
    if (openRouter) {
      const apiKey = this._context.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("Missing OPENROUTER_API_KEY env var while openRouter config is set");
      }

      const client = new OpenAI({ apiKey, baseURL: openRouter.endpoint });
      const completion = await client.chat.completions.create({
        model: openRouter.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });

      return completion.choices?.[0]?.message?.content ?? null;
    }

    const completion = await callLlm(
      {
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      this._context
    );

    return (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? null;
  }

  private _clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private _orderIssuesByHeuristic(pr: PullRequestSummary, diff: PullRequestDiff, issues: IssueSummary[]): IssueSummary[] {
    if (issues.length <= 1) return issues;

    const prTokens = this._tokenize(`${pr.title}\n${pr.body}\n${diff.files.map((f) => f.filename).join("\n")}`);
    if (prTokens.size === 0) return issues;

    const scored = issues.map((issue) => {
      const issueTokens = this._tokenize(`${issue.title}\n${issue.body}\n${issue.labels.join("\n")}`);
      let score = 0;
      for (const t of issueTokens) {
        if (prTokens.has(t)) score++;
      }
      return { issue, score };
    });

    const topScore = Math.max(...scored.map((s) => s.score));
    if (topScore <= 0) return issues;

    return scored.sort((a, b) => b.score - a.score).map((s) => s.issue);
  }

  private _tokenize(text: string): Set<string> {
    const raw = text
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);

    const stop = new Set([
      "the",
      "and",
      "for",
      "with",
      "this",
      "that",
      "from",
      "into",
      "when",
      "then",
      "than",
      "will",
      "shall",
      "should",
      "could",
      "would",
      "what",
      "why",
      "how",
      "fix",
      "closes",
      "resolves",
    ]);
    const out = new Set<string>();
    for (const t of raw) {
      if (stop.has(t)) continue;
      out.add(t);
    }
    return out;
  }
}
