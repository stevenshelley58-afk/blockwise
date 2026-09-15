#!/usr/bin/env bash
# Generate the media fixtures the video integration tests run against.
#
# The fixtures are synthesised, so they cost nothing to reproduce and carry no
# customer data. They are deliberately not committed: they are large binaries
# and ffmpeg regenerates them deterministically.
#
#   bash scripts/dev/make-video-fixtures.sh [output-dir]
#
# Then point the tests at that directory:
#
#   BLOCKWISE_VIDEO_FIXTURES=/tmp/video-fixtures \
#     node --import tsx --test tests/adbuilder-video-realmedia.test.ts
set -Eeuo pipefail

OUT="${1:-/tmp/video-fixtures}"
FFMPEG="${BLOCKWISE_FFMPEG_PATH:-ffmpeg}"

command -v "$FFMPEG" >/dev/null 2>&1 || {
  echo "ffmpeg is required to build the video fixtures." >&2
  exit 2
}

mkdir -p "$OUT"

# Vertical 1080x1920 MP4, 24s, with audio. The shape the deliverable targets.
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=24" \
  -f lavfi -i "sine=frequency=440:duration=24" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest \
  "$OUT/vertical-1080x1920.mp4"

# Landscape 1920x1080 MP4, 8s, no audio. Exercises the resize path.
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=8" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  "$OUT/landscape-1920x1080.mp4"

# Small 640x480 MOV. Proves the resize never upscales.
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=640x480:rate=30:duration=3" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -f mov \
  "$OUT/small.mov"

echo "video fixtures written to $OUT"
ls -la "$OUT"
