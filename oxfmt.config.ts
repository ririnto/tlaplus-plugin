import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "**/*.md",
    "dist/**",
    "vendor/**",
    "skills/**",
    "pnpm-lock.yaml"
  ],
  trailingComma: "none"
});
