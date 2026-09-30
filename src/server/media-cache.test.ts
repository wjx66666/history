import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaCache, MediaError, type ImageCandidate } from "./media-cache.js";

const directories: string[] = [];
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const candidate: ImageCandidate = {
  image_id: "image_fixture",
  event_id: "event_fixture_shared",
  download_url: "https://example.test/image.png",
  source_url: "https://example.test/object",
  publisher: "Fixture Museum",
  author: "Fixture Author",
  license: "CC-BY-4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  caption_zh: "仅用于测试的图片",
  evidence_id: "evid_fixture",
};

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "timeline-media-"));
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("media cache", () => {
  it("rejects an unknown license before downloading", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const cache = new MediaCache({ directory: directory(), fetcher });
    await expect(cache.cache({ ...candidate, license: "unknown" })).rejects.toMatchObject<Partial<MediaError>>({ code: "license_unknown" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stores complete metadata and serves cached bytes without the network", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(png, { headers: { "content-type": "image/png" } }));
    const cache = new MediaCache({ directory: directory(), fetcher, now: () => new Date("2026-09-30T00:00:00Z") });
    const stored = await cache.cache(candidate);
    expect(stored).toMatchObject({ local_path: "image_fixture.png", mime: "image/png", dimensions: { width: 1, height: 1 }, byte_size: png.byteLength });
    expect(stored).not.toHaveProperty("download_url");
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await cache.list(candidate.event_id)).toEqual([stored]);
    expect((await cache.content(candidate.event_id, candidate.image_id))?.bytes).toEqual(Buffer.from(png));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched image content and leaves no cache entry", async () => {
    const cache = new MediaCache({ directory: directory(), fetcher: async () => new Response("not an image", { headers: { "content-type": "image/png" } }) });
    await expect(cache.cache(candidate)).rejects.toMatchObject<Partial<MediaError>>({ code: "invalid_media" });
    expect(await cache.list(candidate.event_id)).toEqual([]);
  });

  it("rejects declared and actual content above the size limit", async () => {
    const declared = new MediaCache({ directory: directory(), maxBytes: 8, fetcher: async () => new Response(png, { headers: { "content-type": "image/png", "content-length": "29" } }) });
    await expect(declared.cache(candidate)).rejects.toMatchObject<Partial<MediaError>>({ code: "media_too_large" });
    const actual = new MediaCache({ directory: directory(), maxBytes: 8, fetcher: async () => new Response(png, { headers: { "content-type": "image/png" } }) });
    await expect(actual.cache(candidate)).rejects.toMatchObject<Partial<MediaError>>({ code: "media_too_large" });
  });

  it("rejects non-HTTPS source and download URLs", async () => {
    const cache = new MediaCache({ directory: directory(), fetcher: vi.fn<typeof fetch>() });
    await expect(cache.cache({ ...candidate, source_url: "http://example.test/object" })).rejects.toMatchObject<Partial<MediaError>>({ code: "invalid_metadata" });
    await expect(cache.cache({ ...candidate, download_url: "file:///local/image.png" })).rejects.toMatchObject<Partial<MediaError>>({ code: "invalid_metadata" });
  });
});
