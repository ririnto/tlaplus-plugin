import { tlaVersion } from "./tla-version.mjs";

console.log(`${tlaVersion}-${process.argv[2] ?? ""}`);
