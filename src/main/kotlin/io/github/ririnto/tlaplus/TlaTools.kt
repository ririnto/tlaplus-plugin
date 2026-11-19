package io.github.ririnto.tlaplus

import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.stereotype.Component
import reactor.core.publisher.Mono
import tools.jackson.databind.json.JsonMapper

@Component
internal class TlaTools(private val runner: TlaRunner) {
    private val json = JsonMapper.shared()

    @McpTool(name = SANY_NAME, description = "Parse and semantically analyze a TLA+ module with SANY.")
    fun sany(request: CallToolRequest): Mono<CallToolResult> = execute(Tool.SANY, request)

    @McpTool(name = CHECK_NAME, description = "Model-check a TLA+ module with TLC.")
    fun check(request: CallToolRequest): Mono<CallToolResult> = execute(Tool.CHECK, request)

    @McpTool(name = SMOKE_NAME, description = "Run one bounded random TLC simulation trace (100 steps by default).")
    fun smoke(request: CallToolRequest): Mono<CallToolResult> = execute(Tool.SMOKE, request)

    @McpTool(
        name = EXPLORE_NAME,
        description = "Return one bounded random TLC behavior with ordered states and variable values, including the initial state."
    )
    fun explore(request: CallToolRequest): Mono<CallToolResult> = execute(Tool.EXPLORE, request)

    private fun execute(tool: Tool, request: CallToolRequest): Mono<CallToolResult> =
        Mono.defer { runner.run(tool, tool.input(request.arguments().orEmpty())) }
            .map { result -> textResult(json.writeValueAsString(result.payload()), result.failed) }
            .onErrorResume(Exception::class.java) { Mono.just(textResult(it.message ?: it.toString(), true)) }
}

internal fun textResult(text: String, failed: Boolean): CallToolResult =
    CallToolResult.builder().content(listOf(TextContent.builder(text).build())).isError(failed).build()
