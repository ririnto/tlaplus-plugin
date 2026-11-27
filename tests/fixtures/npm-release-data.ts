import assert from "node:assert/strict";

/**
 * @param value JSON object fields.
 * @returns Whether the value is a JSON object.
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** @param value JSON object fields. */
export const object = (value: unknown) => {
  assert.ok(isObject(value));
  return value;
};

/**
 * @param value JSON array items.
 * @returns Array items.
 */
export const array = (value: unknown): readonly unknown[] => {
  assert.ok(Array.isArray(value));
  return value;
};

/** @param value JSON string field. */
const string = (value: unknown) => {
  assert.ok(typeof value === "string");
  return value;
};

/** @param text Release manifest JSON. */
export const releaseManifest = (text: string) => {
  const data = object(JSON.parse(text));
  return {
    commit: string(data.commit),
    gitTag: string(data.gitTag),
    holdingTag: string(data.holdingTag),
    toolsTag: string(data.toolsTag),
    version: string(data.version),
    packages: array(data.packages).map((value) => {
      const pkg = object(value);
      return {
        name: string(pkg.name),
        tarball: string(pkg.tarball),
        integrity: string(pkg.integrity),
        shasum: string(pkg.shasum)
      };
    })
  };
};
