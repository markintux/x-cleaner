import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";

import type { Prompt } from "../application/ports/prompt.js";
import { DESTRUCTIVE_CONFIRMATION_PHRASE } from "../application/runs/confirm-batch.js";

export interface SessionPrompt {
  confirm(question: string): Promise<boolean>;
}

export interface ReadlinePromptOptions {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly writeLine?: (message: string) => void;
}

/**
 * The only production terminal prompt. It is deliberately line-oriented: the
 * browser receives credentials, while this adapter receives only confirmations
 * and the destructive phrase.
 */
export class ReadlinePrompt implements Prompt, SessionPrompt {
  readonly #input: Readable;
  readonly #output: Writable;
  readonly #writeLine: (message: string) => void;

  constructor(options: ReadlinePromptOptions = {}) {
    this.#input = options.input ?? stdin;
    this.#output = options.output ?? stdout;
    this.#writeLine = options.writeLine ?? ((message) => this.#output.write(`${message}\n`));
  }

  writeLine(message: string): void {
    this.#writeLine(message);
  }

  ask(question: string): Promise<string> {
    return this.#question(question);
  }

  async confirm(question: string): Promise<boolean> {
    const answer = await this.#question(question);
    return /^(?:s|sim|y|yes)$/iu.test(answer.trim());
  }

  confirmAccount(question: string): Promise<boolean> {
    return this.confirm(question);
  }

  confirmSessionClear(question: string): Promise<boolean> {
    return this.confirm(question);
  }

  async confirmDestructive(question: string): Promise<boolean> {
    const answer = await this.#question(question);
    return answer === DESTRUCTIVE_CONFIRMATION_PHRASE;
  }

  async #question(question: string): Promise<string> {
    const readline = createInterface({ input: this.#input, output: this.#output });
    try {
      return await readline.question(`${question} `);
    } finally {
      readline.close();
    }
  }
}

export const NodeReadlinePrompt = ReadlinePrompt;

export function createPrompt(options: ReadlinePromptOptions = {}): ReadlinePrompt {
  return new ReadlinePrompt(options);
}
