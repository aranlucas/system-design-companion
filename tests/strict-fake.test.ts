import { describe, expect, it } from "vitest";
import { strictFake } from "./helpers/strict-fake.ts";

interface Counter {
  count: number;
  increment: () => number;
  missing: () => void;
}

const token = Symbol("token");

interface SymbolOwner {
  [token]: string;
  absent: string;
}

class PrivateCounter {
  #count = 2;
  increment() {
    return ++this.#count;
  }
  toString() {
    return `count:${this.#count}`;
  }
}

describe("strict runtime fakes", () => {
  it("returns provided data, preserves method receivers and stable identity", () => {
    const members = {
      count: 0,
      increment() {
        return ++this.count;
      },
    };

    const counter = strictFake<Counter>(members);
    expect(counter.increment()).toBe(1);
    expect(counter.count).toBe(1);
    expect(members.count).toBe(1);
    expect(counter.increment).toBe(counter.increment);
    expect(() => counter.missing()).toThrow("Unimplemented fake member: missing");
  });
  it("rejects missing and undefined properties, including symbol keys", () => {
    const value = strictFake<SymbolOwner>({ [token]: "present" });
    expect(value[token]).toBe("present");
    expect(() => value.absent).toThrow("Unimplemented fake member: absent");
    const absent = strictFake<SymbolOwner>({ absent: undefined });
    expect(() => absent.absent).toThrow("Unimplemented fake member: absent");
    expect(() => absent[token]).toThrow("Unimplemented fake member: Symbol(token)");
  });
  it("resolves prototype descriptors without losing private-field receivers", () => {
    const owner = new PrivateCounter();
    const counter = strictFake<PrivateCounter>(owner);
    expect(counter.increment()).toBe(3);
    expect(counter.constructor).toBe(PrivateCounter);
    expect(counter.toString()).toBe("count:3");
    expect(counter instanceof PrivateCounter).toBe(true);
  });
});

import { makeRoomCtx, makeWs } from "./helpers/fakes.ts";

type MetadataRow = { k: string; v: string };

it("runs real in-memory SQL, rollback and socket behavior through typed runtime seams", () => {
  const room = makeRoomCtx();
  const sql = room.ctx.storage.sql;
  sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", "name", "Before");
  expect([...sql.exec<MetadataRow>("SELECT k, v FROM meta")]).toEqual([{ k: "name", v: "Before" }]);
  expect(() =>
    room.ctx.storage.transactionSync(() => {
      sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", "name", "After");
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  expect(sql.exec<MetadataRow>("SELECT k, v FROM meta").one()).toEqual({ k: "name", v: "Before" });
  const socket = makeWs();
  room.ctx.acceptWebSocket(socket);
  expect(room.ctx.getWebSockets()[0]).toBe(socket);
  socket.send("frame");
  expect(socket.sent).toEqual(["frame"]);
  expect(() => room.ctx.abort()).toThrow("Unimplemented fake member: abort");
  expect(() => socket.accept()).toThrow("Unimplemented fake member: accept");
});

it("requires an explicit ordinary-data contract before allowing Promise assimilation", async () => {
  const data = strictFake<Counter>({ count: 2 }, { nonThenable: true });
  expect(await Promise.resolve(data)).toBe(data);
  const missingPromise = strictFake<Promise<number>>({});
  await expect(Promise.resolve(missingPromise)).rejects.toThrow("Unimplemented fake member: then");
});
