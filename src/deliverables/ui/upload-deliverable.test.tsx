/**
 * covers: spec 0011 AC-1, AC-2, AC-5, AC-6, AC-7, AC-8
 *
 * The upload flow never really talks to R2 in a test; a fake
 * `XMLHttpRequest` stands in so each phase (picking, the signed PUT with
 * progress, confirming with its retry on `conflict`, and every failure
 * branch) can be driven and asserted directly, matching the way `r2.test.ts`
 * fakes the storage port rather than hitting the network.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const mocks = vi.hoisted(() => ({
  requestUpload: vi.fn(),
  confirmUpload: vi.fn(),
  abandonUpload: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../request-upload", () => ({ requestUpload: mocks.requestUpload }));
vi.mock("../confirm-upload", () => ({ confirmUpload: mocks.confirmUpload }));
vi.mock("../abandon-upload", () => ({ abandonUpload: mocks.abandonUpload }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { UploadDeliverable } = await import("./upload-deliverable");

type ProgressHandler = (event: {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}) => void;

class FakeXHR {
  static instances: FakeXHR[] = [];

  readonly upload: { onprogress?: ProgressHandler } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 0;
  openedMethod = "";
  openedUrl = "";
  readonly requestHeaders: Record<string, string> = {};
  sentBody: unknown;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.openedMethod = method;
    this.openedUrl = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }

  send(body: unknown) {
    this.sentBody = body;
  }

  abort() {
    this.onabort?.();
  }
}

function pickedFile() {
  return new File(["hello"], "Contract.pdf", { type: "application/pdf" });
}

const PENDING = {
  deliverableId: "d1",
  uploadUrl: "https://r2.example.com/put-url",
  expiresAt: new Date("2026-01-01T00:15:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("UploadDeliverable", () => {
  it("requests, uploads and confirms, then refreshes and resets (AC-1, AC-5, AC-6)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });
    mocks.confirmUpload.mockResolvedValue({
      ok: true,
      data: { status: "ready", sizeBytes: 5, contentType: "application/pdf" },
    });

    render(<UploadDeliverable projectId="p1" />);
    const input = screen.getByLabelText("Choose a file to upload");
    const file = pickedFile();

    await user.upload(input, file);

    await waitFor(() => {
      expect(mocks.requestUpload).toHaveBeenCalledWith({
        projectId: "p1",
        name: "Contract.pdf",
        contentType: "application/pdf",
        sizeBytes: 5,
      });
    });

    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    const xhr = FakeXHR.instances[0];
    expect(xhr.openedMethod).toBe("PUT");
    expect(xhr.openedUrl).toBe(PENDING.uploadUrl);
    expect(xhr.requestHeaders["Content-Type"]).toBe("application/pdf");
    expect(input).toBeDisabled();

    act(() => {
      xhr.upload.onprogress?.({
        lengthComputable: true,
        loaded: 25,
        total: 100,
      });
    });
    expect(
      screen.getByRole("progressbar", { name: "Uploading Contract.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(
      screen.getByText("Uploading Contract.pdf.", { selector: "p" }),
    ).toBeInTheDocument();

    xhr.status = 200;
    xhr.onload?.();

    await waitFor(() => {
      expect(mocks.confirmUpload).toHaveBeenCalledWith({ deliverableId: "d1" });
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    expect(screen.getByText("Upload complete.")).toBeInTheDocument();
    expect(input).not.toBeDisabled();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the field error and lets the input be used again on a validation refusal (AC-2)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({
      ok: false,
      error: {
        code: "validation",
        message: "",
        fieldErrors: { contentType: ["That file type is not supported."] },
      },
    });

    render(<UploadDeliverable projectId="p1" />);
    const input = screen.getByLabelText("Choose a file to upload");

    await user.upload(input, pickedFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That file type is not supported.",
    );
    expect(input).not.toBeDisabled();
    expect(input).toHaveValue("");
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("shows the handler's message on a non-validation refusal, such as an archived project (AC-1)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({
      ok: false,
      error: {
        code: "conflict",
        message: "This project is archived, so no files can be added.",
      },
    });

    render(<UploadDeliverable projectId="p1" />);
    await user.upload(
      screen.getByLabelText("Choose a file to upload"),
      pickedFile(),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This project is archived, so no files can be added.",
    );
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("abandons the upload and retries with a fresh request, not the abandoned row's URL (AC-5, AC-8)", async () => {
    const user = userEvent.setup();
    const RETRY_PENDING = {
      deliverableId: "d2",
      uploadUrl: "https://r2.example.com/put-url-2",
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
    };
    mocks.requestUpload
      .mockResolvedValueOnce({ ok: true, data: PENDING })
      .mockResolvedValueOnce({ ok: true, data: RETRY_PENDING });

    render(<UploadDeliverable projectId="p1" />);
    const input = screen.getByLabelText("Choose a file to upload");
    await user.upload(input, pickedFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

    const xhr = FakeXHR.instances[0];
    xhr.status = 500;
    xhr.onload?.();

    await waitFor(() => {
      expect(mocks.abandonUpload).toHaveBeenCalledWith({ deliverableId: "d1" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The upload did not finish.",
    );
    expect(mocks.confirmUpload).not.toHaveBeenCalled();
    expect(input).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    // A fresh `requestUpload` for a fresh row, per spec 0011's browser flow
    // step 5, not a second PUT to the abandoned row's presigned URL.
    await waitFor(() => expect(mocks.requestUpload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    expect(FakeXHR.instances[1].openedUrl).toBe(RETRY_PENDING.uploadUrl);
    expect(FakeXHR.instances[1].openedUrl).not.toBe(PENDING.uploadUrl);
    expect(mocks.abandonUpload).toHaveBeenCalledTimes(1);
  });

  it("unlocks the file input via Choose another file after a failed PUT, with no successful retry (AC-8)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });

    render(<UploadDeliverable projectId="p1" />);
    const input = screen.getByLabelText("Choose a file to upload");
    await user.upload(input, pickedFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

    FakeXHR.instances[0].status = 500;
    FakeXHR.instances[0].onload?.();
    await screen.findByRole("alert");
    expect(input).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Choose another file" }),
    );

    expect(input).not.toBeDisabled();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a network error the same as a failed PUT (AC-8)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });

    render(<UploadDeliverable projectId="p1" />);
    await user.upload(
      screen.getByLabelText("Choose a file to upload"),
      pickedFile(),
    );
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

    FakeXHR.instances[0].onerror?.();

    await waitFor(() => {
      expect(mocks.abandonUpload).toHaveBeenCalledWith({ deliverableId: "d1" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The upload did not finish.",
    );
  });

  it("abandons and resets with no error when the upload is cancelled (AC-5, AC-8)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });

    render(<UploadDeliverable projectId="p1" />);
    const input = screen.getByLabelText("Choose a file to upload");
    await user.upload(input, pickedFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(mocks.abandonUpload).toHaveBeenCalledWith({ deliverableId: "d1" });
    });
    expect(input).not.toBeDisabled();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.confirmUpload).not.toHaveBeenCalled();
  });

  it("retries confirm on conflict up to three attempts, then offers a manual retry that succeeds (AC-6)", async () => {
    vi.useFakeTimers();
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });
    mocks.confirmUpload.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "" },
    });

    render(<UploadDeliverable projectId="p1" />);
    const input = screen.getByLabelText("Choose a file to upload");

    fireEvent.change(input, { target: { files: [pickedFile()] } });
    await vi.advanceTimersByTimeAsync(0);

    const xhr = FakeXHR.instances[0];
    xhr.status = 200;
    xhr.onload?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirmUpload).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.confirmUpload).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.confirmUpload).toHaveBeenCalledTimes(3);

    // Exhausted at three attempts: no further automatic retry.
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.confirmUpload).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your file is still being processed. Try again in a moment.",
    );

    mocks.confirmUpload.mockResolvedValueOnce({
      ok: true,
      data: { status: "ready", sizeBytes: 5, contentType: "application/pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.confirmUpload).toHaveBeenCalledTimes(4);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the invalid-file message and lets the person choose another file (AC-7)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });
    mocks.confirmUpload.mockResolvedValue({
      ok: false,
      error: {
        code: "validation",
        message: "",
      },
    });

    render(<UploadDeliverable projectId="p1" />);
    await user.upload(
      screen.getByLabelText("Choose a file to upload"),
      pickedFile(),
    );
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

    FakeXHR.instances[0].status = 200;
    FakeXHR.instances[0].onload?.();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file was removed because it did not match what was declared.",
    );

    await user.click(
      screen.getByRole("button", { name: "Choose another file" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a cancelled message for any other confirm refusal (AC-7)", async () => {
    const user = userEvent.setup();
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });
    mocks.confirmUpload.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "" },
    });

    render(<UploadDeliverable projectId="p1" />);
    await user.upload(
      screen.getByLabelText("Choose a file to upload"),
      pickedFile(),
    );
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

    FakeXHR.instances[0].status = 200;
    FakeXHR.instances[0].onload?.();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This upload was cancelled.",
    );
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation while idle", async () => {
    const { container } = render(<UploadDeliverable projectId="p1" />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation mid upload, with the progress bar and cancel button shown", async () => {
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });

    const { container } = render(<UploadDeliverable projectId="p1" />);
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Choose a file to upload"), pickedFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation on a failed upload with its retry button", async () => {
    mocks.requestUpload.mockResolvedValue({ ok: true, data: PENDING });

    const { container } = render(<UploadDeliverable projectId="p1" />);
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Choose a file to upload"), pickedFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].status = 500;
    FakeXHR.instances[0].onload?.();
    await screen.findByRole("alert");

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
