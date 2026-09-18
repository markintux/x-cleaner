import type { ParsedAccount } from "./types.js";
import { firstString, normalizeHandle, unwrapRecord, userId } from "./values.js";

export class AccountParser {
  parse(records: readonly unknown[]): ParsedAccount {
    let xUserId = null;
    let handle: string | null = null;

    for (const value of records) {
      const account = unwrapRecord(value, "account");
      xUserId ??= userId(account, ["accountId", "account_id", "userId", "user_id", "id_str", "id"]);
      handle ??= normalizeHandle(
        firstString(account, ["userName", "username", "screen_name", "handle"])
      );
      if (xUserId !== null && handle !== null) {
        break;
      }
    }

    return { xUserId, handle };
  }

  parseAssignment(records: readonly unknown[]): ParsedAccount {
    return this.parse(records);
  }
}

export function parseAccount(records: readonly unknown[]): ParsedAccount {
  return new AccountParser().parse(records);
}
