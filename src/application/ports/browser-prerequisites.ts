export interface BrowserPrerequisiteResult {
  readonly chromeReady: boolean;
  readonly playwrightReady: boolean;
}

export interface BrowserPrerequisitePort {
  check(): Promise<BrowserPrerequisiteResult>;
}
