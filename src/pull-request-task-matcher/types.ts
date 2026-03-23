export type RepoRef = {
  owner: string;
  repo: string;
};

export type IssueSummary = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
};

export type PullRequestSummary = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
};

export type PullRequestDiff = {
  files: {
    filename: string;
    patch?: string;
  }[];
  text: string;
};

export type MatchSuggestion = {
  owner: string;
  repo: string;
  number: number;
  confidence: number;
  reason?: string;
};
