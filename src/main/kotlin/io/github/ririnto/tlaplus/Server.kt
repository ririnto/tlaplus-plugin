package io.github.ririnto.tlaplus

import io.modelcontextprotocol.json.jackson3.JacksonMcpJsonMapper
import io.modelcontextprotocol.server.McpServerFeatures.AsyncResourceSpecification
import io.modelcontextprotocol.server.McpServerFeatures.AsyncToolSpecification
import io.modelcontextprotocol.spec.McpSchema
import io.modelcontextprotocol.spec.McpSchema.ReadResourceResult
import io.modelcontextprotocol.spec.McpSchema.Resource
import io.modelcontextprotocol.spec.McpSchema.TextResourceContents
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import org.springframework.ai.mcp.annotation.provider.tool.AsyncMcpToolProvider
import org.springframework.ai.mcp.customizer.McpAsyncServerCustomizer
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import reactor.core.publisher.Mono
import kotlin.io.path.extension
import kotlin.io.path.isRegularFile
import kotlin.io.path.name
import tools.jackson.databind.json.JsonMapper

private val protocolOutput = System.out

@SpringBootApplication(proxyBeanMethods = false)
internal class Server {
    @Bean
    fun tools(tools: TlaTools): List<AsyncToolSpecification> {
        val annotated = AsyncMcpToolProvider(listOf(tools)).toolSpecifications.associateBy { it.tool().name() }
        return Tool.entries.map { tool ->
            val specification = annotated.getValue(tool.toolName)
            val declaration = McpSchema.Tool.builder(tool.toolName, tool.inputSchema())
                .description(specification.tool().description())
                .build()
            AsyncToolSpecification.builder().tool(declaration).callHandler(specification.callHandler()).build()
        }
    }

    @Bean
    fun knowledge(@Value("\${tlaplus.archive}") archive: Path): List<AsyncResourceSpecification> =
        Files.list(archive.resolveSibling("knowledgebase")).use { articles ->
            articles.filter { it.isRegularFile(NOFOLLOW_LINKS) && it.extension == "md" }.sorted().map { article ->
                val uri = "tlaplus://knowledge/${article.name}"
                val mime = "text/markdown"
                val resource = Resource.builder(uri, article.name).mimeType(mime).build()
                AsyncResourceSpecification(resource) { _, _ ->
                    Mono.fromCallable {
                        val content = TextResourceContents.builder(uri, Files.readString(article)).mimeType(mime).build()
                        ReadResourceResult.builder(listOf(content)).build()
                    }
                }
            }.toList()
        }

    @Bean
    fun stdio(@Qualifier("mcpServerJsonMapper") mapper: JsonMapper) = ContractStdio(JacksonMcpJsonMapper(mapper), protocolOutput)

    @Bean
    fun validation() = McpAsyncServerCustomizer { it.validateToolInputs(false) }
}

fun main() {
    System.setOut(System.err)
    runApplication<Server>("--spring.config.location=classpath:/application.properties")
}
