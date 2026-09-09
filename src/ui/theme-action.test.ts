/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { setThemeAction, setThemeFormAction } = await import("./theme-action");

beforeEach(() => {
  jar.set.mockClear();
  jar.delete.mockClear();
  revalidatePath.mockClear();
});

describe("storing a theme", () => {
  it.each(["light", "dark"] as const)(
    "writes %s to the cookie",
    async (theme) => {
      const result = await setThemeAction(theme);

      expect(result).toEqual({ ok: true, data: undefined });
      expect(jar.set).toHaveBeenCalledWith(
        "clienthq_theme",
        theme,
        expect.objectContaining({ path: "/", sameSite: "lax" }),
      );
    },
  );

  it("keeps the cookie out of reach of script", async () => {
    await setThemeAction("dark");

    // Nothing in the browser reads it: the root layout does, on the server.
    expect(jar.set).toHaveBeenCalledWith(
      "clienthq_theme",
      "dark",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("keeps the choice for a year", async () => {
    await setThemeAction("light");

    expect(jar.set).toHaveBeenCalledWith(
      "clienthq_theme",
      "light",
      expect.objectContaining({ maxAge: 60 * 60 * 24 * 365 }),
    );
  });

  it("deletes the cookie for System rather than storing the word", async () => {
    const result = await setThemeAction("system");

    expect(result.ok).toBe(true);
    expect(jar.delete).toHaveBeenCalledWith("clienthq_theme");
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("revalidates the whole layout, because every route reads the cookie", async () => {
    await setThemeAction("dark");

    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("refusing a value that is not a theme", () => {
  it.each(["solarized", "", null, undefined, 42, {}])(
    "returns a validation failure for %s",
    async (value) => {
      const result = await setThemeAction(value);

      expect(result).toEqual({
        ok: false,
        error: { code: "validation", message: "That is not a theme." },
      });
    },
  );

  it("leaves the stored choice exactly as it was", async () => {
    await setThemeAction("solarized");

    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });

  it("does not revalidate, because nothing changed", async () => {
    await setThemeAction("solarized");

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("uses a code from the closed set rather than inventing one", async () => {
    const result = await setThemeAction("solarized");

    // `ACTION_ERROR_CODES` is closed so the UI can switch on it exhaustively.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });
});

describe("the form shaped action", () => {
  it("stores the theme the clicked button submitted", async () => {
    const form = new FormData();
    form.set("theme", "dark");

    await setThemeFormAction(form);

    expect(jar.set).toHaveBeenCalledWith(
      "clienthq_theme",
      "dark",
      expect.anything(),
    );
  });

  it("changes nothing when the field is missing", async () => {
    await setThemeFormAction(new FormData());

    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });
});
