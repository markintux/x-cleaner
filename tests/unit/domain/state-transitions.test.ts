import { describe, expect, it } from "vitest";

import {
  archiveImportStatuses,
  interactionTypes,
  isArchiveImportStatus,
  isInteractionType,
  xInteractionId
} from "../../../src/domain/interaction.js";
import { attemptOutcomes, isAttemptOutcome } from "../../../src/domain/result.js";
import {
  canRecoverStaleProcessing,
  canTransitionCleaningRun,
  canTransitionCleaningRunItem,
  canTransitionRunBatch,
  isCheckpointReason,
  isCleaningRunItemStatus,
  isPauseReason,
  isTerminalRunItemStatus,
  isTerminalRunStatus
} from "../../../src/domain/run.js";

describe("vocabulário de domínio e transições", () => {
  it("aceita somente os valores persistidos previstos e IDs X decimais", () => {
    expect(interactionTypes).toEqual(["POST", "REPLY", "REPOST", "LIKE"]);
    expect(interactionTypes.every(isInteractionType)).toBe(true);
    expect(isInteractionType("POSTAGEM")).toBe(false);
    expect(archiveImportStatuses.every(isArchiveImportStatus)).toBe(true);
    expect(attemptOutcomes.every(isAttemptOutcome)).toBe(true);
    expect(isAttemptOutcome("UNKNOWN_UI")).toBe(false);
    expect(isArchiveImportStatus("PROCESSING")).toBe(true);
    expect(isArchiveImportStatus("PENDING")).toBe(false);
    expect(isPauseReason("RATE_LIMIT")).toBe(true);
    expect(isPauseReason("OTHER")).toBe(false);
    expect(isCheckpointReason("MANUAL_INTERRUPT")).toBe(true);
    expect(isCleaningRunItemStatus("PROCESSING")).toBe(true);
    expect(xInteractionId("90071992547409931234")).toBe("90071992547409931234");
    expect(() => xInteractionId("90.07")).toThrow("INVALID_DECIMAL_STRING");
  });

  it("permite transições normais e reconhece estados terminais", () => {
    expect(canTransitionCleaningRun("PENDING", "RUNNING")).toBe(true);
    expect(canTransitionCleaningRun("RUNNING", "PAUSED")).toBe(true);
    expect(canTransitionCleaningRun("RUNNING", "COMPLETED")).toBe(true);
    expect(isTerminalRunStatus("COMPLETED")).toBe(true);
    expect(canTransitionRunBatch("RUNNING", "INTERRUPTED")).toBe(true);
    expect(canTransitionCleaningRunItem("PROCESSING", "COMPLETED")).toBe(true);
    expect(canTransitionCleaningRunItem("PROCESSING", "ALREADY_REMOVED")).toBe(true);
    expect(isTerminalRunItemStatus("NOT_FOUND")).toBe(true);
    expect(isTerminalRunItemStatus("UNAVAILABLE")).toBe(true);
  });

  it("permite somente a recuperação explícita de PROCESSING para PENDING", () => {
    expect(canTransitionCleaningRunItem("PROCESSING", "PENDING")).toBe(true);
    expect(canRecoverStaleProcessing("PROCESSING", "PENDING")).toBe(true);
    expect(canRecoverStaleProcessing("PENDING", "PROCESSING")).toBe(false);
    expect(canRecoverStaleProcessing("PROCESSING", "FAILED")).toBe(false);
  });

  it("recusa transições proibidas, incluindo a reexecução de itens terminais", () => {
    expect(canTransitionCleaningRun("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransitionRunBatch("PAUSED", "RUNNING")).toBe(false);
    expect(canTransitionCleaningRunItem("PENDING", "COMPLETED")).toBe(false);
    expect(canTransitionCleaningRunItem("COMPLETED", "PROCESSING")).toBe(false);
    expect(canTransitionCleaningRunItem("NOT_FOUND", "PENDING")).toBe(false);
  });
});
