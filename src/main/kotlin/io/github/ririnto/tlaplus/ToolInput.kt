package io.github.ririnto.tlaplus

import java.math.BigDecimal
import java.nio.file.InvalidPathException
import java.nio.file.Path
import kotlin.io.path.Path

internal const val SANY_NAME = "tlaplus_mcp_sany_parse"
internal const val CHECK_NAME = "tlaplus_mcp_tlc_check"
internal const val SMOKE_NAME = "tlaplus_mcp_tlc_smoke"
internal const val EXPLORE_NAME = "tlaplus_mcp_tlc_explore"
private const val MAX_SAFE_INTEGER = 9007199254740991L
internal val isWindows = System.getProperty("os.name").startsWith("Windows")

internal enum class Tool(val toolName: String, val description: String) {
    SANY(SANY_NAME, "Parse and semantically analyze a TLA+ module with SANY."),
    CHECK(CHECK_NAME, "Model-check a TLA+ module with TLC."),
    SMOKE(SMOKE_NAME, "Run one bounded random TLC simulation trace (100 steps by default)."),
    EXPLORE(EXPLORE_NAME,
        "Return one bounded random TLC behavior with ordered states and variable values, including the initial state.");

    fun inputSchema(): Map<String, Any> {
        val string = mapOf("type" to "string")
        val strings = mapOf("type" to "array", "items" to string)
        val properties = buildMap {
            put("fileName", string)
            if (this@Tool != SANY) {
                put("cfgFile", string)
                put("extraOpts", strings)
                put("extraJavaOpts", strings)
            }
            if (this@Tool == EXPLORE) {
                put("behaviorLength", mapOf("type" to "integer", "exclusiveMinimum" to 0, "maximum" to MAX_SAFE_INTEGER))
            }
        }
        return mapOf(
            "type" to "object",
            "properties" to properties,
            "required" to listOf("fileName"),
            "\$schema" to "http://json-schema.org/draft-07/schema#"
        )
    }

    fun input(arguments: Map<String, Any?>): ToolInput {
        val reader = Arguments(arguments)
        val file = reader.path("fileName", required = true)
        val config = if (this == SANY) null else reader.path("cfgFile")
        val options = if (this == SANY) emptyList() else reader.strings("extraOpts")
        val javaOptions = if (this == SANY) emptyList() else reader.strings("extraJavaOpts")
        val depth = if (this == EXPLORE) reader.depth() else 100L
        require(reader.errors.isEmpty()) {
            "MCP error -32602: Input validation error: Invalid arguments for tool $toolName: " +
                reader.errors.joinToString("\n")
        }
        return ToolInput(checkNotNull(file), config, options, javaOptions, depth)
    }
}

internal data class ToolInput(
    val file: Path,
    val config: Path?,
    val options: List<String>,
    val javaOptions: List<String>,
    val depth: Long
)

private class Arguments(private val values: Map<String, Any?>) {
    val errors = mutableListOf<String>()

    fun path(key: String, required: Boolean = false): Path? {
        if (!required && key !in values) return null
        val text = values[key]
        if (text !is String) {
            invalidType("string", key, text, key in values)
            return null
        }
        val path = try {
            val path = Path(text)
            if (isWindows && path.root != null && !path.isAbsolute && path.root.toString() == "\\") {
                path.toAbsolutePath()
            } else {
                path
            }
        } catch (_: InvalidPathException) {
            null
        }
        if (path?.isAbsolute != true) {
            errors += "Must be an absolute path at $key"
            return null
        }
        return path
    }

    fun strings(key: String): List<String> {
        if (key !in values) return emptyList()
        val list = values[key]
        if (list !is List<*>) {
            invalidType("array", key, list)
            return emptyList()
        }
        return list.mapIndexedNotNull { index, item ->
            if (item is String) item else {
                invalidType("string", "$key[$index]", item)
                null
            }
        }
    }

    fun depth(): Long {
        val key = "behaviorLength"
        if (key !in values) return 100
        val input = values[key]
        if (input !is Number) {
            invalidType("number", key, input)
            return 100
        }
        val value = BigDecimal(input.toString()).stripTrailingZeros()
        when {
            value.scale() > 0 -> errors += "Invalid input: expected int, received number at $key"
            value > BigDecimal.valueOf(MAX_SAFE_INTEGER) -> errors += "Too big: expected int to be <=$MAX_SAFE_INTEGER at $key"
            value < BigDecimal.valueOf(-MAX_SAFE_INTEGER) -> errors += "Too small: expected int to be >=${-MAX_SAFE_INTEGER} at $key"
            value.signum() <= 0 -> errors += "Too small: expected number to be >0 at $key"
            else -> return value.toLong()
        }
        return 100
    }

    private fun invalidType(expected: String, key: String, value: Any?, present: Boolean = true) {
        val actual = when (value) {
            null -> if (present) "null" else "undefined"
            is String -> "string"
            is Number -> "number"
            is Boolean -> "boolean"
            is List<*> -> "array"
            else -> "object"
        }
        errors += "Invalid input: expected $expected, received $actual at $key"
    }
}
