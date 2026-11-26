# Inspect a TLC behavior

## Open the viewer offline

From a checkout, open [`src/main/resources/viewer/behavior.html`](../src/main/resources/viewer/behavior.html) as a local file in your browser.
In an npm project with a native package that includes the viewer, use the executable in `node_modules/@tlaplus-mcp/tlaplus-mcp-<platform>/`.
Replace `<platform>` with the suffix of the installed platform package.
Use `tlaplus-server.exe` on Windows and `tlaplus-server` on other platforms.

For example, on macOS ARM64, run:

```sh
node_modules/@tlaplus-mcp/tlaplus-mcp-darwin-arm64/tlaplus-server --behavior-viewer > behavior.html
```

Open the exported `behavior.html` as a local file in your browser.
The `tlaplus-mcp` npm command starts the MCP server and does not forward the viewer flag.

## Load a saved TLC result

1. Run `tlaplus_mcp_tlc_explore` with the absolute path to your model and, if needed, its configuration.
   Set `behaviorLength` to the desired bound.
   To inspect a counterexample, run `tlaplus_mcp_tlc_check` with `extraOpts` set to `["-tool"]`.
2. Save the JSON text from the tool response's `content[0].text` as a `.json` file.
   Save the JSON object itself, without the surrounding MCP response.
3. Choose the file in the viewer.
   Use **Previous**, **Next**, or the **State** field to inspect a state and compare its variables with the preceding state.

A sampled behavior is one bounded simulation.
A counterexample contains a trace for a violation TLC found during model checking.
For diagnostic failures, use the original tool response to see TLC's messages.
The viewer displays variable names and values as TLC printed them.
It leaves out file names, source locations, and log text from the response metadata.

Each browser tab keeps its own result in memory.
Use **Clear** or close the tab to discard it.

## Open the viewer in an MCP host

Set `TLAPLUS_BEHAVIOR_VIEWER=1` in the server process environment to expose the viewer as a [thread entrypoint](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#thread-entrypoint).
In a host that supports thread entrypoints, open **TLC Behavior Viewer** in the current thread.
The tab starts empty and accepts the same saved JSON files.
Run TLC separately by selecting the model and configuration in the TLC tool.

When the host supports sharing text with the thread, **Share selected state** sends the visible state number and its variable values.
Opening the tab, loading a file, and stepping through states leave the thread context untouched.
The host manages any state you already shared when you clear or close the viewer.
