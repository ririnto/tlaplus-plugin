# TLA+ plugin

Run SANY and TLC from an MCP client without opening an editor.
The npm package includes a native Spring AI stdio server with the official TLA+ tools and the TLA+ knowledge base from the VS Code extension.

## Use the package

Install Node.js 24 or later.
Install `@tlaplus-mcp/tlaplus-mcp` using the dist-tag for your TLA+ tools version, such as `tlaplus-1.7.4`, or specify an exact npm version.
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
npm install @tlaplus-mcp/tlaplus-mcp@tlaplus-1.7.4
npm exec -- tlaplus-mcp
```

`npx -y @tlaplus-mcp/tlaplus-mcp@tlaplus-1.7.4` starts the server without a local install.

### Register the MCP server

Every command below runs the npm release, so the host fetches the package from the registry at startup.

Claude Code:

```sh
claude mcp add tlaplus -- npx -y @tlaplus-mcp/tlaplus-mcp@tlaplus-1.7.4
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.tlaplus]
command = "npx"
args = ["-y", "@tlaplus-mcp/tlaplus-mcp@tlaplus-1.7.4"]
```

Cursor, in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "npx",
      "args": ["-y", "@tlaplus-mcp/tlaplus-mcp@tlaplus-1.7.4"]
    }
  }
}
```

For a general MCP client, set `command` to `npx` with the arguments `-y @tlaplus-mcp/tlaplus-mcp@tlaplus-1.7.4`.
In an npm project you can instead set `command` to `node` with `node_modules/@tlaplus-mcp/tlaplus-mcp/dist/server.mjs`, or run the platform binary directly from `node_modules/@tlaplus-mcp/tlaplus-mcp-<platform>/tlaplus-server`.
The executable includes the TLA+ standard modules and the knowledge base.
The server writes JSON-RPC to stdout and its own diagnostics to stderr.
Only run trusted specifications and worker options.

### Install the editor plugin from a checkout

Use a Git checkout for the editor manifests and modeling skills.
Follow the build prerequisites below, then run `pnpm install` and `npm run build` in the checkout to prepare the skills.
The editor manifests launch the npm MCP package.

From the checkout root, run the command for your editor.

```sh
claude --plugin-dir .
codex plugin marketplace add .
codex plugin add tlaplus-plugin@tlaplus-plugin
```

For Cursor, copy the `.cursor-plugin/` and generated `skills/` directories into `~/.cursor/plugins/local/tlaplus-plugin/` and reload the window.

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

The editor plugin skills cover adding a variable, splitting an action, and deriving a specification from source code. MCP clients can list and read the bundled Markdown articles at `tlaplus://knowledge/<filename>`, for example `tlaplus://knowledge/tlc-config-files.md`.

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

The build fetches the default branches of AgentSkills and vscode-tlaplus.
It downloads the TLA+ tools JAR from the official `v1.7.4` GitHub release and installs it as a local Maven dependency.
The server uses Spring AI 2.0.2 with Spring Boot 4.1.2.
Each tool call starts a worker process from the same executable to isolate TLA+ process state and terminate cancelled calls.
The tarball includes upstream licenses and works offline after installation.

`npm pack` runs the Kotlin contract tests before building the tarball.
The pull request and release workflows share one build, test, and upload procedure.
A release stamps the package version before the build and stages the resulting tested tarballs through npm trusted publishing.

Version the plugin by UTC build date and a two-digit build number, for example `2026.11.20.01`.
Start a release by pushing a Git tag with the plugin version, for example `2026.11.20.01`.
The publish workflow prepends the TLA+ tools version and removes leading zeroes from numeric date and build fields to produce the npm version, for example `1.7.4-2026.11.20.1`.
The Git tag and GitHub release retain the original CalVer spelling.
The MCP server reports the package version in its initialize response.
Follow the [npm release procedure](docs/npm-release.md) to approve the seven native packages, approve the main package, move the consumer dist-tags, and create the GitHub Release.

[AgentSkills](https://github.com/tlaplus/AgentSkills) · [VS Code extension](https://github.com/tlaplus/vscode-tlaplus) · [TLA+ tools](https://github.com/tlaplus/tlaplus) · [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html)
