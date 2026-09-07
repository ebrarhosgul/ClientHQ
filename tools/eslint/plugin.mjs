import noRawDbImport from "./no-raw-db-import.mjs";
import noSystemAccessImport from "./no-system-access-import.mjs";

/** The local plugin, so both rules can be referenced as `clienthq/...`. */
export const clienthqPlugin = {
  meta: { name: "eslint-plugin-clienthq", version: "1.0.0" },
  rules: {
    "no-raw-db-import": noRawDbImport,
    "no-system-access-import": noSystemAccessImport,
  },
};
