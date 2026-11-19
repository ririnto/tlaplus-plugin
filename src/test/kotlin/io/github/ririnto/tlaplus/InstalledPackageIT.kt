package io.github.ririnto.tlaplus

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption.COPY_ATTRIBUTES
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.io.path.Path
import kotlin.io.path.absolutePathString
import kotlin.io.path.readText
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

private val json = JsonMapper.builder().build()
private const val SANY = "tlaplus_mcp_sany_parse"
private const val CHECK = "tlaplus_mcp_tlc_check"
private const val SMOKE = "tlaplus_mcp_tlc_smoke"
private const val EXPLORE = "tlaplus_mcp_tlc_explore"
private val outputFields = setOf("exitCode", "signal", "stdout", "stderr", "truncated", "failed")
private val depth = Regex("(?m)^\"TLAPLUS_DEPTH=(\\d+)\"$")
private val state = Regex("(?m)^STATE_(\\d+) == ")
private val value = Regex("(?m)^x = (\\d+)$")

class InstalledPackageIT : FunSpec({
    test("the installed npm command initializes and advertises the original tool schemas and knowledge") {
        withClient(Launch.NPM) { client, _ ->
            val tools = client.call("tools/list").path("tools")
            val expected = javaClass.getResourceAsStream("/contract/tools.json")!!.use { json.readTree(it) }
            tools shouldBe expected

            val uri = "tlaplus://knowledge/tlc-config-files.md"
            val resources = client.call("resources/list").path("resources")
            resources.any { it.path("uri").asString() == uri } shouldBe true
            val article = client.call("resources/read", mapOf("uri" to uri)).path("contents").get(0)
            article.path("uri").asString() shouldBe uri
            article.path("mimeType").asString() shouldBe "text/markdown"
            val knowledge = client.consumer.resolve("node_modules/@ririnto/tlaplus-plugin/dist/knowledgebase")
            article.path("text").asString() shouldBe knowledge.resolve("tlc-config-files.md").readText()
            Files.exists(knowledge.resolveSibling("runtimes")) shouldBe false
        }
    }

    test("the extracted executable starts alone and serves embedded content") {
        withClient(Launch.STANDALONE) { client, _ ->
            val tools = client.call("tools/list").path("tools")
            val expected = javaClass.getResourceAsStream("/contract/tools.json")!!.use { json.readTree(it) }
            tools shouldBe expected
            val uri = "tlaplus://knowledge/tlc-config-files.md"
            val article = client.call("resources/read", mapOf("uri" to uri)).path("contents").get(0)
            article.path("text").asString().isNotBlank() shouldBe true
            val parse = client.tool(SANY, mapOf("fileName" to Path("examples/Counter.tla").absolutePathString()))
            ("Semantic processing of module Counter" in success(parse).path("stdout").asString()) shouldBe true
        }
    }

    test("the oldest supported MCP version remains available and inbound frames have a byte limit") {
        withClient(protocolVersion = "2024-10-07") { client, _ ->
            client.writeRaw("\n{incomplete\n")
            client.call("ping").isObject shouldBe true
            client.expectOversizedFrameToClose()
        }
    }

    test("all four tools execute through stdio with their original success and error payloads") {
        withClient { client, directory ->
            val moduleDirectory = Files.createDirectory(directory.resolve("model with spaces"))
            val counter = Files.copy(Path("examples/Counter.tla"), moduleDirectory.resolve("Counter.tla"))
            val config = Files.copy(Path("examples/Counter.cfg"), moduleDirectory.resolve("Counter.cfg"))
            val options = mapOf("fileName" to counter.absolutePathString(), "cfgFile" to config.absolutePathString())
            val parse = client.startTool(SANY, options + ("extraJavaOpts" to listOf("-invalid")))
            val check = client.startTool(CHECK, options + ("extraJavaOpts" to listOf("-Xmx256m")))
            val smoke = client.startTool(SMOKE, options)
            val explore = client.startTool(EXPLORE, options + ("behaviorLength" to 5))
            ("Semantic processing of module Counter" in success(client.result(parse)).path("stdout").asString()) shouldBe true
            ("states generated" in success(client.result(check)).path("stdout").asString()) shouldBe true
            ("Running Random Simulation" in success(client.result(smoke)).path("stdout").asString()) shouldBe true
            success(client.result(explore), hasBehavior = true).path("behavior").asString().contains("STATE_1 == ") shouldBe true
            val callbackThreads = Regex("MCP tool (\\S+) virtualThread=(true|false)")
                .findAll(client.diagnostics()).map { it.groupValues[1] to it.groupValues[2] }.toList()
            callbackThreads.sortedBy { it.first } shouldBe listOf(SANY, CHECK, SMOKE, EXPLORE).sorted().map { it to "true" }
            println("Native MCP callbacks ran on virtual threads: ${callbackThreads.map { it.first }.sorted().joinToString()}")

            val broken = client.tool(SANY, mapOf("fileName" to Path("examples/Broken.tla").absolutePathString()))
            val sanyFailure = execution(broken, failed = true)
            sanyFailure.path("stdout").asString().contains("Parse Error") shouldBe true
            execution(client.tool(SANY, mapOf("fileName" to counter.root.toString())), failed = true)
            if (isWindows) {
                success(client.tool(SANY, mapOf("fileName" to counter.toString().drop(2))))
            }

            errorText(client.tool(SANY, mapOf("fileName" to "Counter.tla"))) shouldBe
                "MCP error -32602: Input validation error: Invalid arguments for tool $SANY: Must be an absolute path at fileName"
            val missing = directory.resolve("Missing.tla").absolutePathString()
            errorText(client.tool(CHECK, options + ("fileName" to missing))) shouldBe
                "ENOENT: no such file or directory, access '$missing'"
            errorText(client.tool("tlc_check", options)) shouldBe "MCP error -32602: Tool tlc_check not found"

            val wrongJvmOption = client.tool(CHECK, options + ("extraJavaOpts" to listOf("-not-a-real-jvm-option")))
            val jvmFailure = execution(wrongJvmOption, failed = true)
            jvmFailure.path("exitCode").asInt() shouldBe 1
            jvmFailure.path("stderr").asString().contains("Unrecognized option") shouldBe true

            for (option in listOf("simulate", "modelcheck", "workers", "depth", "metadir", "cleanup", "recover", "help", "h")) {
                for (spelling in listOf("-$option", "-$option=2", "--$option")) {
                    errorText(client.tool(EXPLORE, options + ("extraOpts" to listOf(spelling)))) shouldBe
                        "Explore owns this option: $spelling"
                }
            }
        }
    }

    test("explore returns initial and ordered states, and TLC preserves genuine transition depth") {
        withClient { client, directory ->
            val model = Files.writeString(directory.resolve("Finite.tla"), """
                ---- MODULE Finite ----
                EXTENDS Naturals
                VARIABLE x
                Init == x = 0
                Next == x' = (x + 1) % 3
                NeverTwo == x # 2
                ====
            """.trimIndent() + "\n")
            val config = Files.writeString(directory.resolve("Finite.cfg"), "INIT Init\nNEXT Next\n")
            val invalid = Files.writeString(directory.resolve("Invalid.cfg"), "INIT Init\nNEXT Next\nINVARIANT NeverTwo\n")
            val options = mapOf("fileName" to model.absolutePathString(), "cfgFile" to config.absolutePathString())

            val traces = listOf(3, 7).associateWith { requested ->
                client.startTool(EXPLORE, options + ("behaviorLength" to requested))
            }
            for ((requested, id) in traces) {
                val behavior = success(client.result(id), hasBehavior = true).path("behavior").asString()
                state.findAll(behavior).map { it.groupValues[1].toInt() }.toList() shouldBe (1..requested).toList()
                value.findAll(behavior).map { it.groupValues[1].toInt() }.toList() shouldBe List(requested) { it % 3 }
            }
            val failed = execution(client.tool(EXPLORE, options + mapOf(
                "behaviorLength" to 7, "cfgFile" to invalid.absolutePathString()
            )), failed = true)
            (failed.path("exitCode").asInt() != 0) shouldBe true
            ("Invariant NeverTwo is violated" in failed.path("stdout").asString()) shouldBe true
            failed.has("behavior") shouldBe false

            val probe = mapOf(
                "fileName" to Path("tests/fixtures/DepthProbe.tla").absolutePathString(),
                "cfgFile" to Path("tests/fixtures/DepthProbe.cfg").absolutePathString()
            )
            val transitions = success(client.tool(SMOKE, probe)).path("stdout").asString()
            depth.findAll(transitions).map { it.groupValues[1].toInt() }.toList() shouldBe (1..100).toList()
        }
    }

    test("oversized traces and stdout fail without a partial behavior") {
        withClient { client, directory ->
            val file = directory.resolve("Large.tla")
            val config = Files.writeString(directory.resolve("Large.cfg"), "INIT Init\nNEXT Next\n")
            val source = """
                ---- MODULE Large ----
                EXTENDS TLC
                VARIABLE x
                Init == x = "${"a".repeat(2_100_000)}"
                Next == UNCHANGED x
                ====
            """.trimIndent() + "\n"
            val options = mapOf(
                "fileName" to file.absolutePathString(), "cfgFile" to config.absolutePathString(), "behaviorLength" to 1
            )
            Files.writeString(file, source)
            val overTrace = execution(client.tool(EXPLORE, options), failed = true)
            overTrace.path("exitCode").asInt() shouldBe 0
            overTrace.path("truncated").asBoolean() shouldBe false
            overTrace.has("behavior") shouldBe false
            ("2 MiB" in overTrace.path("behaviorError").asString()) shouldBe true

            Files.writeString(file, source.replace("Next == UNCHANGED x", "Next == PrintT(x) /\\ UNCHANGED x"))
            val overOutput = execution(client.tool(EXPLORE, options), failed = true)
            overOutput.path("exitCode").asInt() shouldBe 0
            overOutput.path("truncated").asBoolean() shouldBe true
            overOutput.has("behavior") shouldBe false
            overOutput.path("behaviorError").asString() shouldBe "Explore output exceeds the response limit"
            client.requestDirectories().isEmpty() shouldBe true
        }
    }

    test("cancelling in-flight TLC cleans up its worker and keeps the connection usable") {
        withClient { client, _ ->
            val probe = mapOf(
                "fileName" to Path("tests/fixtures/DepthProbe.tla").absolutePathString(),
                "cfgFile" to Path("tests/fixtures/DepthProbe.cfg").absolutePathString(),
                "behaviorLength" to 1_000_000
            )
            val id = client.startTool(EXPLORE, probe)
            val concurrent = client.startTool(SANY, probe)
            awaitCondition("TLC extracts a module before cancellation") {
                client.requestDirectories().any { Files.exists(it.resolve("Naturals.tla")) }
            }
            client.notify("notifications/cancelled", mapOf("requestId" to id, "reason" to "test cancellation"))
            awaitCondition("TLC removes its work directory after cancellation") { client.requestDirectories().isEmpty() }
            success(client.result(concurrent))
            success(client.tool(SANY, probe))
            client.sawResponse(id) shouldBe false
        }
    }

    test("closing stdin terminates active TLC and removes its files") {
        withClient { client, _ ->
            val probe = mapOf(
                "fileName" to Path("tests/fixtures/DepthProbe.tla").absolutePathString(),
                "cfgFile" to Path("tests/fixtures/DepthProbe.cfg").absolutePathString(),
                "behaviorLength" to 1_000_000
            )
            client.startTool(EXPLORE, probe)
            awaitCondition("TLC begins before the client disconnects") {
                client.requestDirectories().any { Files.exists(it.resolve("Naturals.tla")) }
            }
            client.disconnect()
            client.requestDirectories().isEmpty() shouldBe true
        }
    }
})

private fun errorText(result: JsonNode): String {
    result.path("isError").asBoolean() shouldBe true
    return text(result)
}

private fun text(result: JsonNode): String {
    result.path("content").size() shouldBe 1
    val content = result.path("content").get(0)
    content.path("type").asString() shouldBe "text"
    return content.path("text").asString()
}

private fun execution(result: JsonNode, failed: Boolean): JsonNode {
    result.path("isError").asBoolean() shouldBe failed
    val execution = json.readTree(text(result))
    execution.path("failed").asBoolean() shouldBe failed
    execution.path("signal").isNull shouldBe true
    return execution
}

private fun success(result: JsonNode, hasBehavior: Boolean = false): JsonNode {
    val execution = execution(result, failed = false)
    execution.path("exitCode").asInt() shouldBe 0
    execution.path("truncated").asBoolean() shouldBe false
    execution.path("stdout").isString shouldBe true
    execution.path("stderr").isString shouldBe true
    execution.propertyNames().toSet() shouldBe if (hasBehavior) outputFields + "behavior" else outputFields
    return execution
}

private enum class Launch { NPM, WRAPPER, STANDALONE }

private fun withClient(
    launch: Launch = Launch.WRAPPER,
    protocolVersion: String = "2025-11-25",
    action: (WireClient, Path) -> Unit
) {
    val root = Files.createTempDirectory("tlaplus-wire-")
    try {
        WireClient(root, launch).use { client ->
            client.initialize(protocolVersion)
            action(client, root)
        }
    } finally {
        root.toFile().deleteRecursively()
    }
}

private fun awaitCondition(description: String, test: () -> Boolean) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
    while (!test()) {
        check(System.nanoTime() < deadline) { description }
        Thread.sleep(20)
    }
}

private class WireClient(root: Path, launch: Launch) : AutoCloseable {
    val consumer = Path(checkNotNull(System.getProperty("consumer.directory")))
    private val stderr = root.resolve("stderr")
    private val runtime = Files.createDirectory(root.resolve("runtime"))
    private val events = LinkedBlockingQueue<Result<JsonNode>>()
    private val backlog = mutableMapOf<String, JsonNode>()
    private val process: Process
    private val reader: Thread
    private val writer: java.io.BufferedWriter
    private var sequence = 0

    init {
        val node = checkNotNull(System.getProperty("consumer.node"))
        val dist = consumer.resolve("node_modules/@ririnto/tlaplus-plugin/dist")
        val command = when (launch) {
            Launch.NPM -> listOf(node, checkNotNull(System.getProperty("consumer.npm")), "exec", "--offline", "--", "tlaplus-plugin")
            Launch.WRAPPER -> listOf(node, dist.resolve("server.mjs").toString())
            Launch.STANDALONE -> {
                val name = if (isWindows) "tlaplus-server.exe" else "tlaplus-server"
                val binary = Files.copy(dist.resolve(name), root.resolve(name), COPY_ATTRIBUTES)
                listOf(binary.toString(), "-Djava.io.tmpdir=$runtime")
            }
        }
        val cwd = if (launch == Launch.STANDALONE) root else consumer
        val builder = ProcessBuilder(command).directory(cwd.toFile()).redirectError(stderr.toFile())
        val environment = builder.environment()
        environment.keys.removeIf { key ->
            key.equals("PATH", ignoreCase = true) || key.startsWith("JAVA_HOME", ignoreCase = true) ||
                key.equals("JDK_HOME", ignoreCase = true) || key.equals("JRE_HOME", ignoreCase = true)
        }
        environment["PATH"] = (if (launch == Launch.STANDALONE) runtime else Path(node).parent).toString()
        if (launch == Launch.NPM && !isWindows) environment["npm_config_script_shell"] = "/bin/sh"
        for (name in listOf("TMPDIR", "TEMP", "TMP")) builder.environment()[name] = runtime.toString()
        builder.environment()["SPRING_MAIN_BANNER_MODE"] = "console"
        builder.environment()["LOGGING_LEVEL_IO_GITHUB_RIRINTO_TLAPLUS"] = "DEBUG"
        process = builder.start()
        writer = process.outputWriter(Charsets.UTF_8)
        reader = Thread.startVirtualThread {
            try {
                process.inputReader(Charsets.UTF_8).useLines { lines ->
                    lines.forEach { line ->
                        val frame = json.readTree(line)
                        check(frame.path("jsonrpc").asString() == "2.0") { "Non-JSON-RPC stdout line: $line" }
                        events.add(Result.success(frame))
                    }
                }
            } catch (error: Exception) {
                events.add(Result.failure(error))
            }
        }
    }

    fun initialize(protocolVersion: String) {
        val initialized = call("initialize", mapOf(
            "protocolVersion" to protocolVersion, "capabilities" to emptyMap<String, Any>(),
            "clientInfo" to mapOf("name" to "installed-package-test", "version" to "1.0.0")
        ))
        initialized.path("protocolVersion").asString() shouldBe protocolVersion
        initialized.path("serverInfo").path("name").asString() shouldBe "tlaplus-plugin"
        initialized.path("serverInfo").path("version").asString() shouldBe System.getProperty("consumer.version")
        initialized.path("capabilities") shouldBe json.readTree("""{"tools":{"listChanged":true},"resources":{"listChanged":true}}""")
        notify("notifications/initialized", emptyMap())
    }

    fun requestDirectories(): List<Path> = Files.list(runtime).use { paths ->
        paths.filter { it.fileName.toString().startsWith("tlaplus-plugin-") }.toList()
    }

    fun diagnostics(): String = stderr.readText()

    fun startTool(tool: String, arguments: Map<String, Any?>): String =
        send("tools/call", mapOf("name" to tool, "arguments" to arguments))

    fun tool(tool: String, arguments: Map<String, Any?>): JsonNode = result(startTool(tool, arguments))

    fun call(method: String, params: Map<String, Any?> = emptyMap()): JsonNode = result(send(method, params))

    fun notify(method: String, params: Map<String, Any?>) {
        write(mapOf("jsonrpc" to "2.0", "method" to method, "params" to params))
    }

    private fun send(method: String, params: Map<String, Any?>): String {
        val id = "client-${++sequence}"
        write(mapOf("jsonrpc" to "2.0", "id" to id, "method" to method, "params" to params))
        return id
    }

    private fun write(frame: Map<String, Any?>) {
        writeRaw(json.writeValueAsString(frame) + "\n")
    }

    fun writeRaw(text: String) {
        writer.write(text)
        writer.flush()
    }

    fun result(id: String): JsonNode {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(35)
        while (!backlog.containsKey(id)) {
            val remaining = deadline - System.nanoTime()
            val event = if (remaining > 0) events.poll(remaining, TimeUnit.NANOSECONDS) else null
            checkNotNull(event) { "No response for $id. Server diagnostics: ${stderr.readText()}" }
            collect(event.getOrThrow())
        }
        val frame = backlog.remove(id)!!
        check(!frame.has("error")) { "Unexpected error response: $frame" }
        return frame.path("result")
    }

    fun sawResponse(id: String): Boolean {
        while (true) collect((events.poll() ?: break).getOrThrow())
        return id in backlog
    }

    private fun collect(frame: JsonNode) {
        if (frame.has("id")) backlog[frame.path("id").asString()] = frame
    }

    fun expectOversizedFrameToClose() {
        try {
            send("ping", mapOf("padding" to "é".repeat(5 * 1024 * 1024)))
        } catch (_: java.io.IOException) {
            check(!process.isAlive || process.waitFor(15, TimeUnit.SECONDS))
        }
        check(process.waitFor(15, TimeUnit.SECONDS)) { "Server accepted an oversized stdin frame" }
        process.exitValue() shouldBe 0
    }

    fun disconnect() {
        if (process.isAlive) writer.close()
        check(process.waitFor(15, TimeUnit.SECONDS)) { "Server stayed alive after stdin closed. Server diagnostics: ${stderr.readText()}" }
        process.exitValue() shouldBe 0
    }

    override fun close() {
        try {
            disconnect()
        } finally {
            if (process.isAlive) process.destroyForcibly().waitFor()
            reader.join()
            while (true) (events.poll() ?: break).getOrThrow()
        }
    }
}
