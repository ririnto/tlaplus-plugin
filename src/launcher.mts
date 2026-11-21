#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const executable =
  process.platform === "win32" ? "tlaplus-server.exe" : "tlaplus-server";
const platform = `${process.platform}-${process.arch}`;
const localServer = fileURLToPath(
  new URL(executable, new URL("../native/", import.meta.url))
);

let serverPath: string;
try {
  serverPath = createRequire(import.meta.url).resolve(
    `@ririnto/tlaplus-${platform}/${executable}`
  );
} catch {
  serverPath = localServer;
}

const server = spawn(serverPath, [`-Djava.io.tmpdir=${tmpdir()}`], {
  stdio: "inherit"
});

const signalNames = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const forward = (signal: NodeJS.Signals) => {
  server.kill(signal);
};
for (const name of signalNames) {
  process.on(name, forward);
}

server.once("error", (error) => {
  console.error(
    `Cannot start the TLA+ server for ${platform}. ` +
      `Install @ririnto/tlaplus-${platform} or build it with npm run build. ${error.message}`
  );
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
