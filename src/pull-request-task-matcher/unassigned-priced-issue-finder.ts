import { Context } from "../types/index";
import { IssueSummary, RepoRef } from "./types";

export type IssueFinderConfig = {
  requirePriceLabel: boolean;
};

const PRICE_LABEL_REGEX = /^Price:\s*\d+(?:\.\d+)?\s*[A-Za-z]{2,10}$/;
const ISSUES_MAP_URL = "https://github.com/devpool-directory/devpool-directory/blob/__STORAGE__/issues-map.json";
const ISSUES_MAP_REPO_OWNER = "devpool-directory";
const ISSUES_MAP_REPO_NAME = "devpool-directory";
const ISSUES_MAP_PATH = "issues-map.json";
const ISSUES_MAP_REF = "__STORAGE__";

type IssuesMapRecord = {
  owner: string;
  repo: string;
  number: number;
  title?: string | null;
  body?: string | null;
  url?: string | null;
  labels?: string[] | null;
  assignees?: string[] | null;
  state?: string | null;
  closed?: boolean | null;
  closed_at?: string | null;
};

type IssuesMap = Record<string, IssuesMapRecord>;

export class UnassignedPricedIssueFinder {
  constructor(
    private readonly _context: Context,
    private readonly _config: IssueFinderConfig
  ) {}

  async listOpenUnassignedIssues(repos: RepoRef[]): Promise<IssueSummary[]> {
    const fromMap = await this.listOpenUnassignedIssuesFromMap();
    if (fromMap !== null) return fromMap;

    return await this._listOpenUnassignedIssuesViaGitHubApi(repos);
  }

  async listOpenUnassignedIssuesFromMap(): Promise<IssueSummary[] | null> {
    try {
      const map = await this._fetchIssuesMap();
      if (!map) return null;

      const candidates: IssueSummary[] = [];
      for (const record of Object.values(map)) {
        const candidate = this._toCandidateFromIssuesMapRecord(record);
        if (!candidate) continue;
        candidates.push(candidate);
      }

      return candidates;
    } catch (error) {
      this._context.logger.info("issues-map.json fetch threw; falling back to GitHub API.", {
        url: ISSUES_MAP_URL,
        error: error instanceof Error ? error : { stack: String(error) },
      });
      return null;
    }
  }

  private async _fetchIssuesMap(): Promise<IssuesMap | null> {
    const response = await this._context.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: ISSUES_MAP_REPO_OWNER,
      repo: ISSUES_MAP_REPO_NAME,
      path: ISSUES_MAP_PATH,
      ref: ISSUES_MAP_REF,
      headers: {
        accept: "application/vnd.github.raw",
      },
    });

    const data = (response as unknown as { data?: unknown }).data;
    const json = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
    if (!json || typeof json !== "object") return null;
    return json as IssuesMap;
  }

  private _toCandidateFromIssuesMapRecord(record: IssuesMapRecord): IssueSummary | null {
    if (!record || typeof record !== "object") return null;
    if (!record.owner || !record.repo || typeof record.number !== "number") return null;
    if (this._isClosedIssuesMapRecord(record)) return null;

    const labels = record.labels ?? [];

    return {
      owner: record.owner,
      repo: record.repo,
      number: record.number,
      title: record.title ?? "",
      body: record.body ?? "",
      url: record.url ?? "",
      labels,
    };
  }

  private _isClosedIssuesMapRecord(record: IssuesMapRecord): boolean {
    if (record.closed === true) return true;
    if (typeof record.closed_at === "string" && record.closed_at.trim().length > 0) return true;

    const state = (record.state ?? "").trim().toLowerCase();
    return state === "closed";
  }

  private async _listOpenUnassignedIssuesViaGitHubApi(repos: RepoRef[]): Promise<IssueSummary[]> {
    const allIssues: IssueSummary[] = [];
    for (const repo of repos) {
      const response = await this._context.octokit.rest.issues.listForRepo({
        owner: repo.owner,
        repo: repo.repo,
        state: "open",
        per_page: 100,
        assignee: "none",
      });

      const issues = response.data;

      for (const issue of issues) {
        const issueSummary = this._toCandidateIssue(repo.owner, repo.repo, issue);
        if (!issueSummary) continue;
        allIssues.push(issueSummary);
      }
    }

    return allIssues;
  }

  private _toCandidateIssue(owner: string, repo: string, issue: unknown): IssueSummary | null {
    const i = issue as {
      pull_request?: unknown;
      number: number;
      title?: string | null;
      body?: string | null;
      html_url?: string | null;
      labels?: Array<string | { name?: string | null }> | null;
      assignees?: unknown[] | null;
    };

    if (i.pull_request) return null;

    const labels = (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l?.name ?? ""))).filter((v) => v.length > 0);

    if (this._config.requirePriceLabel) {
      if (!labels.some((l) => PRICE_LABEL_REGEX.test(l))) return null;
    }

    const assignees = i.assignees ?? [];
    if (assignees.length > 0) return null;

    return {
      owner,
      repo,
      number: i.number,
      title: i.title ?? "",
      body: i.body ?? "",
      url: i.html_url ?? "",
      labels,
    };
  }
}
