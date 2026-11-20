declare module "cross-spawn" {
  export const sync: (
    command: string,
    args: readonly string[],
    options: import("node:child_process").SpawnSyncOptionsWithBufferEncoding
  ) => Pick<
    import("node:child_process").SpawnSyncReturns<Buffer>,
    "signal" | "status"
  > & {
    error: Error | null;
  };
}
