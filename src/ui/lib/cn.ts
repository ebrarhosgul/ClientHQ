import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names and let the later Tailwind utility win.
 *
 * The shadcn components the tool generates all import this from the `utils`
 * alias in `components.json`, which points here. `clsx` handles the
 * conditionals; `tailwind-merge` resolves two utilities that set the same
 * property, so a caller's `px-6` beats a component's built in `px-4` instead of
 * both landing and the cascade deciding.
 */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
