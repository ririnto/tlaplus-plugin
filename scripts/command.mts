import { spawn } from "node:child_process";
import { once } from "node:events";

interface CommandOutput {
  stdout: string;
  stderr: string;
}

export const run = async (
  command: string,
  args: string[],
  options: { cwd?: URL | string; timeout?: number } = {}
): Promise<CommandOutput> => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const limit = 16 * 1024 * 1024;
  let stdout = "";
  let stderr = "";
  let overflow = false;
  let timer: NodeJS.Timeout | null = null;
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (data: string) => {
    stdout += data;
    if (stdout.length > limit) {
      stdout = stdout.slice(0, limit);
      overflow = true;
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (data: string) => {
    stderr += data;
    if (stderr.length > limit) {
      stderr = stderr.slice(0, limit);
      overflow = true;
      child.kill("SIGKILL");
    }
  });
  if ((options.timeout ?? 0) > 0) {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeout);
  }
  try {
    await once(child, "close");
    if (child.exitCode !== 0 || overflow) {
      throw Object.assign(
        new Error(`${command} exited ${String(child.exitCode)}: ${stderr}`),
        {
          signal: child.signalCode,
          overflow,
          exitCode: child.exitCode,
          stdout,
          stderr
        }
      );
    }
    return { stdout, stderr };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};
