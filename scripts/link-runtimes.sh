#!/usr/bin/env sh
set -eu

if [ "$(uname -sm)" != "Linux x86_64" ]; then
  echo "Build the universal release on Linux x64." >&2
  exit 1
fi

if [ -z "${GRAALVM_RELEASE_FILE:-}" ]; then
  curl -fsSL --retry 2 https://api.github.com/repos/graalvm/graalvm-ce-builds/releases/latest -o graalvm.json
fi
release=${GRAALVM_RELEASE_FILE:-graalvm.json}
version=$(jq -er '.tag_name | sub("^(graal|jdk)-"; "")' "$release")
echo "Building runtimes with GraalVM Community $version"
mkdir -p "$1"

for platform in linux-x64 linux-arm64 darwin-arm64 win32-x64; do
  case "$platform" in
    linux-x64) suffix=_linux-x64_bin.tar.gz ;;
    linux-arm64) suffix=_linux-aarch64_bin.tar.gz ;;
    darwin-arm64) suffix=_macos-aarch64_bin.tar.gz ;;
    win32-x64) suffix=_windows-x64_bin.zip ;;
  esac
  if [ "$platform" = linux-x64 ] && [ -f "${GRAALVM_HOME:-}/release" ] && grep -Fxq "GRAALVM_VERSION=\"$version\"" "$GRAALVM_HOME/release"; then
    sdk=$GRAALVM_HOME
  else
    url=$(jq -er --arg suffix "$suffix" '
      [.assets[] | select(.name | startswith("graalvm-community-jdk-") and endswith($suffix))]
      | if length == 1 then .[0].browser_download_url else error("Expected one GraalVM JDK matching " + $suffix) end
    ' "$release")
    mkdir "$platform"
    curl -fsSL --retry 2 -o archive "$url"
    if [ "$platform" = win32-x64 ]; then
      unzip -q archive '*/jmods/*' '*/LICENSE.txt' '*/THIRD_PARTY_LICENSE.txt' -d "$platform"
    elif [ "$platform" = linux-x64 ]; then
      tar -xzf archive -C "$platform"
    else
      tar -xzf archive -C "$platform" --wildcards '*/jmods/*.jmod' '*/LICENSE.txt' '*/THIRD_PARTY_LICENSE.txt'
    fi
    rm archive
    sdk=$(dirname "$(dirname "$(find "$platform" -name java.base.jmod -print -quit)")")
  fi
  if [ "$platform" = linux-x64 ]; then
    jlink="$sdk/bin/jlink"
  fi
  "$jlink" --module-path "$sdk/jmods" \
    --add-modules java.desktop,java.instrument,java.logging,java.management,java.naming,java.rmi,java.security.sasl,jdk.attach,jdk.jfr,jdk.management,jdk.unsupported \
    --no-header-files --no-man-pages --strip-java-debug-attributes --compress=zip-9 --output image
  cp "$sdk/LICENSE.txt" "$sdk/THIRD_PARTY_LICENSE.txt" image/
  # npm omits symlinks. Materialize the module licenses before packing.
  cp -RL image "$1/$platform"
  rm -r image
done
