package io.github.ririnto.tlaplus

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import java.nio.file.Files
import kotlin.io.path.Path

class ToolContractTest : FunSpec({
    val file = Path("a model", "Model.tla").toAbsolutePath().toString()
    val input = mapOf("fileName" to file)

    test("only explore accepts the declared positive safe integer depth") {
        Tool.EXPLORE.input(input + ("behaviorLength" to 7.0)).depth shouldBe 7L
        Tool.SMOKE.input(input + ("behaviorLength" to 7)).depth shouldBe 100L
        Tool.EXPLORE.input(input).depth shouldBe 100L
        shouldThrow<IllegalArgumentException> {
            Tool.EXPLORE.input(input + ("behaviorLength" to 9007199254740992L))
        }.message shouldBe "MCP error -32602: Input validation error: Invalid arguments for tool tlaplus_mcp_tlc_explore: " +
            "Too big: expected int to be <=9007199254740991 at behaviorLength"
    }

    test("validation preserves the errors for missing, relative and invalid inputs") {
        shouldThrow<IllegalArgumentException> {
            Tool.SANY.input(emptyMap())
        }.message shouldBe "MCP error -32602: Input validation error: Invalid arguments for tool tlaplus_mcp_sany_parse: " +
            "Invalid input: expected string, received undefined at fileName"
        shouldThrow<IllegalArgumentException> {
            Tool.CHECK.input(mapOf("fileName" to "Counter.tla", "extraOpts" to listOf(0, false)))
        }.message shouldBe "MCP error -32602: Input validation error: Invalid arguments for tool tlaplus_mcp_tlc_check: " +
            "Must be an absolute path at fileName\nInvalid input: expected string, received number at extraOpts[0]\n" +
            "Invalid input: expected string, received boolean at extraOpts[1]"
    }

    test("SANY strips TLC-only and unknown input properties") {
        val parsed = Tool.SANY.input(input + mapOf("cfgFile" to null, "extraJavaOpts" to listOf("-invalid")))
        parsed.file.toString() shouldBe file
        parsed.config shouldBe null
        parsed.javaOptions shouldBe emptyList()
    }

    test("a trace must be a bounded nonempty regular file") {
        val directory = Files.createTempDirectory("trace-test-")
        try {
            val trace = directory.resolve("behavior_0_0")
            createTrace(directory).use { owned ->
                shouldThrow<IllegalStateException> { readBehavior(owned) }
                Files.writeString(trace, "STATE_1 == x = 0\n")
                readBehavior(owned) shouldBe "STATE_1 == x = 0\n"
                Files.write(trace, ByteArray(2 * 1024 * 1024 + 1))
                shouldThrow<IllegalStateException> { readBehavior(owned) }
            }
            Files.delete(trace)
            Files.createDirectory(trace)
            shouldThrow<java.io.IOException> { createTrace(directory) }
            Files.delete(trace)
            if (System.getProperty("os.name") == "Linux") {
                createTrace(directory).use { owned ->
                    Files.writeString(trace, "STATE_1 == x = 0\n")
                    val moved = Files.move(trace, directory.resolve("original"))
                    Files.createSymbolicLink(trace, Files.writeString(directory.resolve("target"), "not the trace"))
                    readBehavior(owned) shouldBe "STATE_1 == x = 0\n"
                    shouldThrow<java.io.IOException> { createTrace(directory) }
                    Files.delete(moved)
                }
            }
        } finally {
            directory.toFile().deleteRecursively()
        }
    }
})
