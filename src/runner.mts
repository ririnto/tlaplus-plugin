import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { behaviorPrefix, readBehavior } from "./behavior.mts";

export const jarPath = fileURLToPath(
  new URL("../vendor/tla2tools.jar", import.meta.url)
);
export const toolNames = [
  "tlaplus_mcp_sany_parse",
  "tlaplus_mcp_tlc_check",
  "tlaplus_mcp_tlc_smoke",
  "tlaplus_mcp_tlc_explore"
] as const;
export type ToolName = (typeof toolNames)[number];
export interface ToolInput {
  fileName: string;
  cfgFile?: string;
  extraOpts?: string[];
  extraJavaOpts?: string[];
  behaviorLength?: number;
}
export interface Execution {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  failed: boolean;
  behavior?: string;
  behaviorError?: string;
}

export const javaArguments = (
  name: ToolName,
  input: ToolInput,
  metadataDirectory: string
): string[] => {
  if (!path.isAbsolute(input.fileName)) {
    throw new Error("fileName must be an absolute path");
  }
  if (input.cfgFile !== undefined && !path.isAbsolute(input.cfgFile)) {
    throw new Error("cfgFile must be an absolute path");
  }
  if (
    input.behaviorLength !== undefined &&
    (!Number.isSafeInteger(input.behaviorLength) || input.behaviorLength < 1)
  ) {
    throw new Error("behaviorLength must be a positive integer");
  }
  if (name === "tlaplus_mcp_tlc_explore") {
    const reserved =
      /^(?<option>--?(?:simulate|modelcheck|workers|depth|metadir|cleanup|recover|help|h))(?:=|$)/u;
    for (const option of input.extraOpts ?? []) {
      if (reserved.test(option)) {
        throw new Error(`Explore owns this option: ${option}`);
      }
    }
  }
  const prefix = [
    ...(input.extraJavaOpts ?? []),
    `-Djava.io.tmpdir=${metadataDirectory}`,
    "-cp",
    jarPath
  ];
  if (name === "tlaplus_mcp_sany_parse") {
    return [...prefix, "tla2sany.SANY", input.fileName];
  }
  const options = ["-metadir", metadataDirectory, "-workers", "1"];
  if (input.cfgFile !== undefined) {
    options.push("-config", input.cfgFile);
  }
  if (name === "tlaplus_mcp_tlc_smoke" || name === "tlaplus_mcp_tlc_explore") {
    options.push(
      "-simulate",
      name === "tlaplus_mcp_tlc_explore"
        ? `num=1,file=${behaviorPrefix(metadataDirectory)}`
        : "num=1",
      "-depth",
      String(input.behaviorLength ?? 100)
    );
  }
  return [
    ...prefix,
    "tlc2.TLC",
    ...options,
    ...(input.extraOpts ?? []),
    path.basename(input.fileName)
  ];
};

export const executeJava = async (
  args: string[],
  cwd: string,
  signal: AbortSignal
): Promise<Execution> => {
  signal.throwIfAborted();

  const child = spawn("java", args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const limit = 2 * 1024 * 1024;
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let sanyError = false;
  let stdoutTail = "";
  let stderrTail = "";
  const detectDiagnostic = (data: string, tail: string): string => {
    const text = tail + data;
    sanyError ||=
      args.includes("tla2sany.SANY") &&
      /(?:Parse Error|Semantic errors|Fatal errors|\*{3} Errors:)/iu.test(text);
    return text.slice(-256);
  };
  let killTimer: NodeJS.Timeout | null = null;
  const stop = () => {
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2000);
    killTimer.unref();
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) {
    stop();
  }
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (data: string) => {
    stdoutTail = detectDiagnostic(data, stdoutTail);
    stdout += data;
    if (stdout.length > limit) {
      stdout = stdout.slice(0, limit);
      truncated = true;
    }
  });
  child.stderr.on("data", (data: string) => {
    stderrTail = detectDiagnostic(data, stderrTail);
    stderr += data;
    if (stderr.length > limit) {
      stderr = stderr.slice(0, limit);
      truncated = true;
    }
  });
  const cleanup = () => {
    signal.removeEventListener("abort", stop);
    if (killTimer !== null) {
      clearTimeout(killTimer);
    }
  };
  try {
    await once(child, "close");
    signal.throwIfAborted();
    return {
      exitCode: child.exitCode,
      signal: child.signalCode,
      stdout,
      stderr,
      truncated,
      failed: child.exitCode !== 0 || sanyError
    };
  } finally {
    cleanup();
  }
};

export const runTool = async (
  name: ToolName,
  input: ToolInput,
  signal: AbortSignal
): Promise<Execution> => {
  await access(jarPath);
  await access(input.fileName);
  if (input.cfgFile !== undefined) {
    await access(input.cfgFile);
  }
  const metadataDirectory = await mkdtemp(
    path.join(tmpdir(), "tlaplus-plugin-")
  );
  try {
    const args = javaArguments(name, input, metadataDirectory);
    const execution = await executeJava(
      args,
      path.dirname(input.fileName),
      AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    );
    if (name === "tlaplus_mcp_tlc_explore" && !execution.failed) {
      try {
        if (execution.truncated) {
          throw new Error("Explore output exceeds the response limit");
        }
        const behavior = await readBehavior(metadataDirectory);
        signal.throwIfAborted();
        return { ...execution, behavior };
      } catch (error) {
        signal.throwIfAborted();
        return {
          ...execution,
          failed: true,
          behaviorError: error instanceof Error ? error.message : String(error)
        };
      }
    }
    return execution;
  } finally {
    await rm(metadataDirectory, { recursive: true, force: true });
  }
};
