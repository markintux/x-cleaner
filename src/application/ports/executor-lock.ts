export interface ExecutorLockLease {
  release(): Promise<void>;
}

export interface ExecutorLockPort {
  acquire(): Promise<ExecutorLockLease>;
}
