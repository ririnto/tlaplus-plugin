import { globSync, readFileSync } from "node:fs";

import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";

interface ApprovedAction {
  readonly commit: string;
  readonly inputs: Readonly<
    Record<string, string | null | { readonly contextual: string | null }>
  >;
}

const approvedActions = new Map(
  Object.entries<ApprovedAction>({
    "actions/checkout@v7": {
      commit: "3d3c42e5aac5ba805825da76410c181273ba90b1",
      inputs: {
        "allow-unsafe-pr-checkout": "false",
        clean: "true",
        "fetch-depth": "1",
        "fetch-tags": "false",
        filter: null,
        "github-server-url": { contextual: null },
        lfs: "false",
        path: null,
        "persist-credentials": "true",
        ref: { contextual: null },
        repository: { contextual: `\${{ github.repository }}` },
        "set-safe-directory": "true",
        "show-progress": "true",
        "sparse-checkout": null,
        "sparse-checkout-cone-mode": "true",
        "ssh-key": null,
        "ssh-known-hosts": null,
        "ssh-strict": "true",
        "ssh-user": "git",
        submodules: "false",
        token: { contextual: `\${{ github.token }}` }
      }
    },
    "actions/download-artifact@v8": {
      commit: "9000827ccba6bdab643e8b6fd33ac0654aef8333",
      inputs: {
        "artifact-ids": null,
        "digest-mismatch": "error",
        "github-token": null,
        "merge-multiple": "false",
        name: null,
        path: { contextual: null },
        pattern: null,
        repository: { contextual: `\${{ github.repository }}` },
        "run-id": { contextual: `\${{ github.run_id }}` },
        "skip-decompress": "false"
      }
    },
    "actions/setup-node@v7": {
      commit: "949feb2413d6458794dcd2491c4babbbce0c15c1",
      inputs: {
        architecture: { contextual: null },
        cache: null,
        "cache-dependency-path": { contextual: null },
        "check-latest": "false",
        mirror: null,
        "mirror-token": null,
        "node-version": null,
        "node-version-file": null,
        "package-manager-cache": { contextual: "true" },
        "registry-url": null,
        scope: null,
        token: {
          contextual: `\${{ github.server_url == 'https://github.com' && github.token || '' }}`
        }
      }
    },
    "actions/upload-artifact@v7": {
      commit: "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
      inputs: {
        archive: "true",
        "compression-level": "6",
        "if-no-files-found": "warn",
        "include-hidden-files": "false",
        name: { contextual: "artifact" },
        overwrite: "false",
        path: null,
        "retention-days": { contextual: null }
      }
    },
    "graalvm/setup-graalvm@v1": {
      commit: "60e76998d25690099182b796e99b8804da582d90",
      inputs: {
        cache: null,
        "check-for-updates": "true",
        components: "",
        distribution: { contextual: "" },
        "gds-token": null,
        "github-token": { contextual: `\${{ github.token }}` },
        "java-package": "jdk",
        "java-version": null,
        "native-image-enable-sbom": "false",
        "native-image-job-reports": "false",
        "native-image-musl": "false",
        "native-image-pr-reports": "false",
        "native-image-pr-reports-update-existing": "false",
        "set-java-home": "true",
        version: { contextual: "" }
      }
    },
    "pnpm/action-setup@v4": {
      commit: "b906affcce14559ad1aafd4ab0e942779e9f58b1",
      inputs: {
        cache: "false",
        cache_dependency_path: "pnpm-lock.yaml",
        dest: { contextual: "~/setup-pnpm" },
        package_json_file: "package.json",
        run_install: "null",
        standalone: "false",
        version: { contextual: null }
      }
    }
  })
);

for (const file of globSync(".github/workflows/*.{yaml,yml}").toSorted()) {
  const lineCounter = new LineCounter();
  const workflow = parseDocument(readFileSync(file, "utf-8"), { lineCounter });
  for (const error of workflow.errors) {
    process.stderr.write(`${file}: ${error.message}\n`);
    process.exitCode = 1;
  }
  const jobs = workflow.get("jobs", true);
  if (workflow.errors.length > 0 || !isMap(jobs)) {
    continue;
  }

  for (const step of jobs.items.flatMap(({ value }) => {
    const steps = isMap(value) && value.get("steps", true);
    return isSeq(steps) ? steps.items : [];
  })) {
    const uses = isMap(step) && step.get("uses");
    const inputs = isMap(step) && step.get("with", true);
    if (typeof uses !== "string" || !isMap(inputs)) {
      continue;
    }
    const action = approvedActions.get(uses);
    if (!action) {
      continue;
    }

    for (const { key, value } of inputs.items) {
      if (
        !(isScalar(key) && typeof key.value === "string" && isScalar(value))
      ) {
        continue;
      }

      const literal: unknown = value.value;
      const defaultValue = action.inputs[key.value];
      if (
        typeof defaultValue === "string" &&
        (typeof literal === "string" ||
          typeof literal === "boolean" ||
          (typeof literal === "number" && Number.isSafeInteger(literal))) &&
        !String(literal).includes(`\${{`) &&
        String(literal) === defaultValue
      ) {
        const { line, col } = lineCounter.linePos(key.range?.[0] ?? 0);
        process.stderr.write(
          `${file}:${line}:${col}: R35 Remove ${key.value} from ${uses} with inputs. Its documented default is ${JSON.stringify(defaultValue)}.\n`
        );
        process.exitCode = 1;
      }
    }
  }
}
