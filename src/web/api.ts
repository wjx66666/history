import type { EventPlacement, Period, Region, TimelineEvent } from "../shared/timeline";

export type ServiceState = "checking" | "ready" | "offline";

export interface TimelinePlacement { placement: EventPlacement; event: TimelineEvent; region: Region }
export interface TimelineResponse { state: "built" | "checked_empty"; period?: Period; periods?: Period[]; regions: Region[]; placements: TimelinePlacement[] }
export interface PeriodResponse { period: Period; children: Period[] }
export interface SearchResponse { query: string; result_type: "event"; events: TimelineEvent[] }
export interface EventResponse { event: TimelineEvent; placements: EventPlacement[] }
export interface CachedArticle {
  event_id: string;
  content_zh: string;
  citations: Array<{ evidence_id: string; source_url: string; publisher: string }>;
  uncertainty: string | null;
  link_refs: Array<{ kind: "event" | "region"; target_id: string; label_zh: string }>;
  generated_at: string;
}
export interface ArticleResponse { article: CachedArticle; cache: "hit" | "generated" }
export interface CachedImage {
  image_id: string;
  event_id: string;
  source_url: string;
  publisher: string;
  author: string;
  license: string;
  license_url: string;
  caption_zh: string;
  dimensions: { width: number; height: number };
  mime: string;
}
export interface MediaResponse { state: "cached" | "no_image"; images: CachedImage[] }
export interface QaAnswer {
  answer_zh: string;
  citations: Array<{ evidence_id: string; source_url: string; publisher: string }>;
  revision_request: { event_id: string; prompt: string } | null;
}

export class ServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined);
  const payload = await response.json() as T & { code?: string; message?: string };
  if (!response.ok) throw new ServiceError(payload.code ?? "request_failed", payload.message ?? payload.code ?? "请求失败");
  return payload;
}

export function articleErrorMessage(reason: unknown): string {
  if (!(reason instanceof ServiceError)) return reason instanceof Error ? reason.message : "讲解生成失败";
  const messages: Record<string, string> = {
    offline: "讲解服务当前离线，已有缓存不会被覆盖。",
    provider_timeout: "讲解服务响应超时，请稍后重试。",
    rate_limited: "讲解服务请求过于频繁，请稍后重试。",
    source_insufficient: "当前没有足够的可核验来源，未生成讲解。",
    schema_error: "生成结果未通过结构校验，未写入缓存。",
    invalid_citation: "生成结果包含无效引用，未写入缓存。",
    article_failed: "讲解缓存暂时无法读写。",
  };
  return messages[reason.code] ?? reason.message;
}
