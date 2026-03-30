#!/usr/bin/env bash
# Install go2rtc binary for WebRTC live streaming
# https://github.com/AlexxIT/go2rtc
set -euo pipefail

DEST="/usr/local/bin/go2rtc"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)  FILE="go2rtc_linux_amd64" ;;
  aarch64) FILE="go2rtc_linux_arm64" ;;
  armv7l)  FILE="go2rtc_linux_arm" ;;
  *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest release version from GitHub
VERSION=$(curl -sfL "https://api.github.com/repos/AlexxIT/go2rtc/releases/latest" \
  | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
  echo "Could not determine latest go2rtc version. Using v1.9.9 as fallback."
  VERSION="1.9.9"
fi

URL="https://github.com/AlexxIT/go2rtc/releases/download/v${VERSION}/${FILE}"

echo "Downloading go2rtc v${VERSION} (${ARCH})..."
curl -sfL "$URL" -o /tmp/go2rtc
chmod +x /tmp/go2rtc
sudo mv /tmp/go2rtc "$DEST"

echo "go2rtc installed at $DEST"
"$DEST" --version 2>/dev/null || true
