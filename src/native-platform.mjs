/**
 * Returns the C library used by the current Node.js process on Linux.
 * @returns {"glibc" | "musl" | null} The detected libc, or null outside Linux.
 */
export const linuxLibc = () => {
  if (process.platform !== "linux") {
    return null;
  }

  const report = process.report.getReport();
  if (
    "header" in report &&
    typeof report.header === "object" &&
    report.header !== null &&
    "glibcVersionRuntime" in report.header &&
    typeof report.header.glibcVersionRuntime === "string"
  ) {
    return "glibc";
  }

  if (
    "sharedObjects" in report &&
    Array.isArray(report.sharedObjects) &&
    report.sharedObjects.some(
      (entry) =>
        typeof entry === "string" && /\/ld-musl-[^/]+\.so\.1$/u.test(entry)
    )
  ) {
    return "musl";
  }

  throw new Error("Cannot determine which Linux C library Node.js uses");
};

/**
 * Returns the platform suffix used in native npm package names.
 */
export const nativePlatform = () => {
  const libc = linuxLibc();
  const platform = `${process.platform}-${process.arch}`;
  if (libc === null) {
    return platform;
  }

  return `${platform}-${libc === "glibc" ? "gnu" : "musl"}`;
};
