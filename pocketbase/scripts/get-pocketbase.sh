#!/usr/bin/env sh
# Downloads the pinned PocketBase release into ./bin (used by `npm run serve`
# and the test suite). Override with PB_VERSION=… or PB_BIN=/path/to/pocketbase.
set -eu
PB_VERSION="${PB_VERSION:-0.40.4}"
cd "$(dirname "$0")/.."
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
url="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${os}_${arch}.zip"
mkdir -p bin
tmp="$(mktemp -d)"
echo "Downloading $url"
curl -fsSL "$url" -o "$tmp/pb.zip"
unzip -o -q "$tmp/pb.zip" pocketbase -d bin
chmod +x bin/pocketbase
rm -rf "$tmp"
./bin/pocketbase --version
