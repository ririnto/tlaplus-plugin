declare module "cross-spawn" {
  export function sync(
    command: string,
    args: readonly string[],
    options: import("node:child_process").SpawnSyncOptionsWithStringEncoding
  ): import("node:child_process").SpawnSyncReturns<string>;

  export function sync(
    command: string,
    args: readonly string[],
    options: import("node:child_process").SpawnSyncOptionsWithBufferEncoding
  ): Pick<
    import("node:child_process").SpawnSyncReturns<Buffer>,
    "signal" | "status"
  > & {
    error: Error | null;
  };
}
