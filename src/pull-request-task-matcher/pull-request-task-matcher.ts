import { Context } from "../types/index";
import { LlmIssueMatcher } from "./llm-issue-matcher";
import { PullRequestCommenter } from "./pull-request-commenter";
import { PullRequestDiffFetcher } from "./pull-request-diff-fetcher";
import { PullRequestSummary } from "./types";
import { UnassignedPricedIssueFinder } from "./unassigned-priced-issue-finder";

export class PullRequestTaskMatcher {
  constructor(private readonly _context: Context<"pull_request.opened" | "pull_request.reopened">) {}

  async run(): Promise<void> {
    const { logger, payload, config } = this._context;

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const pullNumber = payload.pull_request.number;

    const pr: PullRequestSummary = {
      owner,
      repo,
      number: pullNumber,
      title: payload.pull_request.title ?? "",
      body: payload.pull_request.body ?? "",
    };

    const isManuallyLinked = await this._hasClosingIssuesReference(pr.owner, pr.repo, pr.number);
    if (isManuallyLinked) {
      logger.info("PR already linked to an issue; skipping.");
      return;
    }

    const diffFetcher = new PullRequestDiffFetcher(this._context);
    const diff = await diffFetcher.fetchDiff(pr.owner, pr.repo, pr.number);
    if (!diff.text.trim()) {
      logger.info("PR has no diff content; skipping.");
      return;
    }

    const issueFinder = new UnassignedPricedIssueFinder(this._context, {
      requirePriceLabel: config.requirePriceLabel,
    });

    const issuesFromMap = await issueFinder.listOpenUnassignedIssuesFromMap();
    const issues = issuesFromMap ?? (await issueFinder.listOpenUnassignedIssues([{ owner: pr.owner, repo: pr.repo }]));

    if (issues.length === 0) {
      logger.info("No candidate issues found.");
      return;
    }

    const matcher = new LlmIssueMatcher(this._context, {
      maxIssuesPerLlmCall: config.maxIssuesPerLlmCall,
    });
    const ranked = await matcher.match(pr, diff, issues);
    const top = ranked.slice(0, config.maxSuggestions);

    if (top.length === 0) {
      logger.info("No matching issues returned by matcher.");
      return;
    }

    if (top[0].confidence < config.confidenceThreshold) {
      logger.info("Top match below confidence threshold; skipping comment.");
      return;
    }

    const commenter = new PullRequestCommenter(this._context);
    await commenter.upsertSuggestions(pr, top);
  }

  private async _hasClosingIssuesReference(owner: string, repo: string, number: number): Promise<boolean> {
    const result = await this._context.octokit.graphql<{
      repository: { pullRequest: { closingIssuesReferences: { totalCount: number } } };
    }>(
      /* GraphQL */ `
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              closingIssuesReferences(first: 1) {
                totalCount
              }
            }
          }
        }
      `,
      { owner, repo, number }
    );

    return (result.repository.pullRequest.closingIssuesReferences.totalCount ?? 0) > 0;
  }
}
