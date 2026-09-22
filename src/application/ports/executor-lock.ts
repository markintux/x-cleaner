export const staleLockDiagnoses = ["NOT_HELD", "ACTIVE", "STALE", "UNKNOWN"] as const;

export type StaleLockDiagnosis = (typeof staleLockDiagnoses)[number];

export interface ExecutorLockOwner {
  readonly pid: number;
  readonly hostname: string;
  readonly acquiredAt: string;
}

export interface ExecutorLockLease {
  release(): Promise<void>;
}

export interface ExecutorLockPort {
  acquire(): Promise<ExecutorLockLease>;
  /** Observation only: a diagnosis never removes or takes over the lock file. */
  diagnoseStaleLock?(): Promise<StaleLockDiagnosis>;
  readStatus?(): Promise<ExecutorLockOwner | null>;
  /**
   * Removes a lock file this host has proven stale. It is owner-explicit and
   * re-diagnoses immediately before removing, so an active lock is never taken.
   */
  releaseStaleLock?(): Promise<boolean>;
}
