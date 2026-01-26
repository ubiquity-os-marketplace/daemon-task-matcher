import { jest } from "@jest/globals";

jest.mock("@actions/github", () => ({
  context: {
    runId: 1,
    sha: "test-sha",
    payload: {
      repository: {
        html_url: "http://localhost/test-repo",
      },
    },
  },
}));
