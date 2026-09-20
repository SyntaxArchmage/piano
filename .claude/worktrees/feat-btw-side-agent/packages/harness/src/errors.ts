import { Data } from "effect";

export type AgentFailureKind =
  | "sdk-discovery"
  | "sdk-unavailable"
  | "sdk-load"
  | "harness-unavailable"
  | "configuration"
  | "model-not-found"
  | "authentication"
  | "session-artifact"
  | "resource-unavailable"
  | "request-rejected"
  | "rate-limit"
  | "timeout"
  | "max-tokens"
  | "cancelled"
  | "unknown";

export class AgentError extends Data.TaggedError("AgentError")<{
  readonly kind: AgentFailureKind;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function agentError(kind: AgentFailureKind, cause: unknown): AgentError {
  return new AgentError({
    kind,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}
