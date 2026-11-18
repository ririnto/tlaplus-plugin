#!/usr/bin/env sh
set -eu

# Build the release on Linux x64. jlink reads each target JDK's own modules.
archive=graalvm-community-jdk-25i5-25.0.5.0.3
release=https://github.com/graalvm/graalvm-ce-builds/releases/download/graal-25.5.5.0.3
if [ "$(uname -sm)" != "Linux x86_64" ]; then
  echo "Build the universal release on Linux x64." >&2
  exit 1
fi
mkdir -p "$1"

for platform in linux-x64 linux-arm64 darwin-arm64 win32-x64; do
  case "$platform" in
    linux-x64) asset=${archive}_linux-x64_bin.tar.gz ;;
    linux-arm64) asset=${archive}_linux-aarch64_bin.tar.gz ;;
    darwin-arm64) asset=${archive}_macos-aarch64_bin.tar.gz ;;
    win32-x64) asset=${archive}_windows-x64_bin.zip ;;
  esac
  mkdir "$platform"
  curl --fail --silent --show-error --location --retry 2 --output "$asset" "$release/$asset"
  if [ "$platform" = win32-x64 ]; then
    unzip -q "$asset" '*/jmods/*' '*/LICENSE.txt' '*/THIRD_PARTY_LICENSE.txt' -d "$platform"
  elif [ "$platform" = linux-x64 ]; then
    tar -xzf "$asset" -C "$platform"
  else
    tar -xzf "$asset" -C "$platform" --wildcards '*/jmods/*.jmod' '*/LICENSE.txt' '*/THIRD_PARTY_LICENSE.txt'
  fi
  sdk=$(dirname "$(dirname "$(find "$platform" -name java.base.jmod -print -quit)")")
  if [ "$platform" = linux-x64 ]; then
    jlink="$sdk/bin/jlink"
  fi
  "$jlink" --module-path "$sdk/jmods" \
    --add-modules java.desktop,java.instrument,java.logging,java.management,java.naming,java.rmi,java.security.sasl,jdk.attach,jdk.jfr,jdk.management,jdk.unsupported \
    --no-header-files --no-man-pages --strip-java-debug-attributes --compress=zip-9 --output image
  cp "$sdk/LICENSE.txt" "$sdk/THIRD_PARTY_LICENSE.txt" image/
  # npm omits symlinks. Materialize the module licenses before packing.
  cp -RL image "$1/$platform"
  rm -r image "$asset"
done
