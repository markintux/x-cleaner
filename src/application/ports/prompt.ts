/** Terminal interaction boundary used by destructive confirmation. */
export interface Prompt {
  writeLine(message: string): void;
  ask(question: string): Promise<string>;
}
