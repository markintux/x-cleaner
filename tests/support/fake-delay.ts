import type { Delay } from "../../src/application/ports/delay.js";

export class FakeDelay implements Delay {
  readonly calls: number[] = [];

  async wait(milliseconds: number): Promise<void> {
    this.calls.push(milliseconds);
  }
}
