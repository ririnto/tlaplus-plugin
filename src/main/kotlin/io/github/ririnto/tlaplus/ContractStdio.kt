package io.github.ririnto.tlaplus

import io.modelcontextprotocol.json.McpJsonMapper
import io.modelcontextprotocol.json.TypeRef
import io.modelcontextprotocol.server.transport.StdioServerTransportProvider
import io.modelcontextprotocol.spec.McpSchema
import io.modelcontextprotocol.spec.McpSchema.InitializeResult
import io.modelcontextprotocol.spec.McpSchema.JSONRPCMessage
import io.modelcontextprotocol.spec.McpSchema.JSONRPCNotification
import io.modelcontextprotocol.spec.McpSchema.JSONRPCRequest
import io.modelcontextprotocol.spec.McpSchema.JSONRPCResponse
import io.modelcontextprotocol.spec.McpSchema.ListToolsResult
import io.modelcontextprotocol.spec.McpServerSession
import io.modelcontextprotocol.spec.McpServerTransport
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import reactor.core.publisher.Mono
import reactor.core.publisher.Sinks

private const val INVALID_FRAME = "notifications/tlaplus-ignored-frame"
private const val CANCELLED = "notifications/cancelled"
private const val TOOL_NOT_FOUND = "Tool not found: "
private const val MAX_FRAME_BYTES = 10 * 1024 * 1024

internal class ContractStdio(mapper: McpJsonMapper, output: OutputStream) :
    StdioServerTransportProvider(StdioJson(mapper), BoundedFrames(System.`in`), output) {
    override fun protocolVersions(): List<String> = listOf("2024-10-07") + super.protocolVersions()

    override fun setSessionFactory(factory: McpServerSession.Factory) {
        super.setSessionFactory { transport ->
            val compatible = ContractTransport(transport)
            CancellableSession(factory.create(compatible), compatible)
        }
    }
}

private class CancellableSession(
    private val session: McpServerSession,
    transport: McpServerTransport
) : McpServerSession(session.id, Duration.ZERO, transport, { Mono.empty() }, emptyMap(), emptyMap()) {
    private val pending = ConcurrentHashMap<Any, Sinks.Empty<Void>>()

    override fun handle(message: JSONRPCMessage): Mono<Void> = Mono.defer {
        when {
            message is JSONRPCNotification && message.method() == INVALID_FRAME -> Mono.empty()
            message is JSONRPCNotification && message.method() == CANCELLED -> {
                val id = (message.params() as? Map<*, *>)?.get("requestId")
                if (id != null) pending[id]?.tryEmitEmpty()
                Mono.empty()
            }
            message is JSONRPCRequest && message.method() == McpSchema.METHOD_TOOLS_CALL -> {
                val stop = Sinks.empty<Void>()
                val id = message.id()
                pending[id] = stop
                session.handle(message).takeUntilOther(stop.asMono()).doFinally { pending.remove(id, stop) }
            }
            else -> session.handle(message)
        }
    }

    override fun sendNotification(method: String, params: Any?): Mono<Void> =
        session.sendNotification(method, params)

    override fun closeGracefully(): Mono<Void> = Mono.defer {
        pending.values.forEach { it.tryEmitEmpty() }
        session.closeGracefully()
    }

    override fun close() {
        pending.values.forEach { it.tryEmitEmpty() }
        session.close()
    }
}

private class ContractTransport(private val transport: McpServerTransport) : McpServerTransport by transport {
    override fun close() = transport.close()

    override fun sendMessage(message: JSONRPCMessage): Mono<Void> {
        if (message !is JSONRPCResponse) return transport.sendMessage(message)

        val result = message.result()
        val error = message.error()
        val data = error?.data() as? String
        val compatible = when {
            result is InitializeResult -> JSONRPCResponse.result(message.id(), mapOf(
                "protocolVersion" to result.protocolVersion(),
                "capabilities" to mapOf(
                    "tools" to mapOf("listChanged" to result.capabilities().tools().listChanged()),
                    "resources" to mapOf("listChanged" to result.capabilities().resources().listChanged())
                ),
                "serverInfo" to result.serverInfo()
            ))
            result is ListToolsResult -> {
                val tools = result.tools().map { tool ->
                    buildMap {
                        put("name", tool.name())
                        put("description", tool.description())
                        put("inputSchema", tool.inputSchema())
                        put("execution", mapOf("taskSupport" to "forbidden"))
                        tool.title()?.let { put("title", it) }
                        tool.meta()?.takeIf { it.isNotEmpty() }?.let { put("_meta", it) }
                    }
                }
                JSONRPCResponse.result(message.id(), buildMap {
                    put("tools", tools)
                    result.nextCursor()?.let { put("nextCursor", it) }
                })
            }
            error?.code() == McpSchema.ErrorCodes.INVALID_PARAMS && data?.startsWith(TOOL_NOT_FOUND) == true ->
                JSONRPCResponse.result(message.id(), textResult("MCP error -32602: Tool ${data.removePrefix(TOOL_NOT_FOUND)} not found", true))
            else -> message
        }
        return transport.sendMessage(compatible)
    }
}

private class BoundedFrames(input: InputStream) : FilterInputStream(input) {
    private var bytesInFrame = 0

    override fun read(): Int = super.read().also { if (it >= 0) count(it) }

    override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
        val read = `in`.read(bytes, offset, length)
        for (index in 0 until read) count(bytes[offset + index].toInt())
        return read
    }

    private fun count(byte: Int) {
        if (++bytesInFrame > MAX_FRAME_BYTES) throw IOException("ReadBuffer exceeded maximum size of $MAX_FRAME_BYTES bytes")
        if (byte == '\n'.code) bytesInFrame = 0
    }
}

private class StdioJson(private val mapper: McpJsonMapper) : McpJsonMapper by mapper {
    override fun <T : Any?> readValue(content: String, type: TypeRef<T>): T {
        try {
            val value = mapper.readValue(content, type)
            if (value is Map<*, *> && value["jsonrpc"] == "2.0") {
                when {
                    value["method"] is String && value.containsKey("id") ->
                        mapper.convertValue(value, JSONRPCRequest::class.java)
                    value["method"] is String ->
                        mapper.convertValue(value, JSONRPCNotification::class.java)
                    value.containsKey("result") || value.containsKey("error") ->
                        mapper.convertValue(value, JSONRPCResponse::class.java)
                    else -> throw IllegalArgumentException("Invalid JSON-RPC message")
                }
                return value
            }
        } catch (_: IOException) {
        } catch (_: IllegalArgumentException) {
        }
        return mapper.readValue("""{"jsonrpc":"2.0","method":"$INVALID_FRAME"}""", type)
    }
}
