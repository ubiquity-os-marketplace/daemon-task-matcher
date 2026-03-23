import { MatchSuggestion } from "./types";

const SUGGESTION_MARKER = "<!-- daemon-task-matcher:suggestions -->";

export type ParsedCheckedSelection = {
  checked: { owner: string; repo: string; number: number }[];
  markerFound: boolean;
};

export class MatcherCommentParser {
  parseCheckedIssues(body: string): ParsedCheckedSelection {
    const hasMarker = body.includes(SUGGESTION_MARKER);
    if (!hasMarker) return { checked: [], markerFound: hasMarker };

    const checked: { owner: string; repo: string; number: number }[] = [];
    const lines = this._linesAfterMarker(body);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("- [x] ") && !trimmed.startsWith("- [X] ")) continue;

      const match = /- \[[xX]\]\s+([^\s#/]+)\/([^\s#]+)#(\d+)/.exec(trimmed);
      if (!match) continue;

      const owner = match[1];
      const repo = match[2];
      const number = Number(match[3]);
      if (!owner || !repo || !Number.isFinite(number)) continue;
      checked.push({ owner, repo, number });
    }

    const uniq = new Map<string, { owner: string; repo: string; number: number }>();
    for (const c of checked) {
      uniq.set(`${c.owner}/${c.repo}#${c.number}`, c);
    }

    return { checked: [...uniq.values()], markerFound: hasMarker };
  }

  extractSuggestions(body: string): MatchSuggestion[] {
    const hasMarker = body.includes(SUGGESTION_MARKER);
    if (!hasMarker) return [];

    const suggestions: MatchSuggestion[] = [];
    const lines = this._linesAfterMarker(body);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("- [")) continue;

      const match = /- \[[ xX]\]\s+([^\s#/]+)\/([^\s#]+)#(\d+)\s+\((\d+(?:\.\d+)?)\)/.exec(trimmed);
      if (!match) continue;
      const owner = match[1];
      const repo = match[2];
      const number = Number(match[3]);
      const confidence = Number(match[4]);
      if (!owner || !repo || !Number.isFinite(number) || !Number.isFinite(confidence)) continue;

      suggestions.push({ owner, repo, number, confidence });
    }

    return suggestions;
  }

  private _linesAfterMarker(body: string): string[] {
    const lines = body.split(/\r?\n/);
    const markerIndex = lines.findIndex((line) => line.includes(SUGGESTION_MARKER));
    return markerIndex === -1 ? [] : lines.slice(markerIndex + 1);
  }
}
