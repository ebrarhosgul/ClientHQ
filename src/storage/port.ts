/**
 * The narrow shape every deliverable upload and download goes through
 * (spec 0011, `## Feature design`, "The storage port").
 *
 * Four operations, nothing else: sign a PUT, sign a GET, read back what is
 * really there, and delete. Nothing in this project reaches R2 (or the fake)
 * through any other surface, which is what makes `src/storage/fake.ts` a
 * complete substitute in every test.
 */

export type PresignPutArgs = {
  readonly key: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly expiresInSeconds: number;
};

export type PresignGetArgs = {
  readonly key: string;
  /** The name the browser saves the file as. */
  readonly filename: string;
  readonly expiresInSeconds: number;
};

export type HeadResult = {
  readonly contentType: string;
  readonly contentLength: number;
};

export type ObjectStorage = {
  /** A local computation: never contacts R2. */
  readonly presignPut: (args: PresignPutArgs) => Promise<string>;
  /** A local computation: never contacts R2. */
  readonly presignGet: (args: PresignGetArgs) => Promise<string>;
  /** `undefined` when no object exists at `key`. */
  readonly head: (key: string) => Promise<HeadResult | undefined>;
  /** Succeeds with no error when `key` does not exist. */
  readonly delete: (key: string) => Promise<void>;
};
