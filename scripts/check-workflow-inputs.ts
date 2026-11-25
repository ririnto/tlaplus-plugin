import { globSync, readFileSync } from "node:fs";

import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  visit
} from "yaml";
import type { YAMLMap, Alias, Node } from "yaml";

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
        filter: "",
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
        "package-manager-cache": "true",
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

const checkWorkflow = (file: string): void => {
  const lineCounter = new LineCounter();
  const workflow = parseDocument(readFileSync(file, "utf-8"), { lineCounter });
  if (workflow.errors.length > 0) {
    for (const error of workflow.errors) {
      process.stderr.write(`${file}: ${error.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const anchors = new Map<string, Node>();
  const aliases = new WeakMap<Alias, Node>();
  const shared = new Set<Node>();
  visit(workflow, {
    Alias(_key, alias) {
      const target = anchors.get(alias.source);
      if (target) {
        aliases.set(alias, target);
        shared.add(target);
      } else {
        const { line, col } = lineCounter.linePos(alias.range?.[0] ?? 0);
        process.stderr.write(
          `${file}:${line}:${col}: Undefined YAML anchor ${alias.source}.\n`
        );
        process.exitCode = 1;
      }
    },
    Value(_key, node) {
      if (node.anchor !== undefined) {
        anchors.set(node.anchor, node);
      }
    }
  });
  const resolve = (node: unknown): unknown =>
    isAlias(node) ? aliases.get(node) : node;
  const field = (mapping: YAMLMap, name: string): unknown =>
    resolve(
      mapping.items.find(({ key }) => {
        const scalar = resolve(key);
        return isScalar(scalar) && scalar.value === name;
      })?.value
    );

  const jobs = isMap(workflow.contents)
    ? field(workflow.contents, "jobs")
    : null;
  if (!isMap(jobs)) {
    return;
  }

  const stepLists = new Set(
    jobs.items
      .map(({ value }) => {
        const job = resolve(value);
        return isMap(job) ? field(job, "steps") : null;
      })
      .filter(isSeq)
  );
  const steps = new Set(
    [...stepLists].flatMap(({ items }) => items.map(resolve).filter(isMap))
  );
  const checked = new WeakMap<Node, Set<string>>();

  const checkInputs = ({
    action,
    inputs,
    uses
  }: {
    action: ApprovedAction;
    inputs: YAMLMap;
    uses: string;
  }): void => {
    for (const { key, value } of inputs.items) {
      const input = resolve(key);
      const scalar = resolve(value);
      if (
        isScalar(input) &&
        typeof input.value === "string" &&
        isScalar(scalar)
      ) {
        const literal = scalar.value ?? "";
        const defaultValue = action.inputs[input.value.toLowerCase()];
        if (
          typeof defaultValue === "string" &&
          (typeof literal === "string" ||
            typeof literal === "boolean" ||
            (typeof literal === "number" && Number.isSafeInteger(literal))) &&
          !String(literal).includes(`\${{`) &&
          String(literal) === defaultValue
        ) {
          const { line, col } = lineCounter.linePos(
            (isAlias(key) ? key.range : input.range)?.[0] ?? 0
          );
          const sharesAnchor =
            shared.has(inputs) ||
            shared.has(input) ||
            (isScalar(value) && shared.has(value));
          const guidance = sharesAnchor
            ? "Review the anchored input and preserve its alias consumers."
            : "Omit the redundant input.";
          process.stderr.write(
            `${file}:${line}:${col}: R35 ${uses} ${input.value}: Matches documented default ${JSON.stringify(defaultValue)}. ${guidance}\n`
          );
          process.exitCode = 1;
        }
      }
    }
  };

  for (const step of steps) {
    const actionRef = field(step, "uses");
    const inputs = field(step, "with");
    const uses = isScalar(actionRef) ? actionRef.value : null;
    const action = typeof uses === "string" ? approvedActions.get(uses) : null;
    if (typeof uses === "string" && action && isMap(inputs)) {
      const refs = checked.get(inputs) ?? new Set<string>();
      if (!refs.has(uses)) {
        refs.add(uses);
        checked.set(inputs, refs);
        checkInputs({ action, inputs, uses });
      }
    }
  }
};

const files = process.argv.slice(2);
for (const file of (files.length > 0
  ? files
  : globSync(".github/workflows/*.{yaml,yml}")
).toSorted()) {
  checkWorkflow(file);
}
