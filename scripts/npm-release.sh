#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

if [ "$#" -ne 3 ]; then
  fail "Usage: bash scripts/npm-release.sh {prepare|stage|platforms|promote|release} <git-tag> <artifact-directory>"
fi

mode=$1
git_tag=$2
root=$(cd "$3" && pwd -P)
version=$(node scripts/release-version.ts "$git_tag")
tools_tag=$(node --input-type=module -e 'import { tlaDistTag } from "./scripts/tla-version.ts"; console.log(tlaDistTag)')
holding_tag="staged-$version"
commit=$(git rev-parse HEAD)
main=$(jq -er .name package.json)
stem=${main#@}
stem=${stem/\//-}
registry=https://registry.npmjs.org
manifest="$root/npm-release/manifest.json"
submissions="$root/npm-stage/submissions.ndjson"

add_tarball() {
  local name=$1 prefix=$2 tarball packed integrity shasum
  local candidates=("$root/$prefix"[0-9]*.tgz)
  tarball="$prefix$version.tgz"
  if [ "${#candidates[@]}" -ne 1 ] || [ "${candidates[0]}" != "$root/$tarball" ] || [ ! -f "$root/$tarball" ]; then
    fail "Expected exactly one tarball at $root/$tarball"
  fi
  if ! packed=$(tar -xOf "$root/$tarball" package/package.json |
    jq -ce --arg name "$name" --arg version "$version" 'select(.name == $name and .version == $version)'); then
    fail "Expected $name@$version in $tarball"
  fi
  if [ "$name" = "$main" ] && ! jq -e --argjson deps "$dependencies" '.optionalDependencies == $deps' <<<"$packed" >/dev/null; then
    fail "Expected all platform dependencies at $version in $tarball"
  fi
  integrity=$(openssl dgst -sha512 -binary "$root/$tarball" | openssl base64 -A)
  shasum=$(openssl dgst -sha1 -r "$root/$tarball" | cut -d ' ' -f 1)
  entries+=("$(jq -cn --arg name "$name" --arg tarball "$tarball" \
    --arg integrity "sha512-$integrity" --arg shasum "$shasum" '{name:$name, tarball:$tarball, integrity:$integrity, shasum:$shasum}')")
}

make_manifest() {
  set -e
  local platform platforms dependencies
  local entries=()
  platforms=$(jq -er '.include | map(.platform) | sort[]' .github/package-matrix.json)
  dependencies=$(jq -nc --arg main "$main" --arg version "$version" --arg platforms "$platforms" '
    $platforms | split("\n") | map({key: ($main + "-" + .), value: $version}) | from_entries')
  while IFS= read -r platform; do
    add_tarball "$main-$platform" "npm-package-$platform/$stem-$platform-"
  done <<<"$platforms"
  add_tarball "$main" "npm-package-linux-x64-gnu/$stem-"
  printf '%s\n' "${entries[@]}" |
    jq -cs --arg gitTag "$git_tag" --arg version "$version" --arg commit "$commit" \
      --arg holdingTag "$holding_tag" --arg toolsTag "$tools_tag" \
      '{gitTag:$gitTag, version:$version, commit:$commit, holdingTag:$holdingTag, toolsTag:$toolsTag, packages:.}'
}

if [ "$mode" = prepare ]; then
  make_manifest
  exit
fi

expected=$(make_manifest)
if [ "$(jq -cS . "$manifest")" != "$(jq -cS . <<<"$expected")" ]; then
  fail "Release metadata does not match this checkout, tag and tarball set"
fi
packages=$(jq -c '.packages[]' <<<"$expected")

if [ "$mode" = stage ]; then
  if [ "${GITHUB_RUN_ATTEMPT:-1}" != 1 ]; then
    fail "Refusing a repeated submission. Reconcile stage IDs and registry state from the original attempt."
  fi
  npm_version=$(npm --version)
  node -e '
    const minimum = (version, major, minor) => {
      const [actualMajor, actualMinor] = version.split(".").map(Number);
      return actualMajor > major || (actualMajor === major && actualMinor >= minor);
    };
    const node = process.versions.node;
    const npm = process.argv[1];
    console.log("Staging toolchain: Node %s, npm %s", node, npm);
    if (!minimum(node, 22, 14) || !minimum(npm, 11, 15)) {
      throw new Error("npm staging requires Node 22.14.0 or later and npm 11.15.0 or later");
    }
  ' "$npm_version"
  mkdir -p "$root/npm-stage"
  (
    set -o noclobber
    : >"$submissions"
  )
  while IFS= read -r pkg; do
    name=$(jq -r .name <<<"$pkg")
    tarball=$(jq -r .tarball <<<"$pkg")
    printf 'Submitting %s@%s from %s with tag %s\n' "$name" "$version" "$tarball" "$holding_tag"
    jq -c --arg version "$version" '. + {version:$version,state:"attempting"}' <<<"$pkg" | tee -a "$submissions"
    if output=$(npm stage publish "$root/$tarball" --access public --tag "$holding_tag" \
      --registry "$registry" --provenance --json --fetch-retries=0); then
      if stage_id=$(jq -er --arg name "$name" --arg version "$version" --argjson expected "$pkg" '
        .[$name] | select(.name == $name and .version == $version and .integrity == $expected.integrity and .shasum == $expected.shasum)
        | .stageId | strings | select(test("^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"))' <<<"$output"); then
        jq -c --arg version "$version" --arg stageId "$stage_id" \
          '. + {version:$version,state:"submitted",stageId:$stageId}' <<<"$pkg" | tee -a "$submissions"
        continue
      fi
      reason="npm exited successfully without a matching stage receipt"
    else
      reason="npm exited $?"
    fi
    jq -c --arg version "$version" --arg reason "$reason" \
      '. + {version:$version,state:"unconfirmed",reason:$reason}' <<<"$pkg" | tee -a "$submissions"
    printf '%s\n' "$output" >&2
    fail "$name@$version unconfirmed ($reason). Later packages were not attempted. Reconcile with npm stage list before retrying."
  done <<<"$packages"
  exit
fi

if ! jq -es --argjson manifest "$expected" '
  map(select(.state == "submitted")) as $submitted
  | ($submitted | map({name, tarball, integrity, shasum})) == $manifest.packages
    and ($submitted | all(.version == $manifest.version and (.stageId | type == "string")))
    and ($submitted | map(.stageId) | unique | length) == ($manifest.packages | length)
' "$submissions" >/dev/null; then
  fail "Expected a confirmed submission for every package in the release manifest"
fi

read_tags() {
  npm view "$1" dist-tags --json --registry "$registry" --prefer-online
}

check_aliases() {
  local name=$1 tags=$2 requirements=$3
  if ! jq -e --arg version "$version" --arg toolsTag "$tools_tag" --arg requirements "$requirements" '
    def date: capture("^[0-9]+\\.[0-9]+\\.[0-9]+-(?<calver>[0-9]{1,4}\\.[0-9]+\\.[0-9]+\\.[0-9]+)$").calver
      | split(".") | map(tonumber);
    type == "object" and ([.latest, .[$toolsTag]] | all(
      if $requirements == "exact" then . == $version
      else . == null or . == $version or ((date // error("Unrecognized release version")) < ($version | date))
      end
    ))
  ' <<<"$tags" >/dev/null; then
    printf '%s\n' "$tags" >&2
    fail "Cannot use $name@$version with these consumer tags (expected $requirements)"
  fi
}

check_registry() {
  local scope=$1 requirements=$2 pkg name tags integrity
  while IFS= read -r pkg; do
    name=$(jq -r .name <<<"$pkg")
    if [ "$scope" = platforms ] && [ "$name" = "$main" ]; then
      break
    fi
    tags=$(read_tags "$name")
    if ! jq -e --arg tag "$holding_tag" --arg version "$version" '.[$tag] == $version' <<<"$tags" >/dev/null; then
      fail "$name@$version is not visible under $holding_tag"
    fi
    integrity=$(npm view "$name@$version" dist.integrity --json --registry "$registry" --prefer-online)
    if ! jq -e --argjson expected "$pkg" '. == $expected.integrity' <<<"$integrity" >/dev/null; then
      fail "$name@$version does not have the release tarball integrity on npm"
    fi
    check_aliases "$name" "$tags" "$requirements"
    printf 'Verified registry state for %s@%s\n' "$name" "$version"
  done <<<"$packages"
}

if [ "$mode" = promote ] || [ "$mode" = release ]; then
  git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
  if ! (cd "$git_common_dir" && mkdir npm-release.lock); then
    fail "Cannot acquire the npm release lock. Check for another promotion or finalization."
  fi
  trap '(cd "$git_common_dir" && rmdir npm-release.lock)' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

case "$mode" in
platforms)
  check_registry platforms current
  ;;
promote)
  check_registry all current
  while IFS= read -r pkg; do
    name=$(jq -r .name <<<"$pkg")
    for alias in "$tools_tag" latest; do
      tags=$(read_tags "$name")
      check_aliases "$name" "$tags" current
      npm dist-tag add "$name@$version" "$alias" --registry "$registry"
    done
  done <<<"$packages"
  check_registry all exact
  ;;
release)
  check_registry all exact
  platform=$(node --input-type=module -e 'import { nativePlatform } from "./src/native-platform.ts"; console.log(nativePlatform())')
  (
    smoke_home=$(mktemp -d)
    trap 'rm -rf -- "$smoke_home"' EXIT
    node_bin=$(node -p 'process.execPath')
    env -i HOME="$smoke_home" PATH="${node_bin%/*}" \
      "$node_bin" scripts/registry-smoke.ts "$version" "$tools_tag" "$platform" "$registry"
  )
  check_registry all exact
  repo=ririnto/tlaplus-plugin
  ref="refs/tags/$git_tag"
  remote_refs=$(git ls-remote --exit-code "https://github.com/$repo.git" "$ref" "$ref^{}")
  remote_commit=$(awk -v tag="$ref" '$2 == tag {base=$1} $2 == tag "^{}" {peeled=$1} END {print peeled ? peeled : base}' <<<"$remote_refs")
  if [ "$remote_commit" != "$commit" ]; then
    fail "Remote tag $git_tag does not resolve to $commit"
  fi
  tarballs=()
  while IFS= read -r pkg; do
    tarballs+=("$root/$(jq -r .tarball <<<"$pkg")")
  done <<<"$packages"
  gh release create "$git_tag" --repo "$repo" --verify-tag --generate-notes "${tarballs[@]}"
  ;;
*)
  fail "Unknown release operation: $mode"
  ;;
esac
