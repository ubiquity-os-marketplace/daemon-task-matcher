import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { drop } from "@mswjs/data";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { http, HttpResponse } from "msw";
import manifest from "../manifest.json";
import { runPlugin } from "../src";
import type { Context } from "../src/types/index";
import { db } from "./__mocks__/db";
import { setupTests } from "./__mocks__/helpers";
import { server } from "./__mocks__/node";
import { STRINGS } from "./__mocks__/strings";

const ISSUES_MAP_CONTENTS_URL = "https://api.github.com/repos/devpool-directory/devpool-directory/contents/issues-map.json";

const issuesMapHandler = http.get(ISSUES_MAP_CONTENTS_URL, ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("ref") !== "__STORAGE__") {
    return new HttpResponse(null, { status: 404 });
  }

  const issues = db.issue.getAll();
  const entries = issues.map((i) => {
    const labels = (i.labels ?? []).map((l: unknown) => (typeof l === "string" ? l : ((l as { name?: string | null })?.name ?? ""))).filter(Boolean);

    const nodeId = String(i.node_id ?? i.id);

    return [
      nodeId,
      {
        owner: i.owner,
        repo: i.repo,
        number: i.number,
        node_id: nodeId,
        title: i.title,
        url: i.html_url,
        body: i.body ?? "",
        labels,
        assignees: [],
        state: i.state,
        created_at: typeof i.created_at === "string" ? i.created_at : new Date(i.created_at ?? Date.now()).toISOString(),
        updated_at: typeof i.updated_at === "string" ? i.updated_at : new Date(i.updated_at ?? Date.now()).toISOString(),
      },
    ];
  });

  return HttpResponse.text(JSON.stringify(Object.fromEntries(entries)), {
    headers: {
      "Content-Type": "application/json",
    },
  });
});

const installationReposHandler = http.get("https://api.github.com/installation/repositories", () =>
  HttpResponse.json({
    total_count: 1,
    repositories: [
      {
        name: STRINGS.TEST_REPO,
        owner: { login: STRINGS.USER_1 },
      },
    ],
  })
);

const pullFilesHandler = http.get("https://api.github.com/repos/:owner/:repo/pulls/:pull_number/files", ({ params }) =>
  HttpResponse.json([
    {
      filename: "src/example.ts",
      patch: `@@\n- old\n+ new\n// repo ${params.repo} pr ${params.pull_number}`,
    },
    {
      filename: "dist/bundle.js",
      patch: "@@\n- old\n+ new",
    },
  ])
);

const gitattributesHandler = http.get("https://api.github.com/repos/:owner/:repo/contents/.gitattributes", () =>
  HttpResponse.json({
    type: "file",
    encoding: "base64",
    content: Buffer.from("dist/** linguist-generated\n*.lockb linguist-generated\n*.lock linguist-generated\n").toString("base64"),
  })
);

const listIssuesHandler = http.get("https://api.github.com/repos/:owner/:repo/issues", ({ params }) => {
  const owner = String(params.owner);
  const repo = String(params.repo);
  const issues = db.issue.getAll().filter((i) => i.owner === owner && i.repo === repo);
  return HttpResponse.json(issues);
});

const listIssueCommentsHandler = http.get("https://api.github.com/repos/:owner/:repo/issues/:issue_number/comments", ({ params }) => {
  const issueNumber = Number(params.issue_number);
  const comments = db.issueComments.getAll().filter((c) => c.issue_number === issueNumber);
  return HttpResponse.json(comments);
});

const graphqlHandler = http.post("https://api.github.com/graphql", () =>
  HttpResponse.json({
    data: {
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            totalCount: 0,
          },
        },
      },
    },
  })
);

const llmHandler = http.post("https://ai.ubq.fi/v1/chat/completions", () =>
  HttpResponse.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            suggestions: [
              {
                owner: STRINGS.USER_1,
                repo: STRINGS.TEST_REPO,
                number: 1,
                confidence: 0.9,
                reason: "Matches mocked diff",
              },
            ],
          }),
        },
      },
    ],
  })
);

describe("e2e", () => {
  beforeAll(() => {
    server.listen();
  });

  beforeEach(async () => {
    drop(db);
    await setupTests();

    server.use(issuesMapHandler, installationReposHandler, pullFilesHandler, listIssuesHandler, listIssueCommentsHandler, graphqlHandler, llmHandler);
    server.use(gitattributesHandler);
  });

  afterEach(() => {
    server.resetHandlers();
    jest.clearAllMocks();
  });

  afterAll(() => {
    server.close();
  });

  it("serves manifest.json", async () => {
    const worker = (await import("../src/worker")).default;
    const response = await worker.fetch(new Request("http://localhost/manifest.json"), {} as never);
    expect(response.status).toBe(200);
    const content = await response.json();
    expect(content).toEqual(manifest);
  });

  it("runs matcher on pull_request.opened and posts suggestions", async () => {
    const context = createPullRequestContext();

    await runPlugin(context);

    const comments = db.issueComments.getAll();
    const suggestion = comments.find((c) => c.body.includes("<!-- daemon-task-matcher:suggestions -->"));
    if (!suggestion) {
      throw new Error(`No suggestion comment found. Current comments:\n\n${comments.map((c) => c.body).join("\n\n---\n\n")}`);
    }
    expect(suggestion?.body).toContain("Related issues suggestions");
    expect(suggestion?.body).toContain(`${STRINGS.USER_1}/${STRINGS.TEST_REPO}#1`);
  });
});

function createPullRequestContext(): Context {
  return {
    eventName: "pull_request.opened",
    payload: {
      action: "opened",
      repository: {
        name: STRINGS.TEST_REPO,
        owner: { login: STRINGS.USER_1 },
      },
      pull_request: {
        number: 1,
        title: "Test PR",
        body: "This PR changes something.",
      },
      installation: { id: 1 },
    },
    logger: new Logs("debug"),
    config: {
      confidenceThreshold: 0.5,
      maxSuggestions: 5,
      requirePriceLabel: true,
      maxIssuesPerLlmCall: 40,
    },
    octokit: new customOctokit(),
    authToken: "token",
    command: null,
  } as unknown as Context;
}
