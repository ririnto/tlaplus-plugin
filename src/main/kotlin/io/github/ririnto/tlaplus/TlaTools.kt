package io.github.ririnto.tlaplus

import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.springframework.stereotype.Component
import reactor.core.publisher.Mono
import tools.jackson.databind.json.JsonMapper

@Component
internal class TlaTools(private val runner: TlaRunner) {
    private val json = JsonMapper.shared()

    fun execute(tool: Tool, request: CallToolRequest): Mono<CallToolResult> =
        Mono.defer { runner.run(tool, tool.input(request.arguments().orEmpty())) }
            .map { result -> textResult(json.writeValueAsString(result.payload()), result.failed) }
            .onErrorResume(Exception::class.java) { Mono.just(textResult(it.message ?: it.toString(), true)) }
}

internal fun textResult(text: String, failed: Boolean): CallToolResult =
    CallToolResult.builder().content(listOf(TextContent.builder(text).build())).isError(failed).build()
