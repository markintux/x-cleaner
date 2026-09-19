export interface SessionStorage {
  clearProfile(dataDirectory: string): Promise<string>;
}
