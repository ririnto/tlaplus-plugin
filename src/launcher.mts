#!/usr/bin/env node

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

declare const TLA_PLUGIN_VERSION: string;

const archive = fileURLToPath(new URL("tlaplus-server.jar", import.meta.url));
const executable = process.platform === "win32" ? "java.exe" : "java";
const java = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, "bin", executable)
  : executable;
const server = spawn(java, [
  `-Djava.io.tmpdir=${tmpdir()}`,
  `-Dtlaplus.archive=${archive}`,
  `-Dtlaplus.version=${TLA_PLUGIN_VERSION}`,
  "-jar", archive
], { stdio: "inherit" });

const signalNames = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const forward = (signal: NodeJS.Signals) => server.kill(signal);
for (const signal of signalNames) {
  process.on(signal, forward);
}

server.once("error", (error) => {
  console.error(`Cannot start Java. Install Java 21 or later and set JAVA_HOME or PATH. ${error.message}`);
});
server.once("close", (code, signal) => {
  for (const name of signalNames) {
    process.removeListener(name, forward);
  }
  if (signal !== null && process.platform !== "win32") {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
