#!/usr/bin/env bash
set -euo pipefail

platform=${1:?Expected linux-x64-musl or linux-arm64-musl}
case "$platform" in
  linux-x64-musl)
    docker_arch=amd64
    vendor_arch=x64
    host_arch=x86_64
    ;;
  linux-arm64-musl)
    docker_arch=arm64
    vendor_arch=aarch64
    host_arch=aarch64
    ;;
  *)
    printf 'Unsupported musl platform: %s\n' "$platform" >&2
    exit 1
    ;;
esac
if [[ $(uname -m) != "$host_arch" ]]; then
  printf "Expected a native %s runner for %s\n" "$host_arch" "$platform" >&2
  exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/output"
git ls-files -z | tar -cf "$stage/source.tar" --null -T -

release_asset=$(curl --fail --silent --show-error --location \
  'https://api.github.com/repos/bell-sw/LibericaNIK/releases?per_page=30' |
  jq -cer --arg suffix "-linux-$vendor_arch-musl.tar.gz" '
    first(.[] | select(.draft == false and .prerelease == false and (.tag_name | startswith("25.")))
      | .assets[]
      | select((.name | startswith("bellsoft-liberica-vm-openjdk25")) and (.name | endswith($suffix)))
      | select(.digest | test("^sha256:[a-f0-9]{64}$"))
      | {url: .browser_download_url, checksum: (.digest | sub("^sha256:"; ""))})')
curl --fail --silent --show-error --location --output "$stage/nik.tar.gz" \
  "$(jq -r '.url' <<< "$release_asset")"
printf '%s  %s\n' "$(jq -r '.checksum' <<< "$release_asset")" "$stage/nik.tar.gz" | sha256sum --check

docker run --rm --platform "linux/$docker_arch" \
  --mount "type=bind,source=$stage,target=/inputs,readonly" \
  --mount "type=bind,source=$stage/output,target=/packages" \
  --env "EXPECTED_PLATFORM=$platform" node:24-alpine3.24 sh -ec '
    apk add --no-cache binutils build-base ca-certificates git linux-headers maven zlib-dev
    mkdir /build /opt/liberica
    tar -xf /inputs/source.tar -C /build
    tar -xf /inputs/nik.tar.gz -C /opt/liberica --strip-components=1
    cd /build
    git init --quiet
    export JAVA_HOME=/opt/liberica GRAALVM_HOME=/opt/liberica
    export PATH="/opt/liberica/bin:$PATH"
    test "$(node --input-type=module -e "import {nativePlatform} from \"./src/native-platform.mjs\"; console.log(nativePlatform())")" = "$EXPECTED_PLATFORM"
    printf "Alpine %s\n" "$(cat /etc/alpine-release)"
    native-image --version
    mvn --version
    manager=$(node -p "require(\"./package.json\").packageManager")
    npx --yes "$manager" install --frozen-lockfile
    npx --yes "$manager" run check:ultracite
    npm pack --pack-destination /packages
    npm pack ./npm --pack-destination /packages
    readelf -lW npm/tlaplus-server | grep -F "Requesting program interpreter: /lib/ld-musl-"
    readelf -dW npm/tlaplus-server
    if readelf --version-info -W npm/tlaplus-server | grep -Fq "GLIBC_"; then
      echo "The musl executable unexpectedly requires glibc symbols" >&2
      exit 1
    fi
    npm test -- /packages/tlaplus-mcp-tlaplus-mcp-[0-9]*.tgz "/packages/tlaplus-mcp-tlaplus-mcp-$EXPECTED_PLATFORM-"[0-9]*.tgz
  '
cp "$stage"/output/*.tgz .
