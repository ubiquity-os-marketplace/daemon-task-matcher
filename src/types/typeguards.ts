import { Context } from "./context";

/**
 * Typeguards are most helpful when you have a union type, and you want to narrow it down to a specific one.
 * In other words, if `SupportedEvents` has multiple types then these restrict the scope
 * of `context` to a specific event payload.
 */

export function isPullRequestEvent(context: Context): context is Context<"pull_request.opened" | "pull_request.reopened"> {
  return context.eventName === "pull_request.opened" || context.eventName === "pull_request.reopened";
}

export function isIssueCommentEditedEvent(context: Context): context is Context<"issue_comment.edited"> {
  return context.eventName === "issue_comment.edited";
}
