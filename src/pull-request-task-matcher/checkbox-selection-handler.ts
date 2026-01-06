import { Context } from "../types/index";
import { MatcherCommentParser } from "./matcher-comment-parser";
import { PullRequestBodyLinker } from "./pull-request-body-linker";

export class CheckboxSelectionHandler {
  constructor(private readonly _context: Context<"issue_comment.edited">) {}

  async run(): Promise<void> {
    const { logger, payload } = this._context;

    const issue = payload.issue;
    const isPullRequestComment = Boolean(issue?.pull_request);
    if (!isPullRequestComment) return;

    const body = payload.comment.body ?? "";

    const parser = new MatcherCommentParser();
    const parsed = parser.parseCheckedIssues(body);
    if (!parsed.markerFound) return;

    if (parsed.checked.length === 0) {
      logger.info("No checked suggestions detected.");
      return;
    }

    const checkedOpen = await this._filterOpenIssues(parsed.checked);
    if (checkedOpen.length === 0) {
      logger.info("All checked suggestions are closed; skipping linking.");
      return;
    }

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const pullNumber = issue.number;

    const linker = new PullRequestBodyLinker(this._context);
    await linker.addClosingReferences(owner, repo, pullNumber, checkedOpen);

    logger.ok("Linked selected issue(s) to PR.", { owner, repo, pullNumber });
  }

  private async _filterOpenIssues(refs: { owner: string; repo: string; number: number }[]): Promise<{ owner: string; repo: string; number: number }[]> {
    const results = await Promise.all(
      refs.map(async (ref) => {
        try {
          const issue = await this._context.octokit.rest.issues.get({
            owner: ref.owner,
            repo: ref.repo,
            issue_number: ref.number,
          });

          const state = (issue.data as { state?: string | null }).state;
          const pr = (issue.data as { pull_request?: unknown }).pull_request;

          if (pr) return null;
          if ((state ?? "").toLowerCase() !== "open") return null;
          return ref;
        } catch {
          return null;
        }
      })
    );

    return results.filter((v): v is { owner: string; repo: string; number: number } => v !== null);
  }
}
