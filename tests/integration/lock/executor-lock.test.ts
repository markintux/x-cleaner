import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ExecutorLock,
  ExecutorLockHeldError
} from "../../../src/infrastructure/lock/executor-lock.js";

describe("ExecutorLock", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it("rejeita o segundo escritor enquanto a inspeção de status continua somente leitura", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-lock-"));
    directories.push(directory);
    const first = new ExecutorLock(directory, {
      now: () => "2026-03-04T05:06:07.000Z",
      pid: () => 100,
      hostname: () => "synthetic-host"
    });
    const second = new ExecutorLock(directory);
    const lease = await first.acquire();

    await expect(second.acquire()).rejects.toBeInstanceOf(ExecutorLockHeldError);
    expect(await second.readStatus()).toEqual(lease.metadata);
    expect(await second.diagnoseStaleLock()).toBe("UNKNOWN");

    await lease.release();
    expect(await second.readStatus()).toBeNull();
  });

  it("diagnostica uma trava obsoleta sem removê-la nem assumir sua propriedade", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "x-cleaner-lock-"));
    directories.push(directory);
    const options = {
      now: () => "2026-03-04T05:06:07.000Z",
      pid: () => 999,
      hostname: () => "synthetic-host",
      isPidAlive: () => false
    };
    const owner = new ExecutorLock(directory, options);
    const lease = await owner.acquire();
    const observer = new ExecutorLock(directory, options);

    expect(await observer.diagnoseStaleLock()).toBe("STALE");
    await expect(observer.acquire()).rejects.toBeInstanceOf(ExecutorLockHeldError);
    expect(await observer.readStatus()).toEqual(lease.metadata);

    await lease.release();
  });
});
