# TLA+ plugin

Run SANY and TLC from an MCP client without opening an editor.
The npm package includes a native Spring AI stdio server with the official TLA+ tools, modeling skills, and the TLA+ knowledge base from the VS Code extension.

## Use the package

Install Node.js 24 or later.
Install `@tlaplus-mcp/tlaplus-mcp` from the npm registry.
The package pulls the native server binary for the current platform through `optionalDependencies`, so Linux x64, Linux ARM64, macOS ARM64, and Windows x64 all install with one command.

```sh
npm install @tlaplus-mcp/tlaplus-mcp
npm exec -- tlaplus-mcp
```

`npx -y @tlaplus-mcp/tlaplus-mcp` starts the server without a local install.

### Register the MCP server

Every command below runs the npm release, so the host fetches the package from the registry at startup.

Claude Code:

```sh
claude mcp add tlaplus -- npx -y @tlaplus-mcp/tlaplus-mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.tlaplus]
command = "npx"
args = ["-y", "@tlaplus-mcp/tlaplus-mcp"]
```

Cursor, in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "npx",
      "args": ["-y", "@tlaplus-mcp/tlaplus-mcp"]
    }
  }
}
```

For a general MCP client, set `command` to `npx` with the arguments `-y @tlaplus-mcp/tlaplus-mcp`.
In an npm project you can instead set `command` to `node` with `node_modules/@tlaplus-mcp/tlaplus-mcp/dist/server.mjs`, or run the platform binary directly from `node_modules/@tlaplus-mcp/tlaplus-mcp-<platform>/tlaplus-server`.
The executable includes the TLA+ standard modules and the knowledge base.
The server writes JSON-RPC to stdout and its own diagnostics to stderr.
Only run trusted specifications and worker options.

### Install the plugin

Claude Code, Codex, and Cursor manifests are included and start the npm release.
Point your host at the installed package directory. For example, from the npm project:

```sh
claude --plugin-dir ./node_modules/@tlaplus-mcp/tlaplus-mcp
codex plugin marketplace add ./node_modules/@tlaplus-mcp/tlaplus-mcp
codex plugin add tlaplus-plugin@tlaplus-plugin
```

For Cursor, copy the manifest directories into `~/.cursor/plugins/local/tlaplus-plugin/` and reload the window. If you use a Git checkout directly, build it first.

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
Requests support cancellation and have a two-minute execution limit.
Results include process status, diagnostics, and truncation information.

The bundled skills cover adding a variable, splitting an action, and deriving a specification from source code. MCP clients can list and read the bundled Markdown articles at `tlaplus://knowledge/<filename>`, for example `tlaplus://knowledge/tlc-config-files.md`.

## Build a release

Build the tarball on the target platform with Git, Node.js 24 LTS, GraalVM Community for JDK 25, and Maven.
The Windows build uses x64 Visual Studio Build Tools 17.13.2 or later and the Windows 11 SDK.

```sh
pnpm install
npm pack
npm pack ./npm
npm test
```

Dependencies install with pnpm from the version catalog in `pnpm-workspace.yaml`.
Packing, the consumer test, and registry publishing stay on the npm command because trusted publishing authenticates through the npm CLI.

`npm pack` builds the main package.
`npm pack ./npm` builds the platform package from the `npm/` directory that the build creates.
`npm test` packs both tarballs, installs them in a temporary project with Java removed from the consumer's `PATH`, and checks the shipped stdio entry point with Kotest.

The build fetches the default branches of AgentSkills and vscode-tlaplus.
It downloads the TLA+ tools JAR from the official `v1.7.4` GitHub release and installs it as a local Maven dependency.
The server uses Spring AI 2.0.2 with Spring Boot 4.1.2.
Each tool call starts a worker process from the same executable to isolate TLA+ process state and terminate cancelled calls.
The tarball includes upstream licenses and works offline after installation.

`npm pack` runs the Kotlin contract tests before building the tarball.
GitHub Actions builds, tests, and publishes the main package plus one platform package per target platform through trusted publishing.

Version the plugin by UTC build date and a two-digit build number, for example `2026.11.20.01`.
Publish a release by pushing a Git tag with the plugin version, for example `2026.11.20.01`.
The publish workflow derives the package version from the tag by prepending the TLA+ tools version, for example `1.7.4-2026.11.20.01`, and stamps `package.json`, the editor plugin manifests, and the platform packages with it.
npm cleans the prerelease identifiers when it packs and publishes, so the build number loses its leading zero in the registry while the tag and the GitHub release keep it.
The MCP server reports the package version in its initialize response.
The workflow publishes the main package and the four platform packages to npm on the `latest` dist-tag, then creates a GitHub release named after the tag that carries the exact tarballs published to npm.

[AgentSkills](https://github.com/tlaplus/AgentSkills) · [VS Code extension](https://github.com/tlaplus/vscode-tlaplus) · [TLA+ tools](https://github.com/tlaplus/tlaplus) · [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html)
