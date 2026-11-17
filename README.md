# TLA+ plugin

A Node 24 stdio MCP server for SANY and TLC, packaged with official TLA+ AgentSkills.
Java must be available on `PATH`.
Only run specifications and JVM options you trust: this server executes local Java processes with your account's permissions.

## Status

Initial implementation candidate, not yet published.
Real-jar integration, dependency installation, full lint/type checks, and package contents must pass before publication.

## Tools

| Tool | Purpose |
| --- | --- |
| `tlaplus_mcp_sany_parse` | Syntax and semantic analysis |
| `tlaplus_mcp_tlc_check` | Exhaustive TLC model checking |
| `tlaplus_mcp_tlc_smoke` | One random simulation trace, 100 steps by default |
| `tlaplus_mcp_tlc_explore` | One random simulation trace with `behaviorLength` steps |

Every tool requires an absolute `fileName`.
The TLC tools accept an optional absolute `cfgFile`, `extraOpts` and `extraJavaOpts`.
The option fields are arrays of individual arguments, not shell command strings.
`behaviorLength` is an optional positive integer, defaulting to 100.
Tool names and parameter names follow the draft `tlaplus/tlaplus#1296` Java prototype; no dependency on that unmerged implementation is required.

Results report process exit code, signal, stdout, stderr, failure and truncation status.
SANY diagnostics are checked as well as its process status.
Each request has a two-minute deadline and supports MCP cancellation.
Output is limited to two million characters per stream.
Temporary TLC metadata is removed after each call.
Additional TLC options can change output behavior and write files; the server is not a sandbox.

## Build and validate

```sh
pnpm install
pnpm build
pnpm check
pnpm check:integration
pnpm check:pack
pnpm check:consumer
```

`pnpm build` compiles `.mts` sources to executable `dist/*.mjs` and downloads packaging assets.
`pnpm pack` invokes the same build through `prepack` and resolves catalog versions into the package manifest.
Do not publish the source manifest directly with npm; publish the verified tarball.
No downloads occur at server startup.
`pnpm check:pack` creates the tarball with pnpm, rejects unresolved catalog/workspace dependency protocols, and runs `npm pack <tarball> --dry-run --json` to verify its files.
`pnpm check:consumer` installs that tarball with npm in an isolated temporary project and verifies MCP startup, tool discovery, and SANY with production dependencies only.
The integration suite uses the MCP stdio client to invoke all four tools, including successful and failing SANY examples.

The build downloads `tla2tools.jar` from TLA+ release v1.7.4, verifies the published SHA1 `bee4a54f3ee3d4afc347c3240ec2d9e93b075104`, and executes a SANY semantic-analysis probe to verify `tla2sany.SANY`.
It downloads the `tlaplus/AgentSkills` main archive and copies these skills unchanged with a separate upstream MIT LICENSE in each directory:

- `tlaplus-add-variable`
- `tlaplus-split-action`
- `tlaplus-from-source`

`vendor/`, `skills/`, and `dist/` are ignored by Git but included in the npm package.
The package includes this project's MIT LICENSE, the TLA+ MIT license under `vendor/`, and the AgentSkills MIT license in every copied skill.
Failed downloads or checksum/probe failures abort the build.

## General MCP clients

After publication:

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "npx",
      "args": ["--yes", "@ririnto/tlaplus-plugin@1.7.4"]
    }
  }
}
```

For a local built checkout, use `node` with the absolute path to `dist/server.mjs` instead.

## Codex

```toml
[mcp_servers.tlaplus]
command = "npx"
args = ["--yes", "@ririnto/tlaplus-plugin@1.7.4"]
```

## Claude Code

Build the checkout before loading it:

```sh
pnpm install
pnpm build
claude --plugin-dir /absolute/path/to/tlaplus-plugin
```

The plugin manifest loads `skills/` and starts `dist/server.mjs` through stdio.
A raw Git checkout does not contain the downloaded skills or jar until built.
The npm tarball includes them; extract it, install its runtime dependencies, and point `--plugin-dir` at its `package/` directory:

```sh
npm install --omit=dev --ignore-scripts --prefix /absolute/path/to/package
claude --plugin-dir /absolute/path/to/package
```

## Versioning

The initial npm version and `package.json`'s `tla2tools` field are `1.7.4`.
Package-only revisions increment PATCH (`1.7.5`, `1.7.6`, and so on) while retaining the jar version field.
When upgrading the jar, align the package version with the new jar version.
A four-component `1.7.4.x` version is not npm semver.

## Publishing

Keep the GitHub repository private during preparation.
Review the PR and validation evidence, approve publication, then make the repository public and publish:

```sh
npm publish ./ririnto-tlaplus-plugin-1.7.4.tgz --access public
```

Publication is a separate approved step; no script publishes automatically.
