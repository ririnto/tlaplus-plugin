# TLA+ plugin

Run SANY and TLC from an MCP client without opening an editor. The npm package includes the stdio server, the official TLA+ tools JAR, GraalVM Community runtimes, three modeling skills, and the TLA+ knowledge base from the VS Code extension.

## Use the package

Install Node.js 24 or later. Linux x64 and arm64 (glibc), macOS on Apple silicon, and Windows x64 use the bundled runtime. Other platforms can use Java 11 or later on PATH. Install the release tarball in your project, then start the server with `npm exec -- tlaplus-plugin`. After registry publication, the package name is `@ririnto/tlaplus-plugin`.

```sh
npm install /path/to/ririnto-tlaplus-plugin-2026.11.19+02.tgz
npm exec -- tlaplus-plugin
```

For a general MCP client, set `command` to `node` and pass the absolute path to `node_modules/@ririnto/tlaplus-plugin/dist/server.mjs` as its only argument. The server communicates over stdio and uses the JAR shipped with the package. Only run trusted specifications and JVM options.

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

Build the universal tarball on Linux x64 with Git, Node.js 24+, npm, curl, GNU tar, and unzip.

```sh
npm install
npm pack
npm test
```

The build fetches the default branches of AgentSkills and vscode-tlaplus, downloads the TLA+ 1.7.4 release JAR, and uses GraalVM Community’s `jlink` to build a runtime for each platform. The tarball includes the upstream licenses and JavaScript dependency notices. Once installed, the tools and knowledge base work offline.

Native plugin manifests use `yyyy.MM.dd.seq`. The npm package uses the SemVer form `yyyy.MM.dd+seq`. npm compares versions without build metadata, so changing only `seq` does not give a second publishable registry version for the same date.

[AgentSkills](https://github.com/tlaplus/AgentSkills) · [VS Code extension](https://github.com/tlaplus/vscode-tlaplus) · [TLA+ tools](https://github.com/tlaplus/tlaplus) · [GraalVM Community](https://github.com/graalvm/graalvm-ce-builds)
