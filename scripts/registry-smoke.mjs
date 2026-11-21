import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers/promises";

const [version, tag, platform, registry = "https://registry.npmjs.org"] =
  process.argv.slice(2);
assert.match(version ?? "", /^\d+\.\d+\.\d+-\d+\.\d+\.\d+\.\d+$/u);
assert.equal(tag, `tlaplus-${version.split("-")[0]}`);
assert.match(platform ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)+$/u);

const packageName = "@tlaplus-mcp/tlaplus-mcp";
const nativeName = `tlaplus-mcp-${platform}`;
const registryUrl = new URL(registry);
assert.equal(registryUrl.username, "");
assert.equal(registryUrl.password, "");

/**
 * @param {unknown} value JSON object to validate.
 * @returns {Record<string, unknown>} Object fields.
 */
const object = (value) => {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
  return { ...value };
};

/**
 * @param {unknown} value JSON array to validate.
 * @returns {readonly unknown[]} Array items.
 */
const array = (value) => {
  assert.ok(Array.isArray(value));
  return value;
};

/** @param {number} deadline Last time to start a registry lookup, in milliseconds. */
const waitForRelease = async (deadline) => {
  const remaining = deadline - Date.now();
  assert.ok(
    remaining > 0,
    `Timed out waiting for ${tag} to resolve to ${version}`
  );
  const visibility = await Promise.all(
    [packageName, `@tlaplus-mcp/${nativeName}`].map(async (name) => {
      const response = await fetch(
        new URL(encodeURIComponent(name), registryUrl),
        {
          cache: "no-store",
          headers: { Accept: "application/vnd.npm.install-v1+json" },
          signal: AbortSignal.timeout(Math.min(remaining, 7000))
        }
      );
      if (response.status === 404) {
        return false;
      }
      assert.ok(
        response.ok,
        `Registry returned HTTP ${response.status} for ${name}`
      );
      const metadata = object(await response.json());
      if (object(metadata["dist-tags"])[tag] !== version) {
        return false;
      }
      const release = object(metadata.versions)[version];
      return (
        release !== undefined &&
        typeof object(object(release).dist).integrity === "string"
      );
    })
  );
  if (!visibility.every(Boolean)) {
    await setTimeout(Math.min(10_000, Math.max(0, deadline - Date.now())));
    await waitForRelease(deadline);
  }
};

await waitForRelease(Date.now() + 180_000);

const work = await mkdtemp(path.join(tmpdir(), "tlaplus-registry-"));
const nodeDirectory = path.dirname(process.execPath);
const npm = path.join(
  nodeDirectory,
  ...(process.platform === "win32" ? [] : ["..", "lib"]),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);
const userConfig = path.join(work, "user.npmrc");
const globalConfig = path.join(work, "global.npmrc");
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:path|java_home(?:_.*)?|jdk_home|jre_home|npm_config_.*|node_auth_token|npm_token|github_token|gh_token)$/iu.test(
          key
        )
    )
  ),
  PATH: nodeDirectory,
  npm_config_cache: path.join(work, "cache"),
  npm_config_globalconfig: globalConfig,
  npm_config_registry: registryUrl.href,
  npm_config_script_shell:
    process.platform === "win32" ? process.env.ComSpec : "/bin/sh",
  npm_config_userconfig: userConfig
};

try {
  await Promise.all([
    writeFile(globalConfig, ""),
    writeFile(userConfig, ""),
    writeFile(path.join(work, "package.json"), '{"private":true}\n')
  ]);
  const install = spawnSync(
    process.execPath,
    [
      npm,
      "install",
      "--prefer-online",
      "--fetch-retries=0",
      "--no-audit",
      "--no-fund",
      `${packageName}@${tag}`
    ],
    { cwd: work, env, stdio: "inherit", timeout: 90_000 }
  );
  if (install.error !== undefined) {
    throw install.error;
  }
  assert.equal(install.status, 0, "Public npm install failed");

  const scope = path.join(work, "node_modules", "@tlaplus-mcp");
  const installed = await readdir(scope);
  const packages = ["tlaplus-mcp", nativeName];
  assert.deepEqual(installed.toSorted(), packages);
  await Promise.all(
    packages.map(async (name) => {
      const manifest = await readFile(
        path.join(scope, name, "package.json"),
        "utf-8"
      );
      assert.equal(object(JSON.parse(manifest)).version, version, name);
    })
  );

  const child = spawn(
    process.execPath,
    [npm, "exec", "--offline", "--", "tlaplus-mcp"],
    {
      cwd: work,
      env,
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 45_000
    }
  );
  /** @type {Promise<unknown[]>} */
  const exited = once(child, "exit");
  /** @type {AsyncIterator<string, undefined, undefined>} */
  const responses = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  /** @param {Record<string, unknown>} message JSON-RPC message. */
  const send = (message) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  /**
   * @param {number} id JSON-RPC request ID.
   * @param {string} method MCP method to call.
   * @param {Record<string, unknown>} params Method parameters.
   * @returns {Promise<Record<string, unknown>>} JSON-RPC result.
   */
  const request = async (id, method, params) => {
    send({ id, method, params });
    const response = await responses.next();
    assert.equal(response.done, false, `MCP ended before ${method}`);
    const reply = object(JSON.parse(response.value));
    assert.equal(reply.id, id);
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    return object(reply.result);
  };
  try {
    const hello = await request(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "npm-registry-smoke", version: "1" }
    });
    assert.equal(object(hello.serverInfo).version, version);
    send({ method: "notifications/initialized" });
    const { tools } = await request(2, "tools/list", {});
    assert.deepEqual(
      array(tools)
        .map((tool) => {
          const { name } = object(tool);
          assert.ok(typeof name === "string");
          return name;
        })
        .toSorted(),
      [
        "tlaplus_mcp_sany_parse",
        "tlaplus_mcp_tlc_check",
        "tlaplus_mcp_tlc_explore",
        "tlaplus_mcp_tlc_smoke"
      ]
    );
    const uri = "tlaplus://knowledge/tlc-config-files.md";
    const { contents } = await request(3, "resources/read", { uri });
    const [first] = array(contents);
    const article = object(first);
    assert.equal(article.uri, uri);
    assert.equal(
      article.text,
      await readFile(
        path.join(
          scope,
          "tlaplus-mcp",
          "dist",
          "knowledgebase",
          "tlc-config-files.md"
        ),
        "utf-8"
      )
    );
  } finally {
    child.stdin.end();
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(code, 0);
  }
  console.log(
    `Registry install and MCP passed for ${platform}, ${tag} → ${version}`
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
