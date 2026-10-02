import { afterEach, describe, expect, it, vi } from "vitest";
import type { El } from "../src/shared/protocol.ts";
import { DiagramRoom } from "../src/worker/room.ts";
import {
  createDiagram,
  deleteDiagram,
  ensureSchema,
  listDiagrams,
  listTemplates,
  ownsDiagram,
  saveAsTemplate,
  verifyKey,
} from "../src/worker/store.ts";
import { makeEnv } from "./helpers/fakes.ts";
import { SQLiteD1 } from "./helpers/sqlite-d1.ts";

const owner = "github%3A1";
const databases: SQLiteD1[] = [];

async function setup() {
  const bindings = makeEnv();
  const db = new SQLiteD1();
  databases.push(db);
  bindings.env.DB = db as unknown as D1Database;
  await ensureSchema(bindings.env);
  return { ...bindings, db };
}

function image(id: string): El {
  return {
    id,
    type: "image",
    fileId: id,
    status: "saved",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
  };
}

async function sourceWithImages() {
  const bindings = await setup();
  const source = await createDiagram(bindings.env, "Source", undefined, owner);
  await bindings.rooms.get(source.id)!.seed([image("first"), image("second")]);
  await bindings.bucket.put(`files/${source.id}/first`, "first image");
  await bindings.bucket.put(`files/${source.id}/second`, "second image");
  const template = await saveAsTemplate(bindings.env, source.id, "Template", "description", owner);
  return { ...bindings, source, template };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.sql.close();
});

describe("creation publication and compensation", () => {
  it("keeps the diagram private until its room and template are initialized", async () => {
    const { env, rooms } = await setup();
    const entered = gate();
    const release = gate();
    // oxlint-disable-next-line typescript/unbound-method -- invoked with the real room as this
    const apply = DiagramRoom.prototype.applyPatch;
    vi.spyOn(DiagramRoom.prototype, "applyPatch").mockImplementationOnce(async function (
      this: DiagramRoom,
      ...args
    ) {
      entered.resolve();
      await release.promise;
      return apply.apply(this, args);
    });
    const creating = createDiagram(env, "Ready", "builtin:web-baseline", owner);
    await entered.promise;
    const id = [...rooms.keys()][0];
    const visible = await listDiagrams(env, 50, undefined, owner);
    const owned = await ownsDiagram(env, id, owner);
    release.resolve();
    const created = await creating;
    expect(visible.items).toEqual([]);
    expect(owned).toBe(false);
    expect(await verifyKey(env, created.id, created.key)).toMatchObject({ name: "Ready" });
    expect(await ownsDiagram(env, created.id, owner)).toBe(true);
    expect(await rooms.get(created.id)!.info()).toMatchObject({ id: created.id, name: "Ready" });
    expect((await rooms.get(created.id)!.getGraph()).nodes).toHaveLength(9);
    expect((await listDiagrams(env, 50, undefined, owner)).items.map((item) => item.id)).toEqual([
      created.id,
    ]);
  });

  it.each(["init", "applyPatch"] as const)(
    "cleans a failed %s and retry publishes one board",
    async (stage) => {
      const { env, rooms } = await setup();
      vi.spyOn(DiagramRoom.prototype, stage).mockRejectedValueOnce(new Error(`${stage} failed`));
      await expect(createDiagram(env, "Retry", "builtin:web-baseline", owner)).rejects.toThrow(
        `${stage} failed`,
      );
      expect((await listDiagrams(env, 50, undefined, owner)).items).toEqual([]);
      const failed = [...rooms.values()][0];
      expect(await failed.getRaw()).toEqual([]);
      const created = await createDiagram(env, "Retry", "builtin:web-baseline", owner);
      expect((await listDiagrams(env, 50, undefined, owner)).items.map((item) => item.id)).toEqual([
        created.id,
      ]);
    },
  );

  it.each([false, true])(
    "rolls back metadata on owner insertion failure (template=%s)",
    async (template) => {
      const { env, db, rooms, bucket } = await setup();
      const source = template ? await createDiagram(env, "Source", undefined, owner) : undefined;
      db.sql.exec(`CREATE TRIGGER fail_owner BEFORE INSERT ON diagram_owners
      BEGIN SELECT RAISE(ABORT, 'owner insert failed'); END`);
      const create = () =>
        source
          ? saveAsTemplate(env, source.id, "Retry", undefined, owner)
          : createDiagram(env, "Retry", "builtin:web-baseline", owner);
      await expect(create()).rejects.toThrow("owner insert failed");
      expect(db.sql.prepare("SELECT id FROM diagrams WHERE name = 'Retry'").all()).toEqual([]);
      expect([...bucket.objects.keys()]).toEqual([]);
      if (!source) expect(await [...rooms.values()][0].getRaw()).toEqual([]);
      db.sql.exec("DROP TRIGGER fail_owner");
      const created = await create();
      expect(await ownsDiagram(env, created.id, owner)).toBe(true);
      const listed = template
        ? await listTemplates(env, owner)
        : (await listDiagrams(env, 50, undefined, owner)).items;
      expect(listed.filter((item) => item.name === "Retry").map((item) => item.id)).toEqual([
        created.id,
      ]);
    },
  );

  it.each(["get", "seed"] as const)(
    "cleans a failed template %s without changing the source",
    async (stage) => {
      const { env, rooms, bucket, source, template } = await sourceWithImages();
      const original = new Map(bucket.objects);
      if (stage === "get") {
        const get = bucket.get.bind(bucket);
        vi.spyOn(bucket, "get").mockImplementationOnce(async (key) => {
          if (key === `templates/${template.id}.json`) throw new Error("get failed");
          return get(key);
        });
      } else {
        // oxlint-disable-next-line typescript/unbound-method -- invoked with the real room as this
        const seed = DiagramRoom.prototype.seed;
        vi.spyOn(DiagramRoom.prototype, "seed").mockImplementationOnce(async function (
          this: DiagramRoom,
          elements,
        ) {
          await seed.call(this, elements);
          throw new Error("seed failed");
        });
      }
      await expect(createDiagram(env, "Retry", template.id, owner)).rejects.toThrow(
        `${stage} failed`,
      );
      expect(bucket.objects).toEqual(original);
      expect((await listDiagrams(env, 50, undefined, owner)).items.map((item) => item.id)).toEqual([
        source.id,
      ]);
      const copy = await createDiagram(env, "Retry", template.id, owner);
      expect((await rooms.get(copy.id)!.getRaw()).filter((el) => el.type === "image")).toHaveLength(
        2,
      );
      expect(await bucket.head(`files/${copy.id}/first`)).not.toBeNull();
      expect(await bucket.head(`files/${copy.id}/second`)).not.toBeNull();
    },
  );

  it.each([false, true])(
    "waits for every in-flight file copy before cleanup (saving=%s)",
    async (saving) => {
      const { env, bucket, source, template } = await sourceWithImages();
      const original = new Map(bucket.objects);
      const started = gate();
      const release = gate();
      const put = bucket.put.bind(bucket);
      vi.spyOn(bucket, "put").mockImplementation(async (key, value, options) => {
        if (key.endsWith("/first")) throw new Error("copy failed");
        if (key.endsWith("/second")) {
          started.resolve();
          await release.promise;
        }
        return put(key, value, options);
      });
      let settled = false;
      const creating = saving
        ? saveAsTemplate(env, source.id, "Retry", undefined, owner)
        : createDiagram(env, "Retry", template.id, owner);
      const outcome = creating.catch((error: unknown) => {
        settled = true;
        return error;
      });
      await started.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const settledBeforeCopyFinished = settled;
      release.resolve();
      expect(await outcome).toMatchObject({ message: "copy failed" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settledBeforeCopyFinished).toBe(false);
      expect(bucket.objects).toEqual(original);
      expect((await listTemplates(env, owner)).filter((item) => item.name === "Retry")).toEqual([]);
      expect((await listDiagrams(env, 50, undefined, owner)).items.map((item) => item.id)).toEqual([
        source.id,
      ]);
    },
  );

  it("cleans copied files when writing template content fails, then permits retry", async () => {
    const { env, bucket, source } = await sourceWithImages();
    const original = new Map(bucket.objects);
    const put = bucket.put.bind(bucket);
    const fault = vi.spyOn(bucket, "put").mockImplementation(async (key, value, options) => {
      if (key.startsWith("templates/")) throw new Error("template write failed");
      return put(key, value, options);
    });
    await expect(saveAsTemplate(env, source.id, "Retry", undefined, owner)).rejects.toThrow(
      "template write failed",
    );
    expect(bucket.objects).toEqual(original);
    fault.mockRestore();
    const saved = await saveAsTemplate(env, source.id, "Retry", undefined, owner);
    expect((await listTemplates(env, owner)).filter((item) => item.name === "Retry")).toEqual([
      { ...saved, description: "saved template" },
    ]);
  });

  it.each([false, true])(
    "retains revocation after lost acknowledgement and retries cleanup (template=%s)",
    async (template) => {
      const { env, bucket, db, source } = await sourceWithImages();
      // Simulate a lost publication acknowledgement, after the transaction committed.
      const batch = db.batch.bind(db);
      let accessKey = "";
      vi.spyOn(db, "batch").mockImplementationOnce(async (statements) => {
        await batch(statements);
        if (!template)
          accessKey = (await listDiagrams(env, 50, undefined, owner)).items.find(
            (item) => item.name === "Retry",
          )!.key;
        throw new Error("lost acknowledgement");
      });
      const deletion = vi
        .spyOn(bucket, "delete")
        .mockRejectedValueOnce(new Error("R2 unavailable"));
      const creating = template
        ? saveAsTemplate(env, source.id, "Retry", undefined, owner)
        : createDiagram(env, "Retry", undefined, owner);
      await expect(creating).rejects.toThrow("cleanup incomplete");
      const row = db.sql.prepare("SELECT id FROM diagrams WHERE name = 'Retry'").get();
      const id = String(row!.id);
      expect((await listTemplates(env, owner)).some((item) => item.id === id)).toBe(false);
      expect(await verifyKey(env, id, accessKey)).toBeNull();
      if (template)
        await expect(createDiagram(env, "Hidden", id, owner)).rejects.toThrow("Template not found");
      deletion.mockRestore();
      await deleteDiagram(env, id);
      await deleteDiagram(env, id);
      expect([...bucket.objects.keys()].some((key) => key.includes(id))).toBe(false);
      expect(await ownsDiagram(env, id, owner)).toBe(true);
      expect((await listDiagrams(env, 50, undefined, owner)).items.map((item) => item.id)).toEqual([
        source.id,
      ]);
    },
  );
});
