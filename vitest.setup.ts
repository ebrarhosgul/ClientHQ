import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Testing Library only registers its own cleanup when Vitest runs with globals
// enabled, and this project keeps globals off so every import is explicit.
// Without this, each render stacks on the last and queries find two of things.
afterEach(() => {
  cleanup();
});
