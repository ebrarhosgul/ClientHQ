/**
 * An in memory `ObjectStorage`, so every deliverable test runs with no
 * network (spec 0011, "The storage port").
 *
 * `presignPut` and `presignGet` do not actually sign anything: they return a
 * URL that encodes the key, and `put()` below is what a test calls to
 * pretend the browser's `XMLHttpRequest` landed the bytes. Nothing here
 * asserts on `Content-Type`/`Content-Length` binding, that guarantee is R2's
 * own signature and is covered by `r2.test.ts` against the real
 * implementation with dummy credentials.
 */
import type { HeadResult, ObjectStorage } from "./port";

export type FakeObject = {
  readonly contentType: string;
  readonly contentLength: number;
};

export type FakeObjectStorage = ObjectStorage & {
  /** Record that a PUT to `key` landed, as the browser would have done. */
  readonly put: (key: string, object: FakeObject) => void;
  /** Whether an object currently sits at `key`. */
  readonly has: (key: string) => boolean;
  /** Every key ever passed to `delete()`, in call order. */
  readonly deleted: readonly string[];
  /** Make the next `delete()` call (and only that one) throw. */
  readonly failNextDelete: () => void;
};

export function createFakeObjectStorage(): FakeObjectStorage {
  const objects = new Map<string, FakeObject>();
  const deleted: string[] = [];
  let failNext = false;

  return {
    put(key, object) {
      objects.set(key, object);
    },

    has(key) {
      return objects.has(key);
    },

    deleted,

    failNextDelete() {
      failNext = true;
    },

    async presignPut({ key }) {
      return `https://fake-storage.test/${encodeURIComponent(key)}?signed=put`;
    },

    async presignGet({ key, filename }) {
      return `https://fake-storage.test/${encodeURIComponent(key)}?signed=get&filename=${encodeURIComponent(filename)}`;
    },

    async head(key): Promise<HeadResult | undefined> {
      const object = objects.get(key);

      return object === undefined
        ? undefined
        : {
            contentType: object.contentType,
            contentLength: object.contentLength,
          };
    },

    async delete(key) {
      deleted.push(key);

      if (failNext) {
        failNext = false;
        throw new Error("fake storage: delete failed");
      }

      objects.delete(key);
    },
  };
}
