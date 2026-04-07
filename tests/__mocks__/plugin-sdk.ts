import { db } from "./db";

type PluginInstance = {
  fetch: (request: Request) => Response | Promise<Response>;
};

type LlmMessage = {
  message?: {
    content?: string | null;
  };
};

type CommentBodyOptions = {
  raw?: boolean;
};

type LogReturn = {
  logMessage?: {
    raw?: unknown;
    diff?: unknown;
  };
};

function normalizeCommentBody(body: unknown, options?: CommentBodyOptions): string {
  if (typeof body === "string") {
    return body;
  }

  if (body && typeof body === "object") {
    const logReturn = body as LogReturn;
    const rawBody = logReturn.logMessage?.raw;
    const diffBody = logReturn.logMessage?.diff;

    if (options?.raw && typeof rawBody === "string") {
      return rawBody;
    }

    if (typeof diffBody === "string") {
      return diffBody;
    }

    if (typeof rawBody === "string") {
      return rawBody;
    }
  }

  return String(body);
}

function createMockPlugin(manifest: unknown): PluginInstance {
  return {
    fetch(request: Request) {
      if (new URL(request.url).pathname === "/manifest.json") {
        return Response.json(manifest);
      }

      return new Response("Not Found", { status: 404 });
    },
  };
}

export class CommentHandler {
  createCommentBody(...args: [unknown, unknown, CommentBodyOptions?]): string {
    const [, body, options] = args;
    return normalizeCommentBody(body, options);
  }

  async postComment(context: {
    payload?: { pull_request?: { number?: number } };
  }, body: unknown, options?: CommentBodyOptions): Promise<void> {
    const issueNumber = context.payload?.pull_request?.number ?? 1;
    const existingComments = db.issueComments.getAll();
    const nextId = existingComments.reduce((max, comment) => Math.max(max, Number(comment.id)), 0) + 1;

    db.issueComments.create({
      id: nextId,
      body: normalizeCommentBody(body, options),
      created_at: new Date(),
      updated_at: new Date(),
      issue_number: issueNumber,
      user: {
        login: "ubiquibot",
        id: 0,
      },
    });
  }
}

export function createPlugin(...args: [unknown, unknown]): PluginInstance {
  const [, manifest] = args;
  return createMockPlugin(manifest);
}

export function createActionsPlugin(): PluginInstance {
  return createMockPlugin({});
}

export async function callLlm(): Promise<{ choices: LlmMessage[] }> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            suggestions: [
              {
                owner: "ubiquity",
                repo: "test-repo",
                number: 1,
                confidence: 0.9,
                reason: "Matches mocked diff",
              },
            ],
          }),
        },
      },
    ],
  };
}

export function sanitizeLlmResponse(value: string): string {
  return value;
}
