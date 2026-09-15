"use client";

/**
 * Pick a file, upload it straight to R2, and confirm it (spec 0011, AC-1,
 * AC-2, AC-5, AC-6, AC-7, AC-8).
 *
 * The five steps from the spec's browser flow: pick, `requestUpload`, an
 * `XMLHttpRequest` PUT with progress, `confirmUpload` with its retry on
 * `conflict`, and the failure branches each with their own way back in.
 * `Content-Length` is never set by hand: the browser computes it when
 * `xhr.send(file)` runs, and setting it manually is forbidden by the
 * platform anyway.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/ui/primitives/button";
import { Progress } from "@/ui/primitives/progress";

import { abandonUpload } from "../abandon-upload";
import { confirmUpload } from "../confirm-upload";
import { formatBytes } from "../format";
import { UPLOAD_ACCEPT } from "../file-rules";
import { requestUpload } from "../request-upload";

type Phase =
  | "idle"
  | "requesting"
  | "uploading"
  | "confirming"
  | "put-failed"
  | "confirm-retry-exhausted"
  | "confirm-invalid"
  | "confirm-cancelled";

const CONFIRM_RETRY_DELAY_MS = 2000;
const CONFIRM_MAX_ATTEMPTS = 3;

export function UploadDeliverable({
  projectId,
}: {
  readonly projectId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | undefined>(undefined);

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | undefined>();
  const [progress, setProgress] = useState(0);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const [pending, setPending] = useState<
    { readonly deliverableId: string } | undefined
  >();

  // Best effort, per the action's own docblock: nothing depends on this
  // call arriving, so a rejection (network failure reaching the action, or
  // anything else) is swallowed rather than left as an unhandled promise
  // rejection. The result's own `ok`/`error` is equally uninteresting here.
  function safeAbandon(deliverableId: string) {
    abandonUpload({ deliverableId }).catch(() => undefined);
  }

  function reset() {
    setPhase("idle");
    setFile(undefined);
    setProgress(0);
    setFieldError(undefined);
    setMessage(undefined);
    setPending(undefined);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function putFile(
    uploadedFile: File,
    deliverableId: string,
    uploadUrl: string,
  ) {
    setPhase("uploading");
    setProgress(0);
    setMessage(undefined);
    setAnnouncement(`Uploading ${uploadedFile.name}.`);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        void runConfirm(deliverableId, 1);
      } else {
        safeAbandon(deliverableId);
        setPhase("put-failed");
        setMessage("The upload did not finish.");
        setAnnouncement("The upload did not finish.");
      }
    };

    xhr.onerror = () => {
      safeAbandon(deliverableId);
      setPhase("put-failed");
      setMessage("The upload did not finish.");
      setAnnouncement("The upload did not finish.");
    };

    xhr.onabort = () => {
      safeAbandon(deliverableId);
      reset();
    };

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", uploadedFile.type);
    xhr.send(uploadedFile);
  }

  async function runConfirm(deliverableId: string, attempt: number) {
    setPhase("confirming");
    setAnnouncement("Confirming upload.");

    let result;

    try {
      result = await confirmUpload({ deliverableId });
    } catch {
      // A rejection here (a dropped connection reaching the action, or
      // anything else escaping it) must not leave the UI stuck on
      // "Finishing up…" with no way out. Land on the same retryable phase
      // the exhausted-retries branch below uses.
      setPhase("confirm-retry-exhausted");
      setMessage("The upload could not be confirmed. Try again in a moment.");
      setAnnouncement("The upload could not be confirmed.");
      return;
    }

    if (result.ok) {
      setAnnouncement("Upload complete.");
      router.refresh();
      reset();
      return;
    }

    if (result.error.code === "conflict") {
      if (attempt < CONFIRM_MAX_ATTEMPTS) {
        setTimeout(() => {
          void runConfirm(deliverableId, attempt + 1);
        }, CONFIRM_RETRY_DELAY_MS);
        return;
      }

      setPhase("confirm-retry-exhausted");
      setMessage("Your file is still being processed. Try again in a moment.");
      setAnnouncement("Your file is still being processed.");
      return;
    }

    if (result.error.code === "validation") {
      setPhase("confirm-invalid");
      setMessage(
        "This file was removed because it did not match what was declared.",
      );
      setAnnouncement("The upload was removed.");
      return;
    }

    setPhase("confirm-cancelled");
    setMessage("This upload was cancelled.");
    setAnnouncement("This upload was cancelled.");
  }

  async function beginUpload(pickedFile: File) {
    setPhase("requesting");
    setFieldError(undefined);
    setMessage(undefined);
    setAnnouncement(`Starting upload for ${pickedFile.name}.`);

    let result;

    try {
      result = await requestUpload({
        projectId,
        name: pickedFile.name,
        contentType: pickedFile.type,
        sizeBytes: pickedFile.size,
      });
    } catch {
      // A rejection here must not leave the file input locked in the
      // "requesting" phase with no message and no way to try again.
      setMessage("The upload could not be started. Try again.");
      setAnnouncement("The upload could not be started.");
      setPhase("idle");
      setFile(undefined);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      return;
    }

    if (!result.ok) {
      const [firstFieldError] =
        Object.values(result.error.fieldErrors ?? {})[0] ?? [];

      setFieldError(
        result.error.code === "validation"
          ? (firstFieldError ?? result.error.message)
          : undefined,
      );

      if (result.error.code !== "validation") {
        setMessage(result.error.message);
      }

      setPhase("idle");
      setFile(undefined);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      return;
    }

    setPending({ deliverableId: result.data.deliverableId });
    putFile(pickedFile, result.data.deliverableId, result.data.uploadUrl);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          aria-label="Choose a file to upload"
          disabled={phase !== "idle"}
          className="w-full min-w-0 text-sm"
          onChange={(event) => {
            const picked = event.target.files?.[0];

            if (picked !== undefined) {
              setFile(picked);
              void beginUpload(picked);
            }
          }}
        />
      </div>

      {fieldError !== undefined ? (
        <p role="alert" className="text-sm text-destructive">
          {fieldError}
        </p>
      ) : undefined}

      {phase === "uploading" && file !== undefined ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {file.name} · {formatBytes(file.size)}
            </span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} aria-label={`Uploading ${file.name}`} />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => xhrRef.current?.abort()}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : undefined}

      {phase === "confirming" ? (
        <p className="text-sm text-muted-foreground">Finishing up…</p>
      ) : undefined}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {message !== undefined ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
        >
          <span>{message}</span>
          {phase === "put-failed" && file !== undefined ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void beginUpload(file)}
            >
              Retry
            </Button>
          ) : undefined}
          {phase === "confirm-retry-exhausted" && pending !== undefined ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runConfirm(pending.deliverableId, 1)}
            >
              Retry
            </Button>
          ) : undefined}
          {phase === "put-failed" ||
          phase === "confirm-invalid" ||
          phase === "confirm-cancelled" ? (
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              Choose another file
            </Button>
          ) : undefined}
        </div>
      ) : undefined}
    </div>
  );
}
