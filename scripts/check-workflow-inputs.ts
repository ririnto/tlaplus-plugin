import { spawnSync } from "node:child_process";
import { globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  CST,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  Parser,
  Scalar,
  visit
} from "yaml";
import type { Alias, Node, YAMLMap, YAMLSeq } from "yaml";

interface ContextualDefault {
  readonly line: number;
  readonly condition: string;
}

type Defaults = Readonly<Record<string, string | ContextualDefault | null>>;

interface ApprovedAction {
  readonly commit: string;
  readonly inputs: Defaults;
}

const contextual = (line: number, condition: string): ContextualDefault => ({
  line,
  condition
});

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
        "github-server-url": contextual(99, "GitHub instance of the workflow"),
        lfs: "false",
        path: null,
        "persist-credentials": "true",
        ref: contextual(
          10,
          "Trigger ref for this repository, otherwise the default branch"
        ),
        repository: contextual(6, "Current github.repository"),
        "set-safe-directory": "true",
        "show-progress": "true",
        "sparse-checkout": "",
        "sparse-checkout-cone-mode": "true",
        "ssh-key": null,
        "ssh-known-hosts": null,
        "ssh-strict": "true",
        "ssh-user": "git",
        submodules: "false",
        token: contextual(24, "Current github.token")
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
        path: contextual(12, "Runner GITHUB_WORKSPACE"),
        pattern: null,
        repository: contextual(32, "Current github.repository"),
        "run-id": contextual(37, "Current github.run_id"),
        "skip-decompress": "false"
      }
    },
    "actions/setup-node@v7": {
      commit: "949feb2413d6458794dcd2491c4babbbce0c15c1",
      inputs: {
        architecture: contextual(10, "Runner architecture"),
        cache: null,
        "cache-dependency-path": null,
        "check-latest": "false",
        mirror: null,
        "mirror-token": null,
        "node-version": null,
        "node-version-file": null,
        "package-manager-cache": "true",
        "registry-url": null,
        scope: contextual(17, "Repository owner for GitHub Packages"),
        token: contextual(
          20,
          "Current github.token on github.com, otherwise empty"
        )
      }
    },
    "actions/upload-artifact@v7": {
      commit: "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
      inputs: {
        archive: "true",
        "compression-level": "6",
        "if-no-files-found": "warn",
        "include-hidden-files": "false",
        name: "artifact",
        overwrite: "false",
        path: null,
        "retention-days": null
      }
    },
    "graalvm/setup-graalvm@v1": {
      commit: "60e76998d25690099182b796e99b8804da582d90",
      inputs: {
        cache: null,
        "check-for-updates": "true",
        components: "",
        distribution: "",
        "gds-token": null,
        "github-token": contextual(27, "Current github.token"),
        "java-package": "jdk",
        "java-version": null,
        "native-image-enable-sbom": "false",
        "native-image-job-reports": "false",
        "native-image-musl": "false",
        "native-image-pr-reports": "false",
        "native-image-pr-reports-update-existing": "false",
        "set-java-home": "true",
        version: ""
      }
    },
    "pnpm/action-setup@v4": {
      commit: "b906affcce14559ad1aafd4ab0e942779e9f58b1",
      inputs: {
        cache: "false",
        cache_dependency_path: "pnpm-lock.yaml",
        dest: "~/setup-pnpm",
        package_json_file: "package.json",
        run_install: "null",
        standalone: "false",
        version: null
      }
    }
  })
);

const runnerNumber = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return Object.is(value, -0) ? "-0" : String(value);
  }

  // NumberToken uses .NET G15, which rounds exact binary midpoints to even.
  const [bits] = new BigUint64Array(new Float64Array([Math.abs(value)]).buffer);
  const fractionUnit = 2n ** 52n;
  const exponent = Number(bits / fractionUnit);
  const binaryPower = Math.max(exponent, 1) - 1075;
  const significand =
    (bits % fractionUnit) + (exponent === 0 ? 0n : fractionUnit);
  const decimalPower = Number(value.toExponential().split("e").at(-1)) - 14;
  const numerator =
    significand *
    2n ** BigInt(Math.max(binaryPower, 0)) *
    10n ** BigInt(Math.max(-decimalPower, 0));
  const denominator =
    2n ** BigInt(Math.max(-binaryPower, 0)) *
    10n ** BigInt(Math.max(decimalPower, 0));
  const integer = numerator / denominator;
  const doubledRemainder = 2n * (numerator % denominator);
  const roundsUp =
    doubledRemainder > denominator ||
    (doubledRemainder === denominator && integer % 2n !== 0n);
  const digits = (integer + (roundsUp ? 1n : 0n)).toString();
  const power = decimalPower + digits.length - 1;
  const sign = value < 0 ? "-" : "";
  if (power >= -4 && power < 15) {
    return String(Number(`${sign}${digits}e${decimalPower}`));
  }
  const fraction = digits.slice(1).replace(/0+$/u, "");
  return `${sign}${digits.charAt(0)}${fraction ? `.${fraction}` : ""}E${power < 0 ? "-" : "+"}${String(Math.abs(power)).padStart(2, "0")}`;
};

const runnerScalarValue = (node: Scalar): unknown => {
  const { tag, type, value } = node;
  if (tag === undefined || tag === "tag:yaml.org,2002:str") {
    return value;
  }
  if (type !== Scalar.PLAIN) {
    return undefined;
  }

  switch (tag) {
    case "tag:yaml.org,2002:bool": {
      return typeof value === "boolean" ? value : undefined;
    }
    case "tag:yaml.org,2002:null": {
      return value === null ? value : undefined;
    }
    case "tag:yaml.org,2002:float": {
      // Actions accepts decimal integers with !!float, which YAML's float resolver leaves as strings.
      if (typeof value === "string" && /^[-+]?\d+$/u.test(value)) {
        return Number(value);
      }
      return typeof value === "number" ? value : undefined;
    }
    case "tag:yaml.org,2002:int": {
      return typeof value === "number" ? value : undefined;
    }
    default: {
      return undefined;
    }
  }
};

const runnerScalar = (node: unknown): string | null => {
  if (node === null) {
    return "";
  }
  if (!isScalar(node)) {
    return null;
  }
  const value = runnerScalarValue(node);
  if (typeof value === "string") {
    return value.includes(`\${{`) ? null : value;
  }
  if (value === null || typeof value === "boolean") {
    return value === null ? "" : String(value);
  }
  if (typeof value === "number") {
    if (node.format === "HEX" || node.format === "OCT") {
      if (value >= 2 ** 32) {
        return null;
      }
      return String(value >= 2 ** 31 ? value - 2 ** 32 : value);
    }
    return runnerNumber(value);
  }
  return null;
};

const localDefaults = (file: string, contents: string) => {
  const gitLocalVariables = spawnSync(
    "git",
    ["rev-parse", "--local-env-vars"],
    {
      encoding: "utf-8"
    }
  );
  if (gitLocalVariables.status !== 0) {
    return null;
  }
  const localVariables = new Set(
    gitLocalVariables.stdout.trim().split(/\r?\n/u)
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !localVariables.has(name.toUpperCase())
    )
  );
  const workflowPath = realpathSync(file);
  const cwd = path.dirname(workflowPath);
  const git = (...args: string[]): string | null => {
    const result = spawnSync("git", args, { cwd, encoding: "utf-8", env });
    return result.status === 0 ? result.stdout : null;
  };
  const revision = git("rev-parse", "HEAD")?.trimEnd();
  if (
    revision === undefined ||
    revision === "" ||
    git("show", `${revision}:./${path.basename(workflowPath)}`) !== contents
  ) {
    return null;
  }

  return (reference: string): Defaults | null => {
    if (reference.split("/").includes("..") || reference.includes("\\")) {
      return null;
    }
    const stem = `${revision}:${path.posix.join(reference.slice(2), "action")}`;
    const manifest = git("show", `${stem}.yml`) ?? git("show", `${stem}.yaml`);
    if (manifest === null) {
      return null;
    }
    const doc = parseDocument(manifest);
    const inputs = doc.get("inputs", true);
    if (doc.errors.length > 0 || !isMap(inputs)) {
      return null;
    }

    return Object.fromEntries(
      inputs.items.flatMap(({ key, value }) =>
        isScalar(key) && typeof key.value === "string" && isMap(value)
          ? [
              [
                key.value.toLowerCase(),
                runnerScalar(value.get("default", true))
              ]
            ]
          : []
      )
    );
  };
};

interface Anchor {
  readonly name: string;
  readonly definition: Node;
  readonly offset: number;
  readonly aliases: Alias[];
}

interface InputUse {
  readonly reference: string;
  readonly defaults: Defaults | null;
  readonly nodes: readonly Node[];
  readonly mappingAlias: Alias | null;
}

const workflowSyntax = (
  workflow: ReturnType<typeof parseDocument>,
  contents: string
) => {
  const offsets = new Map<string, number[]>();
  for (const token of new Parser().parse(contents)) {
    if (token.type === "document") {
      CST.visit(token, ({ start, sep }) => {
        for (const prop of [...start, ...(sep ?? [])]) {
          if (prop.type === "anchor") {
            const name = prop.source.slice(1);
            const positions = offsets.get(name) ?? [];
            positions.push(prop.offset);
            offsets.set(name, positions);
          }
        }
      });
    }
  }
  const byName = new Map<string, Anchor>();
  const byNode = new Map<Node, Anchor>();
  visit(workflow, {
    Alias(_key, alias) {
      const target = byName.get(alias.source);
      if (target) {
        target.aliases.push(alias);
        byNode.set(alias, target);
      }
    },
    Value(_key, node) {
      if (node.anchor !== undefined && node.range) {
        const previous = byName.get(node.anchor)?.offset ?? -1;
        const offset =
          offsets
            .get(node.anchor)
            ?.toSorted((a, b) => a - b)
            .find((position) => position > previous) ?? node.range[0];
        const anchor = {
          aliases: [],
          definition: node,
          name: node.anchor,
          offset
        };
        byName.set(node.anchor, anchor);
        byNode.set(node, anchor);
      }
    }
  });

  const resolve = (node: unknown): unknown =>
    isAlias(node) ? byNode.get(node)?.definition : node;
  const field = (mapping: unknown, name: string) =>
    isMap(mapping)
      ? mapping.items.find(({ key }) => {
          const node = resolve(key);
          return (
            isScalar(node) &&
            typeof node.value === "string" &&
            node.value.toLowerCase() === name
          );
        })
      : undefined;
  return { byNode, field, resolve };
};

const collectInputUses = (
  workflow: ReturnType<typeof parseDocument>,
  syntax: ReturnType<typeof workflowSyntax>,
  readLocal: (reference: string) => Defaults | null
): Map<YAMLMap, InputUse[]> => {
  const { field, resolve } = syntax;
  const groups = new Map<YAMLMap, InputUse[]>();
  const jobsField = field(workflow.contents, "jobs");
  const jobs = resolve(jobsField?.value);
  if (!isMap(jobs)) {
    return groups;
  }

  const collectJob = (steps: YAMLSeq, owners: unknown[]): void => {
    let sameRevision = true;
    for (const stepNode of steps.items) {
      const step = resolve(stepNode);
      if (!isMap(step)) {
        sameRevision = false;
        continue;
      }
      const uses = field(step, "uses");
      const withField = field(step, "with");
      const inputs = resolve(withField?.value);
      const reference =
        runnerScalar(resolve(uses?.value)) ?? "(unresolved action)";
      if (isMap(inputs) && withField) {
        let defaults = approvedActions.get(reference)?.inputs ?? null;
        if (sameRevision && reference.startsWith("./")) {
          defaults = readLocal(reference);
        }
        const nodes = [
          ...owners,
          stepNode,
          withField.key,
          withField.value
        ].filter(isNode);
        const mappingAlias =
          [...owners, stepNode, withField.value].find(isAlias) ?? null;
        const group = groups.get(inputs) ?? [];
        group.push({ defaults, mappingAlias, nodes, reference });
        groups.set(inputs, group);
      }
      if (uses || field(step, "run")) {
        sameRevision &&=
          reference === "actions/checkout@v7" &&
          (!withField ||
            (isMap(inputs) &&
              !["repository", "ref", "path"].some((name) =>
                field(inputs, name)
              )));
      }
    }
  };
  for (const { value } of jobs.items) {
    const stepsField = field(resolve(value), "steps");
    const steps = resolve(stepsField?.value);
    if (isSeq(steps)) {
      collectJob(steps, [
        workflow.contents,
        jobsField?.value,
        value,
        stepsField?.value
      ]);
    }
  }
  return groups;
};

const checkWorkflow = (file: string): void => {
  const lineCounter = new LineCounter();
  const contents = readFileSync(file, "utf-8");
  const workflow = parseDocument(contents, { lineCounter });
  if (workflow.errors.length > 0) {
    for (const error of workflow.errors) {
      process.stderr.write(`${file}: ${error.message}\n`);
    }
    process.exitCode = 1;
    return;
  }
  if (workflow.directives?.yaml.version === "1.1") {
    return;
  }

  const syntax = workflowSyntax(workflow, contents);
  let local: ReturnType<typeof localDefaults> | undefined;
  const groups = collectInputUses(workflow, syntax, (reference) => {
    if (local === undefined) {
      local = localDefaults(file, contents);
    }
    return local?.(reference) ?? null;
  });

  const location = (offset: number) => {
    const { line, col } = lineCounter.linePos(offset);
    return `${file}:${line}:${col}`;
  };
  const locateNode = (node: Node) => location(node.range?.[0] ?? 0);
  const describeAnchor = ({ aliases, name, offset }: Anchor): string =>
    aliases.length === 0
      ? `Anchor &${name} leaves with the removed line.`
      : `Anchor &${name} at ${location(offset)} has alias uses at ${aliases.map(locateNode).join(", ")}.`;

  const report = (
    key: Node,
    value: unknown,
    input: string,
    literal: string,
    group: readonly InputUse[]
  ): void => {
    const name = input.toLowerCase();
    const equal = group.filter(({ defaults }) => defaults?.[name] === literal);
    const shared = equal.length !== group.length;
    const emitted = new Set<string>();
    for (const use of equal) {
      const anchors = new Set(
        [...use.nodes, key, value]
          .filter(isNode)
          .map((node) => syntax.byNode.get(node))
          .filter((anchor) => anchor !== undefined)
      );
      const usedAnchors = [...anchors].filter(
        ({ aliases }) => aliases.length > 0
      );
      let category = "omit";
      if (isAlias(value)) {
        category = "hand-edit";
      } else if (shared) {
        category = "shared-definition";
      } else if (usedAnchors.length > 0) {
        category = "hand-edit";
      }

      let reportAt = key;
      let guidance = "Omit the redundant input.";
      if (use.mappingAlias) {
        reportAt = use.mappingAlias;
        guidance = `Detach this step's mapping at the alias use and leave the shared definition at ${locateNode(key)}.`;
      } else if (isAlias(value)) {
        reportAt = value;
        guidance =
          "Edit the input at this alias use and preserve the anchor and its other consumers.";
      } else if (category !== "omit") {
        guidance =
          "Preserve the anchor and its consumers when editing the input.";
      }
      const id = `${locateNode(reportAt)}: R35 ${use.reference} ${input} [${category}]`;
      if (emitted.has(id)) {
        continue;
      }
      emitted.add(id);

      const details =
        category === "omit"
          ? [...anchors]
              .filter(
                ({ definition }) => definition === key || definition === value
              )
              .map(describeAnchor)
          : usedAnchors.map(describeAnchor);
      if (shared) {
        const actionRefs = new Set(group.map(({ reference }) => reference));
        details.unshift(`Consumers: ${[...actionRefs].join(", ")}.`);
      }
      process.stderr.write(
        `${id} Matches documented default ${JSON.stringify(literal)}. ${[guidance, ...details].join(" ")}\n`
      );
      process.exitCode = 1;
    }
  };

  for (const [mapping, group] of groups) {
    for (const { key, value } of mapping.items) {
      const input = syntax.resolve(key);
      const literal = runnerScalar(syntax.resolve(value));
      if (
        isNode(key) &&
        isScalar(input) &&
        typeof input.value === "string" &&
        literal !== null
      ) {
        report(key, value, input.value, literal, group);
      }
    }
  }
};

const files = process.argv.slice(2);
if (files.length === 1 && files[0] === "--metadata") {
  for (const [reference, { commit, inputs }] of approvedActions) {
    for (const [input, value] of Object.entries(inputs)) {
      const prefix = `R35 ${reference} ${input}`;
      const source = `https://github.com/${reference.split("@")[0]}/blob/${commit}/action.yml`;
      const description =
        typeof value === "string"
          ? `literal ${JSON.stringify(value)}`
          : "no-default";
      process.stdout.write(
        value !== null && typeof value === "object"
          ? `${prefix} contextual ${value.condition} ${source}#L${value.line}\n`
          : `${prefix} ${description} ${source}\n`
      );
    }
  }
} else {
  for (const file of (files.length > 0
    ? files
    : globSync(".github/workflows/*.{yaml,yml}")
  ).toSorted()) {
    checkWorkflow(file);
  }
}
