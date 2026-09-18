import type { Clock } from "../../src/application/ports/clock.js";

export class FakeClock implements Clock {
  constructor(private current = "2026-03-04T05:06:07.000Z") {}

  now(): string {
    return this.current;
  }

  set(value: string): void {
    this.current = value;
  }
}
