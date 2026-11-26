# Inspect a TLC behavior

Open the [TLC Behavior Viewer](../src/main/resources/viewer/behavior.html) in a browser from your checkout.
If you have the native executable, you can write the same page to a file and open it locally.

```sh
./tlaplus-server --behavior-viewer > behavior.html
```

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
