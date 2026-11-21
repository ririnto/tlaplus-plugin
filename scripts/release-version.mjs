import { tlaVersion } from "./tla-version.mjs";

const tag = process.argv[2] ?? "";
if (!/^20[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}$/u.test(tag)) {
  throw new Error("Expected a UTC CalVer release tag");
}
console.log(`${tlaVersion}-${tag.split(".").map(Number).join(".")}`);
