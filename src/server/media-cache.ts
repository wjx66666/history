import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ALLOWED_LICENSES = new Set(["CC0-1.0", "PDM-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"]);
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

export type MediaErrorCode = "license_unknown" | "invalid_metadata" | "download_failed" | "media_too_large" | "invalid_media";

export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaError";
  }
}

export interface ImageCandidate {
  image_id: string;
  event_id: string;
  download_url: string;
  source_url: string;
  publisher: string;
  author: string;
  license: string;
  license_url: string;
  caption_zh: string;
  evidence_id: string;
}

export interface CachedImage extends Omit<ImageCandidate, "download_url"> {
  local_path: string;
  retrieved_at: string;
  dimensions: { width: number; height: number };
  mime: "image/png" | "image/jpeg";
  byte_size: number;
}

export interface MediaCacheOptions {
  directory: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
}

function assertId(value: string, prefix: "event" | "image"): void {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]*$`).test(value)) throw new MediaError("invalid_metadata", `Invalid ${prefix} ID`);
}

function httpsUrl(value: string, label: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url;
  } catch {
    throw new MediaError("invalid_metadata", `${label} must be an HTTPS URL`);
  }
}

function dimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  if (mime === "image/png") {
    const hasSignature = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
    const hasEndChunk = bytes.length >= 12 && [73, 69, 78, 68, 174, 66, 96, 130].every((value, index) => bytes[bytes.length - 8 + index] === value);
    if (bytes.length < 45 || !hasSignature || !hasEndChunk) throw new MediaError("invalid_media", "PNG structure is incomplete");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new MediaError("invalid_media", "JPEG signature is invalid");
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      const length = (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: (bytes[offset + 7]! << 8) + bytes[offset + 8]!, height: (bytes[offset + 5]! << 8) + bytes[offset + 6]! };
      if (length < 2) break;
      offset += length + 2;
    }
    throw new MediaError("invalid_media", "JPEG dimensions are unavailable");
  }
  throw new MediaError("invalid_media", "Unsupported image type");
}

function validateMetadata(candidate: ImageCandidate): void {
  assertId(candidate.event_id, "event");
  assertId(candidate.image_id, "image");
  httpsUrl(candidate.download_url, "download_url");
  httpsUrl(candidate.source_url, "source_url");
  httpsUrl(candidate.license_url, "license_url");
  if (!ALLOWED_LICENSES.has(candidate.license)) throw new MediaError("license_unknown", "Image license is not explicitly allowed");
  if (![candidate.publisher, candidate.author, candidate.caption_zh, candidate.evidence_id].every((value) => value.trim().length > 0)) throw new MediaError("invalid_metadata", "Image attribution metadata is incomplete");
}

export class MediaCache {
  readonly #maxBytes: number;
  readonly #timeoutMs: number;
  readonly #fetcher: typeof fetch;
  readonly #now: () => Date;

  constructor(private readonly options: MediaCacheOptions) {
    this.#maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  #eventDirectory(eventId: string): string {
    assertId(eventId, "event");
    return join(this.options.directory, eventId);
  }

  async list(eventId: string): Promise<CachedImage[]> {
    const directory = this.#eventDirectory(eventId);
    let entries: string[];
    try { entries = await readdir(directory); } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw reason;
    }
    const images: CachedImage[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const image = JSON.parse(await readFile(join(directory, entry), "utf8")) as CachedImage;
      assertId(image.image_id, "image");
      if (image.event_id !== eventId || !EXTENSIONS[image.mime]) throw new MediaError("invalid_media", "Cached image metadata is invalid");
      images.push(image);
    }
    return images;
  }

  async content(eventId: string, imageId: string): Promise<{ metadata: CachedImage; bytes: Buffer } | undefined> {
    assertId(eventId, "event");
    assertId(imageId, "image");
    const image = (await this.list(eventId)).find((item) => item.image_id === imageId);
    if (!image) return undefined;
    try { return { metadata: image, bytes: await readFile(join(this.#eventDirectory(eventId), image.local_path)) }; }
    catch (reason) { if ((reason as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw reason; }
  }

  async cache(candidate: ImageCandidate): Promise<CachedImage> {
    validateMetadata(candidate);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try { response = await this.#fetcher(candidate.download_url, { signal: controller.signal, redirect: "error" }); }
    catch (cause) { throw new MediaError("download_failed", "Image download failed", { cause }); }
    finally { clearTimeout(timer); }
    if (!response.ok) throw new MediaError("download_failed", `Image download returned ${response.status}`);
    const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    const extension = EXTENSIONS[mime];
    if (!extension) throw new MediaError("invalid_media", "Image response type is unsupported");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.#maxBytes) throw new MediaError("media_too_large", "Image exceeds the size limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.#maxBytes) throw new MediaError("media_too_large", "Image exceeds the size limit");
    const size = dimensions(bytes, mime);
    if (size.width < 1 || size.height < 1) throw new MediaError("invalid_media", "Image dimensions are invalid");

    const directory = this.#eventDirectory(candidate.event_id);
    await mkdir(directory, { recursive: true });
    const localPath = `${candidate.image_id}.${extension}`;
    const metadata: CachedImage = { ...candidate, local_path: localPath, retrieved_at: this.#now().toISOString(), dimensions: size, mime: mime as CachedImage["mime"], byte_size: bytes.byteLength };
    delete (metadata as Partial<ImageCandidate>).download_url;
    const suffix = randomUUID();
    const tempImage = join(directory, `${localPath}.${suffix}.tmp`);
    const tempMetadata = join(directory, `${candidate.image_id}.json.${suffix}.tmp`);
    try {
      await writeFile(tempImage, bytes, { flag: "wx" });
      await writeFile(tempMetadata, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
      await rename(tempImage, join(directory, localPath));
      await rename(tempMetadata, join(directory, `${candidate.image_id}.json`));
    } catch (reason) {
      await Promise.all([rm(tempImage, { force: true }), rm(tempMetadata, { force: true })]);
      throw reason;
    }
    return metadata;
  }
}
