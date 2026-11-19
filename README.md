# TLA+ plugin

Run SANY and TLC from an MCP client without opening an editor.
The npm package includes a native Spring AI stdio server with the official TLA+ tools, modeling skills, and the TLA+ knowledge base from the VS Code extension.

## Use the package

Install Node.js 24 or later to use the npm command.
Choose the tarball for Linux x64, Linux ARM64, macOS ARM64, or Windows x64 and install it in your project.
Start the server with `npm exec -- tlaplus-plugin`.
After registry publication, the package name is `@ririnto/tlaplus-plugin`.

```sh
npm install /path/to/ririnto-tlaplus-plugin-1.7.4-2026.11.19.1.tgz
npm exec -- tlaplus-plugin
```

For a general MCP client, set `command` to `node` and pass the absolute path to `node_modules/@ririnto/tlaplus-plugin/dist/server.mjs` as its only argument.
You can also use `dist/tlaplus-server` directly as the command, or `dist/tlaplus-server.exe` on Windows.
The executable includes the TLA+ standard modules and the knowledge base.
The server writes JSON-RPC to stdout and its own diagnostics to stderr.
Only run trusted specifications and worker options.

Claude Code, Codex, and Cursor manifests are included. Point your host at the installed package directory or the extracted tarball. For example, from the npm project:

```sh
claude --plugin-dir ./node_modules/@ririnto/tlaplus-plugin
codex plugin marketplace add ./node_modules/@ririnto/tlaplus-plugin
codex plugin add tlaplus-plugin@tlaplus-plugin
```

For Cursor, extract the tarball's `package/` contents into `~/.cursor/plugins/local/tlaplus-plugin/` and reload the window. If you use a Git checkout directly, build it first.

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
npm install
npm pack
npm test -- ./ririnto-tlaplus-plugin-1.7.4-2026.11.19.1.tgz
```

The build fetches the default branches of AgentSkills and vscode-tlaplus.
It checks the SHA-256 of the upstream TLA+ 1.7.4 release JAR before installing it as a local Maven dependency.
The server uses Spring AI 2.0.2 with Spring Boot 4.1.2.
Each tool call starts a worker process from the same executable to isolate TLA+ process state and terminate cancelled calls.
The tarball includes upstream licenses and works offline after installation.

`npm pack` runs the Kotlin contract tests before building the tarball.
`npm test` installs the tarball in a temporary project with Java removed from the consumer's `PATH` and checks the shipped stdio entry point with Kotest.
GitHub Actions builds and tests a separate tarball on each target platform.

Set the release version in `package.json` using the TLA+ tools version, UTC build date, and build number, for example `1.7.4-2026.11.19.1`.
Write the date and build number as numeric prerelease identifiers without leading zeros.
The MCP server reports the same version in its initialize response.
Editor plugin manifests use `yyyy.MM.dd.seq`.

[AgentSkills](https://github.com/tlaplus/AgentSkills) · [VS Code extension](https://github.com/tlaplus/vscode-tlaplus) · [TLA+ tools](https://github.com/tlaplus/tlaplus) · [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html)
