# TLA+ plugin

Run SANY and TLC from an MCP client without opening an editor.
The npm package includes a native Spring AI stdio server with the official TLA+ tools and the TLA+ knowledge base from the VS Code extension.

## Use the package

Install Node.js 24 or later.
Install `@tlaplus-mcp/tlaplus-mcp` to get the latest release from npm.
The package pulls the native server binary for the current platform through `optionalDependencies`.

Supported platforms

- Linux x64 and ARM64 with glibc (`-gnu`) or musl (`-musl`).
- macOS x64 and ARM64.
- Windows x64.

Linux x64 and ARM64 each have separate glibc and musl packages.
On Alpine, npm selects the platform package with the `-musl` suffix.
The native package CI tests the glibc packages on Ubuntu 26.04 for x64 and Ubuntu 24.04 for ARM64.
Older glibc systems must provide the interpreter, versioned symbols, and shared libraries recorded by those jobs.
The musl jobs build and test both architectures on Alpine 3.24.

Windows ARM64 (`win32-arm64`) is unsupported because Liberica Native Image Kit for JDK 25 is unavailable for that target.
Add it to the release matrices only after a native ARM64 build passes the same Java-free consumer tests as the other platforms.

```sh
npm install @tlaplus-mcp/tlaplus-mcp
```

Run `tlaplus-mcp` when the executable is on `PATH`.
Otherwise, run `npm exec -- tlaplus-mcp` from the npm project that installed the package.

### Register the MCP server

Use these configurations when `tlaplus-mcp` is on the MCP client's `PATH`.
If it is absent, use `npx` as the command and `["-y", "@tlaplus-mcp/tlaplus-mcp"]` as the arguments.
That command uses the package installed in the current npm project or resolves the latest release.

Claude Code:

```sh
claude mcp add tlaplus -- tlaplus-mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.tlaplus]
command = "tlaplus-mcp"
```

Cursor, in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "tlaplus-mcp"
    }
  }
}
```

Use the same command and arguments in other stdio MCP clients.
In an npm project you can instead set `command` to `node` with `node_modules/@tlaplus-mcp/tlaplus-mcp/dist/server.mjs`, or run the platform binary directly from `node_modules/@tlaplus-mcp/tlaplus-mcp-<platform>/tlaplus-server`.
The executable includes the TLA+ standard modules and the knowledge base.
The server writes JSON-RPC to stdout and its own diagnostics to stderr.
Only run trusted specifications and worker options.

### Install the editor plugin from a checkout

The editor plugins run `tlaplus-mcp` when it is on `PATH`. If it is absent, they run `npx -y @tlaplus-mcp/tlaplus-mcp`.

From the checkout root, run the command for your editor.

```sh
claude --plugin-dir .
codex plugin marketplace add .
codex plugin add tlaplus-plugin@tlaplus-plugin
```

For Cursor, copy `.cursor-plugin/` and `mcp.json` into `~/.cursor/plugins/local/tlaplus-plugin/` and reload the window.

## Tools and references

| MCP tool | Operation |
| --- | --- |
| `tlaplus_mcp_sany_parse` | Parse a module and check its semantics. |
| `tlaplus_mcp_tlc_check` | Exhaustively check a model and its configured properties. |
| `tlaplus_mcp_tlc_smoke` | Run one bounded random simulation. |
| `tlaplus_mcp_tlc_explore` | Return one bounded behavior, including its initial state and ordered variable values. |

Pass an absolute `fileName`.
TLC tools also accept an absolute `cfgFile`, plus `extraOpts` and `extraJavaOpts` as arrays of individual arguments.
The `extraJavaOpts` field accepts native runtime options such as `-Xmx256m` and system properties such as `-Dkey=value`.
Explore accepts a positive `behaviorLength` and defaults to 100.

Use the [offline TLC Behavior Viewer](docs/behavior-viewer.md) to step through a saved explore result or TLC counterexample.
Requests support cancellation and have a two-minute execution limit.
Results include process status, diagnostics, and truncation information.

MCP clients can list and read the bundled Markdown articles at `tlaplus://knowledge/<filename>`, for example `tlaplus://knowledge/tlc-config-files.md`.

## Build a release

Build the tarball on the target platform with Git, Node.js 24 LTS, Liberica Native Image Kit for JDK 25, and Maven.
For a musl build, use Alpine on the target architecture and install the official Liberica NIK musl distribution.
The package workflow runs both musl builds in architecture-matched Alpine containers.
The Windows build uses x64 Visual Studio Build Tools 17.13.2 or later and the Windows 11 SDK.

```sh
pnpm install
npm pack
npm pack ./npm
npm test
```

Dependencies install with pnpm from the version catalog in `pnpm-workspace.yaml`.
Packing, the consumer test, and release staging use the npm CLI.

`npm pack` builds the main package.
`npm pack ./npm` builds the platform package from the `npm/` directory that the build creates.
`npm test` packs both tarballs, installs them in a temporary project with Java removed from the consumer's `PATH`, and checks the shipped stdio entry point with Kotest.
The consumer script explicitly selects `InstalledPackageIT` with Maven Surefire.
The regular Kotlin contract tests under `src/test/kotlin/` do not replace the installed-package check.

The build fetches the default branches of AgentSkills and vscode-tlaplus.
It downloads the TLA+ tools JAR from the official `v1.7.4` GitHub release and installs it as a local Maven dependency.
The server uses Spring AI 2.0.2 with Spring Boot 4.1.2.
Each tool call starts a worker process from the same executable to isolate TLA+ process state and terminate cancelled calls.
The tarball includes upstream licenses and works offline after installation.

`npm pack` runs the Kotlin contract tests before building the tarball.
The pull request and release workflows share one build, test, and upload procedure.
A release stamps the package version before the build and stages the resulting tested tarballs through npm trusted publishing.

Use `yyyy.MM.dd-seq` for the plugin version, for example `2026.11.28-1`.
Pad the UTC date fields and start each day's sequence at `1` without leading zeroes.
Use the same plugin version in the editor manifests and marketplace catalogs.
Start a release by pushing a Git tag with that version.
The publish workflow uses the TLA+ tools version and an unpadded, dot-separated date and sequence for the npm version, for example `1.7.4-2026.11.28.1`.
The Git tag and GitHub release use the plugin version.
The MCP server reports the package version in its initialize response.
Follow the [npm release procedure](docs/npm-release.md) to approve the seven native packages, approve the main package, move the consumer dist-tags, and create the GitHub Release.

[AgentSkills](https://github.com/tlaplus/AgentSkills) · [VS Code extension](https://github.com/tlaplus/vscode-tlaplus) · [TLA+ tools](https://github.com/tlaplus/tlaplus) · [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html)
