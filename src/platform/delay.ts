import type { Delay } from "../application/ports/delay.js";

/** Production delay adapter; tests replace it with a deterministic fake. */
export class SystemDelay implements Delay {
  wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

export const systemDelay = new SystemDelay();
