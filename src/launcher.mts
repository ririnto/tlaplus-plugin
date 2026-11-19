#!/usr/bin/env node

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const executable = process.platform === "win32" ? "tlaplus-server.exe" : "tlaplus-server";
const server = spawn(fileURLToPath(new URL(executable, import.meta.url)), [
  `-Djava.io.tmpdir=${tmpdir()}`
], { stdio: "inherit" });

const signalNames = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const forward = (signal: NodeJS.Signals) => server.kill(signal);
for (const signal of signalNames) {
  process.on(signal, forward);
}

server.once("error", (error) => {
  console.error(`Cannot start the TLA+ server for ${process.platform}/${process.arch}. ${error.message}`);
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
