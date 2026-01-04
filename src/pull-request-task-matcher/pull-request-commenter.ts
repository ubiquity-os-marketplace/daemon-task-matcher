import { Context } from "../types/index";
import { MatchSuggestion, PullRequestSummary } from "./types";

const MARKER = "<!-- daemon-task-matcher:suggestions -->";

export class PullRequestCommenter {
  constructor(private readonly _context: Context) {}

  async upsertSuggestions(pr: PullRequestSummary, suggestions: MatchSuggestion[]): Promise<void> {
    const { octokit } = this._context;

    const body = this._renderBody(suggestions);

    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.number,
      per_page: 100,
    });

    const existing = comments.find((c) => (c.body ?? "").includes(MARKER));
    if (existing) {
      await octokit.rest.issues.updateComment({
        owner: pr.owner,
        repo: pr.repo,
        comment_id: existing.id,
        body,
      });
      return;
    }

    await octokit.rest.issues.createComment({
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.number,
      body,
    });
  }

  private _renderBody(suggestions: MatchSuggestion[]): string {
    const lines: string[] = [MARKER, "### Related issues suggestions", "", "Select one (or more) issue(s) to link:", ""];

    for (const s of suggestions) {
      lines.push(`- [ ] ${s.owner}/${s.repo}#${s.number} (${s.confidence.toFixed(2)}%)`);
    }

    return lines.join("\n");
  }
}
