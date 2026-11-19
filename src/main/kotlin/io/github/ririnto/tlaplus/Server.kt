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

@SpringBootApplication(proxyBeanMethods = false)
internal class Server {
    @Bean
    fun tools(tools: TlaTools): List<SyncToolSpecification> =
        Tool.entries.map { tool ->
            val declaration = McpSchema.Tool.builder(tool.toolName, tool.inputSchema())
                .description(tool.description)
                .build()
            SyncToolSpecification.builder().tool(declaration).callHandler { _, request ->
                tools.execute(tool, request)
            }.build()
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
    fun stdio(@Qualifier("mcpServerJsonMapper") mapper: JsonMapper) = ContractStdio(JacksonMcpJsonMapper(mapper), protocolOutput)

    @Bean
    fun validation() = McpSyncServerCustomizer { it.validateToolInputs(false) }
}

private fun knowledgeText(name: String): String =
    checkNotNull(Server::class.java.getResourceAsStream("/knowledgebase/$name")) { "Missing knowledge article: $name" }
        .bufferedReader(Charsets.UTF_8).use { it.readText() }

fun main(args: Array<String>) {
    if (args.firstOrNull() == WORKER_MODE) {
        TlaWorker.run(args.drop(1))
        return
    }
    System.setOut(System.err)
    System.setProperty("reactor.schedulers.defaultBoundedElasticOnVirtualThreads", "true")
    runApplication<Server>("--spring.config.location=classpath:/application.properties")
}
