import type { LoginGateway } from "../ports/login-gateway.js";
import type { AccountDetection, DetectedAccount } from "../../domain/account.js";

export interface LoginSessionResult {
  readonly detection: AccountDetection;
  readonly account: DetectedAccount | null;
  readonly profileDirectory: string;
}

/** Opens only the official visible flow and never reads credentials from the page. */
export class LoginSession {
  constructor(private readonly gateway: LoginGateway) {}

  async login(): Promise<LoginSessionResult> {
    return this.execute();
  }

  async execute(): Promise<LoginSessionResult> {
    const result = await this.gateway.login();
    return {
      ...result,
      account: result.detection.status === "AUTHENTICATED" ? result.detection.account : null
    };
  }
}

export function createLoginSession(gateway: LoginGateway): LoginSession {
  return new LoginSession(gateway);
}
