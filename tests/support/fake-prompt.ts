import type { Prompt } from "../../src/application/ports/prompt.js";

export class FakePrompt implements Prompt {
  readonly messages: string[] = [];
  readonly questions: string[] = [];
  #answers: string[];

  constructor(answers: readonly string[] = []) {
    this.#answers = [...answers];
  }

  writeLine(message: string): void {
    this.messages.push(message);
  }

  async ask(question: string): Promise<string> {
    this.questions.push(question);
    return this.#answers.shift() ?? "";
  }

  answer(...answers: readonly string[]): void {
    this.#answers.push(...answers);
  }
}
