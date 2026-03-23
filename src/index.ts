import { CheckboxSelectionHandler } from "./pull-request-task-matcher/checkbox-selection-handler";
import { PullRequestTaskMatcher } from "./pull-request-task-matcher/pull-request-task-matcher";
import { Context } from "./types/index";
import { isIssueCommentEditedEvent, isPullRequestEvent } from "./types/typeguards";

/**
 * The main plugin function. Split for easier testing.
 */
export async function runPlugin(context: Context) {
  const { logger, eventName } = context;

  if (isPullRequestEvent(context)) {
    return await new PullRequestTaskMatcher(context).run();
  }

  if (isIssueCommentEditedEvent(context)) {
    return await new CheckboxSelectionHandler(context).run();
  }

  logger.error(`Unsupported event: ${eventName}`);
}
