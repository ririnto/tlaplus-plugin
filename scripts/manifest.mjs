import { readFile } from "node:fs/promises";

/**
 * Reads a JSON manifest without assuming types for its fields.
 * @param {string} file Path to a UTF-8 JSON manifest.
 * @returns {Promise<Record<string, unknown>>} The manifest's fields, with unvalidated values.
 */
export const readManifest = async (file) => {
  /** @type {unknown} */
  const manifest = JSON.parse(await readFile(file, "utf-8"));
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError(`Expected a JSON object in ${file}`);
  }
  return { ...manifest };
};

/**
 * Reads a package manifest and validates the version used by packaging scripts.
 * @param {string} file Path to a package.json file.
 * @returns {Promise<Record<string, unknown> & { version: string }>} The manifest with a validated version.
 */
export const readPackageManifest = async (file) => {
  const manifest = await readManifest(file);
  if (typeof manifest.version !== "string") {
    throw new TypeError(`Expected a string version in ${file}`);
  }
  return { ...manifest, version: manifest.version };
};
