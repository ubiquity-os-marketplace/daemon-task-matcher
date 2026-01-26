import { Context } from "../types/index";

const LINKS_MARKER_START = "<!-- daemon-task-matcher:linked-issues:start -->";
const LINKS_MARKER_END = "<!-- daemon-task-matcher:linked-issues:end -->";

export type LinkTarget = {
  owner: string;
  repo: string;
  number: number;
};

export class PullRequestBodyLinker {
  constructor(private readonly _context: Context) {}

  async addClosingReferences(owner: string, repo: string, pullNumber: number, targets: LinkTarget[]): Promise<void> {
    const pr = await this._context.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    const existingBody = pr.data.body ?? "";
    const mergedTargets = this._mergeTargets(existingBody, targets);
    if (mergedTargets.length === 0) return;

    const nextBody = this._upsertBlock(existingBody, mergedTargets);

    await this._context.octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      body: nextBody,
    });
  }

  private _mergeTargets(existingBody: string, targets: LinkTarget[]): LinkTarget[] {
    const existing = this._parseExisting(existingBody);
    const map = new Map<string, LinkTarget>();
    for (const t of existing) map.set(this._key(t), t);
    for (const t of targets) map.set(this._key(t), t);
    return [...map.values()];
  }

  private _parseExisting(existingBody: string): LinkTarget[] {
    const block = this._extractExistingBlock(existingBody);
    if (!block) return [];

    const found: LinkTarget[] = [];
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      const match = /^(?:Closes|Fixes|Resolves)\s+([^\s#/]+)\/([^\s#]+)#(\d+)/i.exec(trimmed);
      if (!match) continue;
      found.push({ owner: match[1], repo: match[2], number: Number(match[3]) });
    }
    return found.filter((t) => t.owner && t.repo && Number.isFinite(t.number));
  }

  private _extractExistingBlock(body: string): string | null {
    const start = body.indexOf(LINKS_MARKER_START);
    const end = body.indexOf(LINKS_MARKER_END);
    if (start === -1 || end === -1 || end <= start) return null;
    return body.slice(start + LINKS_MARKER_START.length, end).trim();
  }

  private _upsertBlock(existingBody: string, targets: LinkTarget[]): string {
    const blockLines = [LINKS_MARKER_START, ...targets.map((t) => `Resolves ${t.owner}/${t.repo}#${t.number}`), LINKS_MARKER_END];

    const newBlock = blockLines.join("\n");

    const start = existingBody.indexOf(LINKS_MARKER_START);
    const end = existingBody.indexOf(LINKS_MARKER_END);

    if (start !== -1 && end !== -1 && end > start) {
      const before = existingBody.slice(0, start).trimEnd();
      const after = existingBody.slice(end + LINKS_MARKER_END.length).trimStart();
      const parts = [before, newBlock, after].filter((p) => p.length > 0);
      return parts.join("\n\n");
    }

    if (existingBody.trim().length === 0) return newBlock;
    return `${existingBody.trimEnd()}\n\n${newBlock}`;
  }

  private _key(t: LinkTarget): string {
    return `${t.owner}/${t.repo}#${t.number}`;
  }
}
