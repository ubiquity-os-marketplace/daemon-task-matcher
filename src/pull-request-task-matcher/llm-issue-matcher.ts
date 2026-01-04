import OpenAI from "openai";
import { callLlm, sanitizeLlmResponse } from "@ubiquity-os/plugin-sdk";
import { Context } from "../types/index";
import { IssueSummary, MatchSuggestion, PullRequestDiff, PullRequestSummary } from "./types";

export type IssueMatcherConfig = {
  maxIssuesPerLlmCall: number;
};

type LlmResult = {
  suggestions: MatchSuggestion[];
};

export class LlmIssueMatcher {
  constructor(
    private readonly _context: Context,
    private readonly _config: IssueMatcherConfig
  ) {}

  async match(pr: PullRequestSummary, diff: PullRequestDiff, issues: IssueSummary[]): Promise<MatchSuggestion[]> {
    const chunks = this._chunkIssues(issues, this._config.maxIssuesPerLlmCall);
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
    const payload = {
      pullRequest: {
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        body: pr.body,
      },
      diff: this._truncate(diff.text, 24000),
      issues: issues.map((i) => ({
        owner: i.owner,
        repo: i.repo,
        number: i.number,
        title: i.title,
        body: this._truncate(i.body, 2000),
        labels: i.labels,
        url: i.url,
      })),
    };

    const system = "You match GitHub pull requests to the most likely existing open issues. " + "Return only valid JSON. Confidence must be between 0 and 1.";

    const user =
      "Given the pull request and its diff plus candidate issues, return the best matching issues. " +
      "Prefer issues whose title/body aligns with code changes and file paths. " +
      "Output format: { suggestions: [{ owner, repo, number, confidence, reason }] }.";

    const text = await this._getCompletionText(system, `${user}\n\n${JSON.stringify(payload)}`);
    if (!text) return [];

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
      .filter((s) => Number.isFinite(s.confidence) && s.owner && s.repo && Number.isFinite(s.number));
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

  private _truncate(input: string, maxLen: number): string {
    if (input.length <= maxLen) return input;
    return input.slice(0, maxLen);
  }

  private _clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}
