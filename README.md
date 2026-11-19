# TLA+ plugin

Run SANY and TLC from an MCP client without opening an editor.
The npm package includes a Spring AI stdio server with the official TLA+ tools, modeling skills, and the TLA+ knowledge base from the VS Code extension.

## Use the package

Install Node.js 24 or later and Java 21 or later for your platform.
The package uses the Java installation at `JAVA_HOME`, or `java` on `PATH` when `JAVA_HOME` is unset.
Install the release tarball in your project, then start the server with `npm exec -- tlaplus-plugin`.
After registry publication, the package name is `@ririnto/tlaplus-plugin`.

```sh
npm install /path/to/ririnto-tlaplus-plugin-2026.11.19+02.tgz
npm exec -- tlaplus-plugin
```

For a general MCP client, set `command` to `node` and pass the absolute path to `node_modules/@ririnto/tlaplus-plugin/dist/server.mjs` as its only argument.
The server writes JSON-RPC to stdout and its own diagnostics to stderr.
Only run trusted specifications and JVM options.

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

Pass an absolute `fileName`. TLC tools also accept an absolute `cfgFile`, plus `extraOpts` and `extraJavaOpts` as arrays of individual arguments. Explore accepts a positive `behaviorLength` and defaults to 100. Requests support cancellation and have a two-minute Java execution limit. Results include process status, diagnostics and truncation information.

The bundled skills cover adding a variable, splitting an action, and deriving a specification from source code. MCP clients can list and read the bundled Markdown articles at `tlaplus://knowledge/<filename>`, for example `tlaplus://knowledge/tlc-config-files.md`.

## Build a release

Build the tarball with Git, Node.js 24 or later, a Java 21 or later JDK, and Maven 3.9 or later.

```sh
npm install
npm pack
npm test -- ./ririnto-tlaplus-plugin-2026.11.19+02.tgz
```

The build fetches the default branches of AgentSkills and vscode-tlaplus.
It checks the SHA-256 of the upstream TLA+ 1.7.4 release JAR before installing it as a local Maven dependency.
The server uses Spring AI 2.0.2 with Spring Boot 4.1.2.
Each tool call uses a separate JVM to isolate TLA+ process state and terminate cancelled calls.
The tarball includes upstream licenses and works offline after installation.

`npm pack` runs the Kotlin contract tests before building the tarball.
`npm test` installs the tarball in a temporary project and checks the shipped stdio entry point with Kotest.
GitHub Actions runs the consumer checks on Linux x64 and arm64, macOS on Apple silicon, and Windows x64.

Native plugin manifests use `yyyy.MM.dd.seq`. The npm package uses the SemVer form `yyyy.MM.dd+seq`. npm compares versions without build metadata, so changing only `seq` does not give a second publishable registry version for the same date.

[AgentSkills](https://github.com/tlaplus/AgentSkills) · [VS Code extension](https://github.com/tlaplus/vscode-tlaplus) · [TLA+ tools](https://github.com/tlaplus/tlaplus) · [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html)
