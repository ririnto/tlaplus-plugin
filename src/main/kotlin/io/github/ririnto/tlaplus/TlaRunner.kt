package io.github.ririnto.tlaplus

import jakarta.annotation.PreDestroy
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardOpenOption.CREATE_NEW
import java.nio.file.StandardOpenOption.READ
import java.nio.file.StandardOpenOption.WRITE
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.graalvm.nativeimage.ProcessProperties
import org.springframework.stereotype.Component
import reactor.core.publisher.Mono
import reactor.core.scheduler.Schedulers
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively

private const val LIMIT = 2 * 1024 * 1024
private const val TRACE_PREFIX = "behavior"
private const val POSIX_SIGKILL_STATUS = 137
private val ownedOption = Regex("^--?(simulate|modelcheck|workers|depth|metadir|cleanup|recover|help|h)(=|$)")
private val sanyError = Regex("Parse Error|Semantic errors|Fatal errors|\\*{3} Errors:", RegexOption.IGNORE_CASE)

internal data class Execution(
    val exitCode: Int?,
    val signal: String?,
    val stdout: String,
    val stderr: String,
    val truncated: Boolean,
    val failed: Boolean,
    val behavior: String? = null,
    val behaviorError: String? = null
) {
    fun payload(): Map<String, Any?> = buildMap {
        put("exitCode", exitCode)
        put("signal", signal)
        put("stdout", stdout)
        put("stderr", stderr)
        put("truncated", truncated)
        put("failed", failed)
        behavior?.let { put("behavior", it) }
        behaviorError?.let { put("behaviorError", it) }
    }
}

@Component
internal class TlaRunner {
    private val requests = Executors.newThreadPerTaskExecutor(Thread.ofPlatform().name("tla-worker-", 0).factory())
    private val scheduler = Schedulers.fromExecutorService(requests, "tla-worker")

    fun run(tool: Tool, input: ToolInput): Mono<Execution> =
        Mono.fromCallable { execute(tool, input) }.subscribeOn(scheduler)

    @PreDestroy
    fun close() {
        scheduler.dispose()
        requests.close()
    }

    @OptIn(ExperimentalPathApi::class)
    private fun execute(tool: Tool, input: ToolInput): Execution {
        accessible(input.file)
        input.config?.let(::accessible)
        val directory = Files.createTempDirectory("tlaplus-plugin-")
        return try {
            val command = command(tool, input, directory)
            val cwd = input.file.parent ?: input.file
            if (tool == Tool.EXPLORE) {
                explore(command, cwd, directory)
            } else {
                runProcess(command, cwd, tool == Tool.SANY)
            }
        } finally {
            directory.deleteRecursively()
        }
    }

    private fun explore(command: List<String>, cwd: Path, directory: Path): Execution =
        createTrace(directory).use { trace ->
            val execution = runProcess(command, cwd, sany = false)
            if (execution.failed) return execution
            try {
                check(!execution.truncated) { "Explore output exceeds the response limit" }
                execution.copy(behavior = readBehavior(trace))
            } catch (error: IOException) {
                execution.copy(failed = true, behaviorError = error.message)
            } catch (error: IllegalStateException) {
                execution.copy(failed = true, behaviorError = error.message)
            }
        }

    private fun command(tool: Tool, input: ToolInput, directory: Path): List<String> = buildList {
        if (tool == Tool.EXPLORE) {
            val reserved = input.options.firstOrNull { ownedOption.containsMatchIn(it) }
            require(reserved == null) { "Explore owns this option: $reserved" }
        }
        add(ProcessProperties.getExecutableName())
        add(WORKER_MODE)
        add(if (tool == Tool.SANY) "sany" else "tlc")
        addAll(input.javaOptions)
        add("-Djava.io.tmpdir=$directory")
        add(WORKER_ARGUMENTS)
        if (tool == Tool.SANY) {
            add(input.file.toString())
        } else {
            addAll(listOf("-metadir", directory.toString(), "-workers", "1"))
            input.config?.let { addAll(listOf("-config", it.toString())) }
            if (tool == Tool.SMOKE || tool == Tool.EXPLORE) {
                val simulation = if (tool == Tool.SMOKE) "num=1" else "num=1,file=${directory.resolve(TRACE_PREFIX)}"
                addAll(listOf("-simulate", simulation, "-depth", input.depth.toString()))
            }
            addAll(input.options)
            add(input.file.fileName?.toString().orEmpty())
        }
    }

    private fun runProcess(command: List<String>, cwd: Path, sany: Boolean): Execution =
        Executors.newVirtualThreadPerTaskExecutor().use { readers ->
            val worker = ProcessBuilder(command).directory(cwd.toFile()).start()
            try {
                worker.outputStream.close()
                val out = readers.submit<Captured> { capture(worker.inputStream, sany) }
                val err = readers.submit<Captured> { capture(worker.errorStream, sany) }
                check(worker.waitFor(120, TimeUnit.SECONDS)) { "The operation was aborted due to timeout" }
                val stdout = out.get()
                val stderr = err.get()
                val status = worker.exitValue()
                val killed = !isWindows && status == POSIX_SIGKILL_STATUS
                Execution(
                    status.takeUnless { killed }, if (killed) "SIGKILL" else null,
                    stdout.text, stderr.text, stdout.truncated || stderr.truncated,
                    status != 0 || stdout.sanyError || stderr.sanyError
                )
            } finally {
                if (worker.isAlive) stop(worker)
            }
        }

    private fun stop(worker: Process) {
        worker.destroy()
        try {
            worker.onExit().get(2, TimeUnit.SECONDS)
        } catch (_: TimeoutException) {
            worker.destroyForcibly().onExit().join()
        } catch (_: InterruptedException) {
            worker.destroyForcibly().onExit().join()
            Thread.currentThread().interrupt()
        }
    }
}

private fun accessible(path: Path) {
    try {
        path.fileSystem.provider().checkAccess(path)
    } catch (_: NoSuchFileException) {
        throw IOException("ENOENT: no such file or directory, access '$path'")
    }
}

private data class Captured(val text: String, val truncated: Boolean, val sanyError: Boolean)

private fun capture(stream: InputStream, sany: Boolean): Captured {
    val text = StringBuilder()
    var truncated = false
    var diagnostic = false
    var tail = ""
    InputStreamReader(stream, Charsets.UTF_8).use { reader ->
        val buffer = CharArray(8192)
        while (true) {
            val length = reader.read(buffer)
            if (length < 0) break
            if (sany && !diagnostic) {
                val chunk = tail + String(buffer, 0, length)
                diagnostic = sanyError.containsMatchIn(chunk)
                tail = chunk.takeLast(256)
            }
            val kept = minOf(length, LIMIT - text.length)
            text.append(buffer, 0, kept)
            truncated = truncated || kept < length
        }
    }
    return Captured(text.toString(), truncated, diagnostic)
}

internal fun createTrace(directory: Path): FileChannel =
    FileChannel.open(directory.resolve("${TRACE_PREFIX}_0_0"), CREATE_NEW, READ, WRITE, NOFOLLOW_LINKS)

internal fun readBehavior(trace: FileChannel): String {
    check(trace.size() in 1..LIMIT.toLong()) { "Behavior must be a nonempty regular file of at most 2 MiB" }
    val bytes = Channels.newInputStream(trace.position(0)).readNBytes(LIMIT + 1)
    check(bytes.size in 1..LIMIT) { "Behavior is empty or exceeds the 2 MiB response limit" }
    return String(bytes, Charsets.UTF_8)
}
