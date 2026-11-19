package io.github.ririnto.tlaplus

import com.oracle.svm.core.annotate.Substitute
import com.oracle.svm.core.annotate.TargetClass
import util.SimpleFilenameToStream

@TargetClass(SimpleFilenameToStream::class)
internal class NativeStandardModules {
    @Substitute
    private fun getInstallationBasePath(): String = "jar:embedded-tla2tools"
}
