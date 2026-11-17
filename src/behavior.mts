import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

export const behaviorLimit = 2 * 1024 * 1024;
export const behaviorPrefix = (directory: string): string =>
  path.join(directory, "behavior");

export const readBehavior = async (directory: string): Promise<string> => {
  const file = await open(
    `${behaviorPrefix(directory)}_0_0`,
    constants.O_RDONLY + constants.O_NOFOLLOW + constants.O_NONBLOCK
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > behaviorLimit) {
      throw new Error(
        "Behavior must be a nonempty regular file of at most 2 MiB"
      );
    }
    const buffer = Buffer.alloc(behaviorLimit + 1);
    const readChunk = async (offset: number): Promise<number> => {
      const chunk = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      );
      const next = offset + chunk.bytesRead;
      if (chunk.bytesRead > 0 && next < buffer.length) {
        return await readChunk(next);
      }
      return next;
    };
    const bytesRead = await readChunk(0);
    if (bytesRead === 0 || bytesRead > behaviorLimit) {
      throw new Error("Behavior is empty or exceeds the 2 MiB response limit");
    }
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } finally {
    await file.close();
  }
};
