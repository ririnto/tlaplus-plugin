import { tlaVersion } from "./tla-version.ts";

const tag = process.argv[2] ?? "";
const { date, sequence } =
  /^(?<date>[0-9]{4}\.(?:0[1-9]|1[0-2])\.(?:0[1-9]|[12][0-9]|3[01]))-(?<sequence>[1-9][0-9]*)$/u.exec(
    tag
  )?.groups ?? {};
if (date === undefined || sequence === undefined) {
  throw new Error("Expected a UTC release tag in yyyy.MM.dd-seq format");
}
console.log(
  `${tlaVersion}-${date.split(".").map(Number).join(".")}.${sequence}`
);
