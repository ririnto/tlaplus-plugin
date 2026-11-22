import assert from "node:assert/strict";

/**
 * @param {unknown} value JSON object fields.
 * @returns {value is Record<string, unknown>} Whether the value is a JSON object.
 */
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value JSON object fields. */
export const object = (value) => {
  assert.ok(isObject(value));
  return value;
};

/**
 * @param {unknown} value JSON array items.
 * @returns {readonly unknown[]} Array items.
 */
export const array = (value) => {
  assert.ok(Array.isArray(value));
  return value;
};

/** @param {unknown} value JSON string field. */
const string = (value) => {
  assert.ok(typeof value === "string");
  return value;
};

/** @param {string} text Release manifest JSON. */
export const releaseManifest = (text) => {
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
