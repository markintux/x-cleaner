import type { AccountDetection } from "../../domain/account.js";

export interface LoginGatewayResult {
  readonly detection: AccountDetection;
  readonly profileDirectory: string;
}

/** Isolates the application layer from browser navigation and X page evidence. */
export interface LoginGateway {
  login(): Promise<LoginGatewayResult>;
}
