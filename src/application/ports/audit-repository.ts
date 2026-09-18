import type { InteractionAttempt, RunCheckpoint } from "../../domain/run.js";
import type { RepositoryTransaction } from "./repository-transaction.js";

export type NewInteractionAttempt = Omit<InteractionAttempt, "id">;
export type NewRunCheckpoint = Omit<RunCheckpoint, "id">;

export interface AuditRepository {
  appendAttempt(
    attempt: NewInteractionAttempt,
    transaction?: RepositoryTransaction
  ): InteractionAttempt;
  appendCheckpoint(
    checkpoint: NewRunCheckpoint,
    transaction?: RepositoryTransaction
  ): RunCheckpoint;
  listAttempts(runItemId: number): readonly InteractionAttempt[];
  listCheckpoints(runId: string): readonly RunCheckpoint[];
}
