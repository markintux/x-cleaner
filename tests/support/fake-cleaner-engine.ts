import type {
  CleanerEngine,
  CleanerEngineInteraction,
  CleanerEngineOutcome
} from "../../src/application/ports/cleaner-engine.js";

export class FakeCleanerEngine implements CleanerEngine {
  readonly calls: CleanerEngineInteraction[] = [];
  #outcomes: CleanerEngineOutcome[];

  constructor(outcomes: readonly CleanerEngineOutcome[] = []) {
    this.#outcomes = [...outcomes];
  }

  queue(...outcomes: readonly CleanerEngineOutcome[]): void {
    this.#outcomes.push(...outcomes);
  }

  async execute(input: CleanerEngineInteraction): Promise<CleanerEngineOutcome> {
    this.calls.push(input);
    return (
      this.#outcomes.shift() ?? {
        kind: "COMPLETED",
        outcome: "COMPLETED"
      }
    );
  }
}
