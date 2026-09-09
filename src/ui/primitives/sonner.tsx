"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircle,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * The toast host, mounted once in the root layout.
 *
 * The generated version reads `next-themes`. This product decides the theme on
 * the server and stamps it on `<html>`, so there is nothing to read: the colour
 * variables below point at the same tokens as everything else, and they flip
 * with the palette on their own.
 *
 * The toast rules, which this component cannot enforce but the review can:
 * a toast reports an *outcome* ("Client saved"), it is dismissible, and it is
 * never the only place an error appears (AC-13). An error that scrolls away
 * after four seconds is an error nobody read.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      // Assertive would interrupt a screen reader mid sentence for a message
      // that is, by the rule above, never the only copy of anything important.
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--chip-success)",
          "--success-text": "var(--chip-success-foreground)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--chip-danger)",
          "--error-text": "var(--chip-danger-foreground)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--chip-warning)",
          "--warning-text": "var(--chip-warning-foreground)",
          "--warning-border": "var(--border)",
          "--info-bg": "var(--chip-info)",
          "--info-text": "var(--chip-info-foreground)",
          "--info-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
