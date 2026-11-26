package io.github.ririnto.tlaplus

import io.modelcontextprotocol.json.jackson3.JacksonMcpJsonMapper
import io.modelcontextprotocol.server.McpServerFeatures.SyncResourceSpecification
import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification
import io.modelcontextprotocol.spec.McpSchema
import io.modelcontextprotocol.spec.McpSchema.ReadResourceResult
import io.modelcontextprotocol.spec.McpSchema.Resource
import io.modelcontextprotocol.spec.McpSchema.TextResourceContents
import org.springframework.ai.mcp.customizer.McpSyncServerCustomizer
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import tools.jackson.databind.json.JsonMapper

private val protocolOutput = System.out
private const val VIEWER_URI = "ui://tlaplus/behavior-viewer"
private const val VIEWER_TITLE = "TLC Behavior Viewer"
private const val VIEWER_MIME = "text/html;profile=mcp-app"

@SpringBootApplication(proxyBeanMethods = false)
internal class Server {
    @Bean
    fun tools(tools: TlaTools): List<SyncToolSpecification> = buildList {
        for (tool in Tool.entries) {
            val declaration = McpSchema.Tool.builder(tool.toolName, tool.inputSchema())
                .description(tool.description)
                .build()
            add(SyncToolSpecification.builder().tool(declaration).callHandler { _, request ->
                tools.execute(tool, request)
            }.build())
        }
        if (viewerEnabled()) {
            val entrypoint = McpSchema.Tool.builder(
                "tlaplus_mcp_behavior_viewer",
                mapOf("type" to "object", "properties" to emptyMap<String, Any>(), "additionalProperties" to false)
            ).title(VIEWER_TITLE).description("Open a blank TLC behavior viewer in this thread.")
                .meta(mapOf(
                    "ui" to mapOf("resourceUri" to VIEWER_URI, "visibility" to listOf("app")),
                    "openai/ui" to mapOf("entrypoints" to listOf(mapOf("type" to "thread")))
                )).build()
            add(SyncToolSpecification.builder().tool(entrypoint).callHandler { _, request ->
                if (request.arguments().orEmpty().isEmpty()) {
                    McpSchema.CallToolResult.builder().content(emptyList()).isError(false).build()
                } else {
                    textResult("Open the TLC behavior viewer without arguments.", true)
                }
            }.build())
        }
    }

    @Bean
    fun knowledge(): List<SyncResourceSpecification> =
        knowledgeText("index.txt").lineSequence().filter(String::isNotEmpty).map { name ->
            val uri = "tlaplus://knowledge/$name"
            val mime = "text/markdown"
            val resource = Resource.builder(uri, name).mimeType(mime).build()
            SyncResourceSpecification(resource) { _, _ ->
                val content = TextResourceContents.builder(uri, knowledgeText(name)).mimeType(mime).build()
                ReadResourceResult.builder(listOf(content)).build()
            }
        }.toList()

    @Bean
    fun viewerResources(): List<SyncResourceSpecification> {
        if (!viewerEnabled()) {
            return emptyList()
        }
        val resource = Resource.builder(VIEWER_URI, VIEWER_TITLE).mimeType(VIEWER_MIME).build()
        return listOf(SyncResourceSpecification(resource) { _, _ ->
            val html = viewerPage().bufferedReader(Charsets.UTF_8).use { it.readText() }
                .replace("</body>", "<script>connectViewer();</script></body>")
            val content = TextResourceContents.builder(VIEWER_URI, html).mimeType(VIEWER_MIME).build()
            ReadResourceResult.builder(listOf(content)).build()
        })
    }

    @Bean
    fun stdio(@Qualifier("mcpServerJsonMapper") mapper: JsonMapper) = ContractStdio(JacksonMcpJsonMapper(mapper), protocolOutput)

    @Bean
    fun validation() = McpSyncServerCustomizer { it.validateToolInputs(false) }
}

private fun knowledgeText(name: String): String =
    checkNotNull(Server::class.java.getResourceAsStream("/knowledgebase/$name")) { "Missing knowledge article: $name" }
        .bufferedReader(Charsets.UTF_8).use { it.readText() }

private fun viewerEnabled() = System.getenv("TLAPLUS_BEHAVIOR_VIEWER") == "1"

private fun viewerPage() = checkNotNull(Server::class.java.getResourceAsStream("/viewer/behavior.html"))

fun main(args: Array<String>) {
    if (args.firstOrNull() == WORKER_MODE) {
        TlaWorker.run(args.drop(1))
        return
    }
    if (args.contentEquals(arrayOf("--behavior-viewer"))) {
        viewerPage().use { it.copyTo(protocolOutput) }
        return
    }
    System.setOut(System.err)
    System.setProperty("reactor.schedulers.defaultBoundedElasticOnVirtualThreads", "true")
    runApplication<Server>("--spring.config.location=classpath:/application.properties")
}
