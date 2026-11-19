package io.github.ririnto.tlaplus

import tla2sany.SANY
import tlc2.TLC

object TlaWorker {
    @JvmStatic
    fun main(args: Array<String>) {
        val arguments = args.copyOfRange(1, args.size)
        when (args.first()) {
            "sany" -> SANY.main(arguments)
            "tlc" -> TLC.main(arguments)
            else -> error("Unknown TLA+ worker")
        }
    }
}
