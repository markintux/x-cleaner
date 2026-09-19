export const RESUME_COMMAND_PREFIX = "x-cleaner resume";

export interface SignalSource {
  on(signal: "SIGINT", listener: () => void): unknown;
  off?(signal: "SIGINT", listener: () => void): unknown;
  removeListener?(signal: "SIGINT", listener: () => void): unknown;
}

export interface ProcessSignalOptions {
  readonly runId: string;
  readonly source?: SignalSource;
  readonly process?: SignalSource;
  /** Stops the scheduler synchronously before any checkpoint work starts. */
  readonly stopScheduling?: () => void;
  /** Flushes the last safe boundary after scheduling has stopped. */
  readonly flushCheckpoint?: () => Promise<void> | void;
  readonly onFirstInterrupt?: () => Promise<void> | void;
  readonly writeLine?: (message: string) => void;
  readonly output?: { writeLine(message: string): void };
  readonly resumeMessage?: (runId: string) => string;
  /** Injected in tests; production uses process.exit. */
  readonly forceExit?: (code: number) => void;
  readonly exit?: (code: number) => void;
}

/**
 * The only process boundary that receives SIGINT. The first interrupt is
 * graceful; the second is deliberately immediate and performs no persistence.
 */
export class ProcessSignals {
  readonly #runId: string;
  readonly #source: SignalSource;
  readonly #stopScheduling: (() => void) | undefined;
  #flushCheckpoint: (() => Promise<void> | void) | undefined;
  readonly #writeLine: (message: string) => void;
  readonly #forceExit: (code: number) => void;
  readonly #resumeMessage: (runId: string) => string;
  readonly #listener: () => void;
  #interruptCount = 0;
  #stopRequested = false;
  #installed = false;

  constructor(options: ProcessSignalOptions) {
    this.#runId = options.runId;
    this.#source = options.source ?? options.process ?? process;
    this.#stopScheduling = options.stopScheduling;
    this.#flushCheckpoint = options.flushCheckpoint ?? options.onFirstInterrupt;
    this.#writeLine =
      options.writeLine ??
      (options.output === undefined
        ? (message) => process.stdout.write(`${message}\n`)
        : (message) => options.output!.writeLine(message));
    this.#forceExit = options.forceExit ?? options.exit ?? ((code) => process.exit(code));
    this.#resumeMessage = options.resumeMessage ?? resumeCommand;
    this.#listener = () => {
      void this.handleSigint();
    };
  }

  install(): () => void {
    if (this.#installed) {
      return () => this.uninstall();
    }
    this.#source.on("SIGINT", this.#listener);
    this.#installed = true;
    return () => this.uninstall();
  }

  start(): () => void {
    return this.install();
  }

  /** Lets the active executor replace the idle flush with its current boundary. */
  setCheckpointFlusher(flusher: () => Promise<void> | void): void {
    this.#flushCheckpoint = flusher;
  }

  uninstall(): void {
    if (!this.#installed) {
      return;
    }
    if (this.#source.off !== undefined) {
      this.#source.off("SIGINT", this.#listener);
    } else {
      this.#source.removeListener?.("SIGINT", this.#listener);
    }
    this.#installed = false;
  }

  async handleSigint(): Promise<void> {
    this.#interruptCount += 1;
    if (this.#interruptCount >= 2) {
      this.#forceExit(130);
      return;
    }

    this.#stopRequested = true;
    this.#stopScheduling?.();
    try {
      await this.#flushCheckpoint?.();
    } catch {
      // The resume command is still useful when a best-effort flush fails.
    } finally {
      this.#writeLine(this.#resumeMessage(this.#runId));
    }
  }

  get stopRequested(): boolean {
    return this.#stopRequested;
  }

  isStopRequested(): boolean {
    return this.#stopRequested;
  }

  get interruptCount(): number {
    return this.#interruptCount;
  }
}

export class ProcessSignalAdapter extends ProcessSignals {}

export function resumeCommand(runId: string): string {
  return `${RESUME_COMMAND_PREFIX} ${runId}`;
}
