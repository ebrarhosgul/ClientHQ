/**
 * Apply the R2 bucket's CORS rule, so a browser on `NEXT_PUBLIC_APP_URL` can
 * `PUT` straight to a signed URL (spec 0011, AC-19).
 *
 * Run it with `pnpm r2:setup`, once per environment (one bucket each: local,
 * preview, production). Safe to run repeatedly: `PutBucketCors` replaces the
 * whole rule set, so applying the same rule twice leaves the bucket exactly
 * as it was.
 *
 * Authenticates with `R2_ADMIN_ACCESS_KEY_ID` and `R2_ADMIN_SECRET_ACCESS_KEY`,
 * an Admin Read and Write token that lives only in the operator's shell: the
 * app itself never reads these two, and they are never set on Vercel.
 */
import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "../src/lib/env";
import { loadEnvFiles } from "../src/lib/load-env-files";

loadEnvFiles();

/** One day, in seconds: how long a browser may cache the preflight answer. */
const CORS_MAX_AGE_SECONDS = 86_400;

function requireVariable(name: string, value: string | undefined): string {
  if (value === undefined) {
    console.error(`${name} is required to run this script.`);
    console.error(
      "Set R2_ADMIN_ACCESS_KEY_ID, R2_ADMIN_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, " +
        "R2_BUCKET and NEXT_PUBLIC_APP_URL, then run again.",
    );
    process.exit(1);
  }

  return value;
}

async function main() {
  const value = env();

  const accessKeyId = requireVariable(
    "R2_ADMIN_ACCESS_KEY_ID",
    value.R2_ADMIN_ACCESS_KEY_ID,
  );
  const secretAccessKey = requireVariable(
    "R2_ADMIN_SECRET_ACCESS_KEY",
    value.R2_ADMIN_SECRET_ACCESS_KEY,
  );
  const accountId = requireVariable("R2_ACCOUNT_ID", value.R2_ACCOUNT_ID);
  const bucket = requireVariable("R2_BUCKET", value.R2_BUCKET);
  // Read straight off `process.env`, not `value.NEXT_PUBLIC_APP_URL`: the
  // schema gives that field a `http://localhost:3000` default, so it can
  // never be `undefined` and this check could never fire through `env()`.
  const appUrl = requireVariable(
    "NEXT_PUBLIC_APP_URL",
    process.env.NEXT_PUBLIC_APP_URL,
  );

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [appUrl],
            AllowedMethods: ["PUT"],
            AllowedHeaders: ["Content-Type"],
            MaxAgeSeconds: CORS_MAX_AGE_SECONDS,
          },
        ],
      },
    }),
  );

  const readBack = await client.send(
    new GetBucketCorsCommand({ Bucket: bucket }),
  );

  console.log(`CORS applied to bucket "${bucket}".`);
  console.log(JSON.stringify(readBack.CORSRules, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Could not apply the CORS rule.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
