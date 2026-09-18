export interface BrowserLocatorPort {
  first(): BrowserLocatorPort;
  count(): Promise<number>;
  getAttribute(name: string): Promise<string | null>;
  textContent(): Promise<string | null>;
}

export interface BrowserPagePort {
  goto(url: string, options?: { readonly waitUntil?: "domcontentloaded" }): Promise<unknown>;
  url(): string;
  locator(selector: string): BrowserLocatorPort;
}

export interface BrowserContextPort {
  newPage(): Promise<BrowserPagePort>;
  close(): Promise<void>;
}

export interface BrowserContextFactoryPort {
  readonly profileDirectory: string;
  launch(): Promise<BrowserContextPort>;
}
