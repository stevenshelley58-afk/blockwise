import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectImageBytes,
  inspectVideoBytes,
  sniffImageMime,
  sniffVideoContainer,
} from "../src/lib/adbuilder/video-media-inspect.ts";

/** Minimal valid ISO-BMFF header so sniffing sees a real MP4 brand. */
function mp4Header(brand = "isom"): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0, 0, 0, 0x20], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  bytes.set([...brand].map((c) => c.charCodeAt(0)), 8);
  return bytes;
}

function webmHeader(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return bytes;
}

const okProbe = (streams: unknown[]) => async () => ({
  ok: true,
  stdout: JSON.stringify({ streams, format: { duration: "12.5" } }),
});

test("sniffing identifies the container from magic bytes, not the extension", () => {
  assert.equal(sniffVideoContainer(mp4Header())?.mime, "video/mp4");
  assert.equal(sniffVideoContainer(mp4Header("qt  "))?.mime, "video/quicktime");
  assert.equal(sniffVideoContainer(webmHeader())?.mime, "video/webm");
  // A JPEG renamed to .mp4 is not a video container.
  assert.equal(sniffVideoContainer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(sniffVideoContainer(new Uint8Array(0)), null);
});

test("sniffing identifies supported image types", () => {
  const png = new Uint8Array(16);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(sniffImageMime(png), "image/png");
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniffImageMime(mp4Header()), null);
});

test("a spoofed declared type is rejected even when the container is valid", async () => {
  const result = await inspectVideoBytes({
    bytes: mp4Header(),
    declaredMime: "video/webm",
    probe: okProbe([{ codec_type: "video", width: 1080, height: 1920, duration: "12.5" }]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "type_mismatch");
});

test("an unsupported container is rejected without probing", async () => {
  let probed = false;
  const result = await inspectVideoBytes({
    bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]),
    probe: async () => {
      probed = true;
      return { ok: true, stdout: "{}" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_type");
  assert.equal(probed, false, "an unsupported container must never reach the prober");
});

test("an empty upload is rejected", async () => {
  const result = await inspectVideoBytes({ bytes: new Uint8Array(0) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "corrupt_media");
});

test("a file with no video stream is rejected", async () => {
  const result = await inspectVideoBytes({
    bytes: mp4Header(),
    probe: okProbe([{ codec_type: "audio" }]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_video_stream");
});

test("an unreadable probe result is rejected, not accepted", async () => {
  const result = await inspectVideoBytes({
    bytes: mp4Header(),
    probe: async () => ({ ok: false, stdout: "" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "corrupt_media");

  const garbage = await inspectVideoBytes({
    bytes: mp4Header(),
    probe: async () => ({ ok: true, stdout: "not json at all" }),
  });
  assert.equal(garbage.ok, false);
  assert.equal(garbage.reason, "corrupt_media");
});

test("a zero duration stream is treated as corrupt", async () => {
  const result = await inspectVideoBytes({
    bytes: mp4Header(),
    probe: async () => ({
      ok: true,
      stdout: JSON.stringify({ streams: [{ codec_type: "video", width: 1080, height: 1920, duration: "0" }] }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "corrupt_media");
});

test("a valid vertical video is accepted with its measured geometry", async () => {
  const result = await inspectVideoBytes({
    bytes: mp4Header(),
    declaredMime: "video/mp4",
    probe: okProbe([
      { codec_type: "video", width: 1080, height: 1920, duration: "24.2" },
      { codec_type: "audio" },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.mime, "video/mp4");
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.durationSeconds, 24.2);
  assert.equal(result.hasVideoStream, true);
  assert.equal(result.hasAudioStream, true);
});

test("an over-long source is accepted and flagged for the editor, not rejected", async () => {
  const result = await inspectVideoBytes({
    bytes: mp4Header(),
    probe: okProbe([{ codec_type: "video", width: 1920, height: 1080, duration: "300" }]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.durationSeconds, 300);
});

test("image inspection enforces its own limits and type match", async () => {
  const png = new Uint8Array(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const good = await inspectImageBytes({ bytes: png, declaredMime: "image/png" });
  assert.equal(good.ok, true);
  assert.equal(good.mime, "image/png");

  const mismatched = await inspectImageBytes({ bytes: png, declaredMime: "image/jpeg" });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.reason, "type_mismatch");

  const notAnImage = await inspectImageBytes({ bytes: mp4Header(), declaredMime: "image/png" });
  assert.equal(notAnImage.ok, false);
  assert.equal(notAnImage.reason, "unsupported_type");
});
