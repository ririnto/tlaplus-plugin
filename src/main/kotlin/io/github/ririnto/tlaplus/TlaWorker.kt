package io.github.ririnto.tlaplus

import tla2sany.SANY
import tlc2.TLC
import kotlin.system.exitProcess

internal const val WORKER_MODE = "--tla-worker"
internal const val WORKER_ARGUMENTS = "--tla-arguments"

internal object TlaWorker {
    fun run(args: List<String>) {
        val firstOption = args.getOrNull(1)
        if (firstOption != WORKER_ARGUMENTS) {
            System.err.println("Unrecognized option: $firstOption")
            exitProcess(1)
        }
        val arguments = args.drop(2).toTypedArray()
        when (args.first()) {
            "sany" -> SANY.main(arguments)
            "tlc" -> TLC.main(arguments)
            else -> error("Unknown TLA+ worker")
        }
    }
}
