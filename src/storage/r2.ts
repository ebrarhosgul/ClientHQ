/**
 * The real object storage: Cloudflare R2, spoken to as S3 (spec 0011,
 * "The storage port").
 *
 * Three things this file exists to get right, each one a documented R2
 * quirk rather than a general S3 fact:
 *
 * 1. **No checksum headers on a signed request.** The SDK's default checksum
 *    middleware adds `x-amz-sdk-checksum-algorithm` and an `x-amz-checksum-*`
 *    header, and R2 rejects a presigned PUT that carries either. Both
 *    settings below are pinned to `"WHEN_REQUIRED"`, and `r2.test.ts` asserts
 *    neither header appears in a signed URL.
 * 2. **The signed `Content-Type` and `Content-Length` are signed headers**,
 *    not query parameters: `signableHeaders` forces the presigner to fix them
 *    into the signature, so a browser that sends a different declared type or
 *    size gets a 403 from R2 itself, never from this application.
 * 3. **The client is built inside a function, never at module scope**,
 *    exactly the rule `src/db/AGENTS.md` sets for the database handle: a
 *    build must never need real credentials.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "@/lib/env";

import type {
  HeadResult,
  ObjectStorage,
  PresignGetArgs,
  PresignPutArgs,
} from "./port";

function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env().R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env().R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env().R2_SECRET_ACCESS_KEY ?? "",
    },
    // R2 rejects a presigned request carrying either checksum header the SDK
    // adds by default (see the file docblock).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function bucket(): string {
  return env().R2_BUCKET ?? "";
}

/**
 * Every non ASCII character, and every character that could break out of the
 * quoted `filename` fallback in `Content-Disposition` (`"` and `\`),
 * replaced with `_`. The schema already refuses those two plus `/` and
 * control characters at the name's front door (spec 0011, AC-2), but this
 * function does not rely on that alone: the header it builds cannot be
 * broken out of no matter what reaches it.
 */
function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7e]|["\\]/gu, "_");
}

async function presignPut({
  key,
  contentType,
  contentLength,
  expiresInSeconds,
}: PresignPutArgs): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  return getSignedUrl(client(), command, {
    expiresIn: expiresInSeconds,
    // Both bind into the signature as headers, not hoisted into the query,
    // so a PUT with a different declared type or length is refused by R2.
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

async function presignGet({
  key,
  filename,
  expiresInSeconds,
}: PresignGetArgs): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });

  return getSignedUrl(client(), command, { expiresIn: expiresInSeconds });
}

async function head(key: string): Promise<HeadResult | undefined> {
  try {
    const output = await client().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: key }),
    );

    return {
      contentType: output.ContentType ?? "",
      contentLength: output.ContentLength ?? 0,
    };
  } catch (error) {
    if (error instanceof NotFound) {
      return undefined;
    }

    throw error;
  }
}

async function remove(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export const r2Storage: ObjectStorage = {
  presignPut,
  presignGet,
  head,
  delete: remove,
};
