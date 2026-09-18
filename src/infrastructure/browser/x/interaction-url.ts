import { normalizeAccountHandle } from "../../../domain/account.js";
import {
  isDecimalString,
  type DecimalString,
  type XInteractionId
} from "../../../domain/interaction.js";
import { X_URLS } from "./selectors.js";

export class InteractionUrlError extends Error {
  constructor(readonly code: "INVALID_INTERACTION_ID" | "INVALID_CONFIRMED_HANDLE") {
    super(code);
    this.name = "InteractionUrlError";
  }
}

/** Builds the only status URL shape accepted by BrowserEngine. */
export function buildInteractionUrl(
  confirmedHandleOrInteractionId: string,
  interactionIdOrConfirmedHandle: string | DecimalString | XInteractionId
): string {
  const [confirmedHandle, interactionId] =
    isDecimalString(confirmedHandleOrInteractionId) &&
    !isDecimalString(interactionIdOrConfirmedHandle)
      ? [interactionIdOrConfirmedHandle, confirmedHandleOrInteractionId]
      : [confirmedHandleOrInteractionId, interactionIdOrConfirmedHandle];
  const handle = normalizeHandle(confirmedHandle);
  if (!isDecimalString(interactionId)) {
    throw new InteractionUrlError("INVALID_INTERACTION_ID");
  }

  return `${X_URLS.origin}/${encodeURIComponent(handle)}/status/${interactionId}`;
}

/** Explicitly named alias for callers that work with status interactions. */
export function buildStatusUrl(
  confirmedHandle: string,
  interactionId: string | DecimalString | XInteractionId
): string {
  return buildInteractionUrl(confirmedHandle, interactionId);
}

export function interactionUrl(
  confirmedHandle: string,
  interactionId: string | DecimalString | XInteractionId
): string {
  return buildInteractionUrl(confirmedHandle, interactionId);
}

export const createInteractionUrl = buildInteractionUrl;
export const createStatusUrl = buildStatusUrl;
export const reconstructInteractionUrl = buildInteractionUrl;
export const reconstructStatusUrl = buildStatusUrl;

function normalizeHandle(value: string): string {
  try {
    return normalizeAccountHandle(value);
  } catch {
    throw new InteractionUrlError("INVALID_CONFIRMED_HANDLE");
  }
}
