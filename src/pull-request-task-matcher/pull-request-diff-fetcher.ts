import { Context } from "../types/index";
import { PullRequestDiff } from "./types";
import { createDiffIgnoreMatcher } from "./diff-ignore";

export class PullRequestDiffFetcher {
  constructor(private readonly _context: Context) {}

  async fetchDiff(owner: string, repo: string, pullNumber: number, ref?: string): Promise<PullRequestDiff> {
    const gitattributesContent = await this._tryFetchGitattributes(owner, repo, ref);
    const isIgnored = createDiffIgnoreMatcher({ gitattributesContent });

    const files = await this._context.octokit.paginate(this._context.octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const filteredFiles = files.filter((f) => !isIgnored(f.filename));

    const parts: string[] = [];
    const structured = filteredFiles.map((f) => {
      const patch = f.patch ?? undefined;
      if (patch) {
        parts.push(`file: ${f.filename}\n${patch}`);
      } else {
        parts.push(`file: ${f.filename}`);
      }
      return { filename: f.filename, patch };
    });

    const text = parts.join("\n\n");
    return { files: structured, text };
  }

  private async _tryFetchGitattributes(owner: string, repo: string, ref?: string): Promise<string | undefined> {
    try {
      const response = await this._context.octokit.rest.repos.getContent({
        owner,
        repo,
        path: ".gitattributes",
        ...(ref ? { ref } : {}),
      });

      this._context.logger.debug("Fetched the .gitattributes file", {
        data: response.data,
      });
      if (!response.data || Array.isArray(response.data)) return undefined;
      if (response.data.type !== "file") return undefined;
      if (typeof response.data.content !== "string") return undefined;

      const encoded = response.data.content.replace(/\n/g, "");
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return undefined;
    }
  }
}
