package io.github.ririnto.tlaplus

import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper

@Component
internal class TlaTools(private val runner: TlaRunner) {
    private val json = JsonMapper.shared()

    fun execute(tool: Tool, request: CallToolRequest): CallToolResult = try {
        val result = runner.run(tool, tool.input(request.arguments().orEmpty()))
        textResult(json.writeValueAsString(result.payload()), result.failed)
    } catch (error: Exception) {
        textResult(error.message ?: error.toString(), true)
    }
}

internal fun textResult(text: String, failed: Boolean): CallToolResult =
    CallToolResult.builder().content(listOf(TextContent.builder(text).build())).isError(failed).build()
