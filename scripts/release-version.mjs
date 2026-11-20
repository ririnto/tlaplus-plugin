import { tlaVersion } from "./tla-version.mjs";

const tagPattern =
  /^(?<year>\d{4})\.(?<month>0[1-9]|1[0-2])\.(?<day>0[1-9]|[12]\d|3[01])\.(?<seq>0[1-9]|[1-9]\d)$/u;
const groups = tagPattern.exec(process.argv[2] ?? "")?.groups;
if (!groups) {
  console.error(
    "Expected a yyyy.MM.dd.seq plugin version tag with a two-digit seq, for example 2026.11.20.01",
  );
  process.exit(1);
}
console.log(`${tlaVersion}-${groups.year}.${groups.month}.${groups.day}.${Number(groups.seq)}`);
