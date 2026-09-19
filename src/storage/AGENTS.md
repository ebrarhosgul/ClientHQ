# Storage

## Overview

The one way the product reaches object storage: a four operation port with a real Cloudflare R2 implementation and an in memory fake. Deliverable uploads and downloads go through it, and nothing else may talk to R2. Settled by [spec 0011](../../docs/specs/0011-deliverable-upload-download/index.md).

## Key files

| File | Owns |
|---|---|
| `src/storage/port.ts` | The `ObjectStorage` type: `presignPut`, `presignGet`, `head` and `delete` |
| `src/storage/r2.ts` | The real implementation over the AWS S3 SDK |
| `src/storage/fake.ts` | The in memory substitute every deliverable test runs against |
| `src/storage/index.ts` | `objectStorage()`, which is `undefined` when R2 is not configured, and `isStorageConfigured()` |
| `scripts/r2-setup.ts` (repo root) | Applies the bucket's CORS rule. Uses the separate admin token |

## Conventions

- Only this folder and `scripts/r2-setup.ts` import `@aws-sdk/*`. ESLint enforces it with a restricted imports rule. Everyone else imports from `@/storage`.
- The port is exactly four operations. Adding a fifth means changing the fake too, so tests stay a complete substitute.
- Callers treat `objectStorage()` returning `undefined` as "storage is not set up" and render that state, in every Server Action and the download route.
- Signed PUTs fix `Content-Type` and `Content-Length`, and signed GETs fix an `attachment` disposition. An object key is never built from user text and never returned to the browser.
- Removal order is always the object first, then the row.

## Gotchas

- **R2 rejects checksum headers on a signed request.** Both checksum settings are pinned to `WHEN_REQUIRED`, and `r2.test.ts` asserts neither header appears in a signed URL. Do not change them.
- **Presigning is a local computation and never contacts R2.** Only `head` and `delete` do.
- **Type and size are enforced by R2's signature, not by this app.** A browser sending different values gets a 403 from R2. A `ready` row's size and type are read back with `head`, never taken from the browser.
- **Build the client inside a function, never at module scope.** A build must never need credentials. `isStorageConfigured()` reads `process.env` directly on purpose, because the download route asks before Clerk is known to be configured.
- **The bucket has no public access.** The app's token is scoped to one bucket with Object Read and Write only. The setup script's Admin token lives only in the operator's shell.

## Agent skills

- [cloudflare-r2](../../.agents/skills/cloudflare-r2/): buckets, presigned URLs, CORS and R2 error codes

## Related specs

- [Spec 0011](../../docs/specs/0011-deliverable-upload-download/index.md): the port, the upload flow and the invariants above

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
