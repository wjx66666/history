import { ArrowLeft, BookOpen, ChevronRight, CircleAlert, ExternalLink, MessageCircleQuestion, RefreshCw, Search, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type { EventPlacement, Period, Region, TemporalValue, TimelineEvent } from "../shared/timeline";

type ServiceState = "checking" | "ready" | "offline";
interface TimelinePlacement { placement: EventPlacement; event: TimelineEvent; region: Region }
interface TimelineResponse { state: "built" | "checked_empty"; period?: Period; periods?: Period[]; regions: Region[]; placements: TimelinePlacement[] }
interface PeriodResponse { period: Period; children: Period[] }
interface SearchResponse { query: string; result_type: "event"; events: TimelineEvent[] }
interface EventResponse { event: TimelineEvent; placements: EventPlacement[] }
interface CachedArticle {
  event_id: string;
  content_zh: string;
  citations: Array<{ evidence_id: string; source_url: string; publisher: string }>;
  uncertainty: string | null;
  link_refs: Array<{ kind: "event" | "region"; target_id: string; label_zh: string }>;
  generated_at: string;
}
interface ArticleResponse { article: CachedArticle; cache: "hit" | "generated" }
interface CachedImage {
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
interface MediaResponse { state: "cached" | "no_image"; images: CachedImage[] }
interface QaAnswer {
  answer_zh: string;
  citations: Array<{ evidence_id: string; source_url: string; publisher: string }>;
  revision_request: { event_id: string; prompt: string } | null;
}

class ServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

function yearLabel(value: Pick<TemporalValue, "era" | "year">): string {
  return value.era === "BCE" ? `公元前 ${value.year} 年` : `公元 ${value.year} 年`;
}

function spanBounds(period: Period): [number, number] {
  if (period.time_span.kind !== "range") return [0, 1];
  return [period.time_span.start.year_ordinal, period.time_span.end_exclusive.year_ordinal];
}

function eventOrdinal(event: TimelineEvent): number {
  return event.time_span.kind === "point" ? event.time_span.at.year_ordinal : event.time_span.start.year_ordinal;
}

function eventDate(event: TimelineEvent): string {
  const format = (value: TemporalValue): string => {
    if (value.precision === "century") {
      const century = Math.ceil(value.year / 100);
      return `${value.approx ? "约 " : ""}${value.era === "BCE" ? "公元前 " : "公元 "}${century} 世纪`;
    }
    if (value.precision === "decade") return `${value.approx ? "约 " : ""}${yearLabel(value)}代`;
    return `${value.approx ? "约 " : ""}${yearLabel(value)}${value.month ? `${value.month} 月` : ""}${value.day ? `${value.day} 日` : ""}`;
  };
  if (event.time_span.kind === "point") return format(event.time_span.at);
  const { start, end_exclusive: end } = event.time_span;
  if (start.precision === "century" && end.precision === "century") return format(start);
  if (end.precision === "year" && !end.month && !end.day) {
    const ordinal = end.year_ordinal - 1;
    const lastYear = ordinal <= 0 ? { era: "BCE" as const, year: 1 - ordinal } : { era: "CE" as const, year: ordinal };
    return `${format(start)}至${format({ ...end, ...lastYear })}`;
  }
  if (end.precision === "day" && end.day && end.day > 1) return `${format(start)}至${format({ ...end, day: end.day - 1 })}`;
  return `${format(start)}至${format(end)}（不含终点）`;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined);
  const payload = await response.json() as T & { code?: string; message?: string };
  if (!response.ok) throw new ServiceError(payload.code ?? "request_failed", payload.message ?? payload.code ?? "请求失败");
  return payload;
}

function articleErrorMessage(reason: unknown): string {
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

function AppFrame({ children, serviceState }: { children: React.ReactNode; serviceState: ServiceState }) {
  return <div className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">个人历史研究</p><h1>全球历史时间线</h1></div>
      <span className={`service-state service-state--${serviceState}`}>{serviceState === "ready" ? "本地索引已连接" : serviceState === "checking" ? "正在读取索引" : "本地服务不可用"}</span>
    </header>
    {children}
  </div>;
}

function TimelinePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const periodId = params.get("period");
  const selectedRegions = params.get("regions")?.split(",").filter(Boolean) ?? [];
  const [serviceState, setServiceState] = useState<ServiceState>("checking");
  const [timeline, setTimeline] = useState<TimelineResponse>();
  const [periodDetail, setPeriodDetail] = useState<PeriodResponse>();
  const [error, setError] = useState<string>();
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<TimelineEvent[]>();

  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    navigate({ pathname: "/", search: next.toString() }, { replace: false });
  }, [location.search, navigate]);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    const load = async () => {
      const root = await fetchJson<TimelineResponse>("/api/timeline", controller.signal);
      const selectedPeriod = periodId ?? root.periods?.[0]?.period_id;
      if (!selectedPeriod) throw new Error("时间线没有可用的根时间段");
      const regionQuery = selectedRegions.length > 0 ? `&regions=${encodeURIComponent(selectedRegions.join(","))}` : "";
      return Promise.all([
        fetchJson<TimelineResponse>(`/api/timeline?period_id=${encodeURIComponent(selectedPeriod)}${regionQuery}`, controller.signal),
        fetchJson<PeriodResponse>(`/api/periods/${encodeURIComponent(selectedPeriod)}`, controller.signal),
        Promise.resolve(root),
      ]);
    };
    load().then(([timelineData, detail, root]) => {
      setTimeline(timelineData);
      setPeriodDetail(detail);
      setServiceState("ready");
      if (!periodId && root.periods?.[0]) updateParams({ period: root.periods[0].period_id });
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setServiceState("offline");
      setError(reason instanceof Error ? reason.message : "本地服务不可用");
    });
    return () => controller.abort();
  }, [location.search, periodId, updateParams]);

  const toggleRegion = (regionId: string) => {
    const next = new Set(selectedRegions.length === 0 ? lanes.map((region) => region.region_id) : selectedRegions);
    next.has(regionId) ? next.delete(regionId) : next.add(regionId);
    const allSelected = lanes.length > 0 && next.size === lanes.length;
    updateParams({ regions: allSelected || next.size === 0 ? undefined : [...next].join(",") });
  };

  const submitSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    try {
      const result = await fetchJson<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`);
      setSearchResults(result.events);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "搜索失败");
    }
  };

  const currentPeriod = timeline?.period;
  const lanes = timeline?.regions ?? [];
  const uniqueEvents = new Set(timeline?.placements.map((item) => item.event.event_id) ?? []).size;
  const datedEvents = [...new Map(timeline?.placements.map((item) => [item.event.event_id, item.event]) ?? []).values()];
  const [start, end] = currentPeriod ? spanBounds(currentPeriod) : [0, 1];
  const visibleLanes = lanes.filter((region) => timeline?.placements.some((item) => item.region.region_id === region.region_id));

  const returnSearch = location.search || (currentPeriod ? `?period=${encodeURIComponent(currentPeriod.period_id)}` : "");

  return (
    <AppFrame serviceState={serviceState}>
      <main className="workspace">
        <aside className="filters" aria-label="时间线筛选">
          <h2>浏览范围</h2>
          <div className="coverage-notice"><CircleAlert size={16} /><span>当前展示首批真实只读样本；全球批次仍在构建，薄弱来源已标记。</span></div>
          <div className="filter-section">
            <div className="filter-title"><span>地区泳道</span><button type="button" onClick={() => updateParams({ regions: undefined })}>清除</button></div>
            {lanes.map((region) => <label className="region-option" key={region.region_id}><input type="checkbox" checked={selectedRegions.length === 0 || selectedRegions.includes(region.region_id)} onChange={() => toggleRegion(region.region_id)} /><span>{region.name_zh}</span></label>)}
          </div>
          <form className="search-form" onSubmit={submitSearch}>
            <label htmlFor="timeline-search">搜索事件或人物</label>
            <div className="search-input"><Search size={16} /><input id="timeline-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="输入中文关键词" /><button type="submit" aria-label="搜索"><ChevronRight size={17} /></button></div>
          </form>
          {searchResults && <div className="search-results"><div className="filter-title"><span>搜索结果</span><button type="button" aria-label="关闭搜索结果" onClick={() => setSearchResults(undefined)}><X size={15} /></button></div>{searchResults.length === 0 ? <p>没有匹配事件</p> : searchResults.map((event) => <Link key={event.event_id} to={`/event/${event.event_id}?return=${encodeURIComponent(returnSearch)}`}>{event.title_zh}<small>{eventDate(event)}</small></Link>)}</div>}
        </aside>
        <section className="timeline" aria-labelledby="timeline-heading">
          <nav className="breadcrumbs" aria-label="时间线层级"><button type="button" onClick={() => updateParams({ period: "period_global_sample" })}>全球样本根段</button>{periodId !== "period_global_sample" && <><ChevronRight size={14} /><span>{currentPeriod?.title_zh}</span></>}</nav>
          <div className="timeline-heading"><div><p className="eyebrow">预制时间段</p><h2 id="timeline-heading">{currentPeriod?.title_zh ?? "读取时间线"}</h2></div><span>数据版本：P5 首批样本</span></div>
          {error ? <div className="state-panel error"><CircleAlert size={22} /><h3>无法读取此时间段</h3><p>{error}</p></div> : timeline?.state === "checked_empty" ? <div className="state-panel"><h3>已按来源范围检查，此段为空</h3><p>这是有查询范围记录的空段，与尚未构建不同。</p></div> : currentPeriod && <>
            <div className="timeline-summary" aria-label="当前范围概览"><div><strong>{uniqueEvents}</strong><span>收录事件</span></div><div><strong>{visibleLanes.length}</strong><span>有记录的地区</span></div><div><strong>{periodDetail?.children.length ?? 0}</strong><span>下级时段</span></div><p>首批抽样资料，尚未完成全球和逐十年覆盖。事件日期与地区仍待进一步来源核验。</p></div>
            <div className="axis" aria-label="事件年份比例刻度"><span>{currentPeriod.time_span.kind === "range" ? yearLabel(currentPeriod.time_span.start) : ""}</span><div className="axis-line">{datedEvents.map((event) => <i key={event.event_id} title={`${event.title_zh} · ${eventDate(event)}`} style={{ left: `${Math.max(0, Math.min(100, (eventOrdinal(event) - start) / (end - start) * 100))}%` }} />)}</div><span>{currentPeriod.time_span.kind === "range" ? yearLabel(currentPeriod.time_span.end_exclusive) : ""}</span></div>
            {periodDetail?.children.length ? <div className="period-row" aria-label="下一层时间段">{periodDetail.children.map((child) => { const [childStart, childEnd] = spanBounds(child); const count = new Set(timeline.placements.filter((item) => { const ordinal = eventOrdinal(item.event); return ordinal >= childStart && ordinal < childEnd; }).map((item) => item.event.event_id)).size; return <button key={child.period_id} onClick={() => updateParams({ period: child.period_id })}><span>{child.title_zh}</span><small>{yearLabel(child.time_span.kind === "range" ? child.time_span.start : currentPeriod.time_span.kind === "range" ? currentPeriod.time_span.start : { era: "CE", year: 1 })} · {count} 条样本</small></button>; })}</div> : <div className="terminal-scale">当前已是首批样本的最细预制层级</div>}
            <div className="lane-section-title"><h3>地区与事件</h3><span>按年代排列 · 同一事件可出现在多个地区</span></div>
            <div className="lanes">{lanes.map((region) => { const items = timeline.placements.filter((item) => item.region.region_id === region.region_id); return <div className="lane" key={region.region_id}><div className="lane-label"><strong>{region.name_zh}</strong><span>{items.length ? `${items.length} 条事件` : "当前时段暂无样本"}</span></div><div className="lane-track">{items.length ? items.map((item) => <Link className="event-node" data-event-id={item.event.event_id} key={item.placement.placement_id} to={`/event/${item.event.event_id}?return=${encodeURIComponent(returnSearch)}`}><span>{item.event.title_zh}</span><small>{eventDate(item.event)} · {item.event.data_status === "insufficient" ? "来源不足" : "待核验"}</small><ChevronRight size={16} aria-hidden="true" /></Link>) : <span className="lane-empty">此处没有已导入事件，不代表该地区历史上没有事件。</span>}</div></div>; })}</div>
          </>}
        </section>
      </main>
    </AppFrame>
  );
}

function EventPage() {
  const { eventId = "" } = useParams();
  const location = useLocation();
  const returnValue = new URLSearchParams(location.search).get("return");
  const returnTarget = returnValue?.startsWith("?") ? `/${returnValue}` : "/";
  const [eventDetail, setEventDetail] = useState<EventResponse>();
  const [error, setError] = useState<string>();
  const [article, setArticle] = useState<CachedArticle>();
  const [articleState, setArticleState] = useState<"loading" | "none" | "ready" | "failed">("loading");
  const [articleMessage, setArticleMessage] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const [media, setMedia] = useState<MediaResponse>();
  const [mediaError, setMediaError] = useState(false);
  const [question, setQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState<QaAnswer>();
  const [qaError, setQaError] = useState<string>();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<EventResponse>(`/api/events/${encodeURIComponent(eventId)}`, controller.signal)
      .then(setEventDetail)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "事件读取失败");
      });
    return () => controller.abort();
  }, [eventId]);

  useEffect(() => {
    const controller = new AbortController();
    setMedia(undefined);
    setMediaError(false);
    fetchJson<MediaResponse>(`/api/media/${encodeURIComponent(eventId)}`, controller.signal)
      .then(setMedia)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setMediaError(true);
      });
    return () => controller.abort();
  }, [eventId]);

  useEffect(() => {
    const controller = new AbortController();
    setArticle(undefined);
    setArticleMessage(undefined);
    setArticleState("loading");
    fetchJson<ArticleResponse>(`/api/articles/${encodeURIComponent(eventId)}`, controller.signal)
      .then((result) => {
        setArticle(result.article);
        setArticleState("ready");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (reason instanceof ServiceError && reason.code === "article_none") {
          setArticleState("none");
          return;
        }
        setArticleState("failed");
        setArticleMessage(articleErrorMessage(reason));
      });
    return () => controller.abort();
  }, [eventId]);

  const generateArticle = async (force: boolean) => {
    setGenerating(true);
    setArticleMessage(undefined);
    try {
      const response = await fetch(`/api/articles/${encodeURIComponent(eventId)}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const payload = await response.json() as ArticleResponse & { code?: string; message?: string };
      if (!response.ok) throw new ServiceError(payload.code ?? "request_failed", payload.message ?? payload.code ?? "讲解生成失败");
      setArticle(payload.article);
      setArticleState("ready");
    } catch (reason) {
      setArticleMessage(articleErrorMessage(reason));
      if (!article) setArticleState("failed");
    } finally {
      setGenerating(false);
    }
  };

  const askQuestion = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    const normalized = question.trim();
    if (normalized.length < 2) return;
    setAsking(true);
    setQaError(undefined);
    setQaAnswer(undefined);
    try {
      const response = await fetch(`/api/qa/${encodeURIComponent(eventId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: normalized }) });
      const payload = await response.json() as { answer?: QaAnswer; code?: string; message?: string };
      if (!response.ok || !payload.answer) throw new ServiceError(payload.code ?? "qa_failed", payload.message ?? payload.code ?? "临时追问失败");
      setQaAnswer(payload.answer);
      setQuestion("");
    } catch (reason) {
      setQaError(articleErrorMessage(reason).replaceAll("讲解", "问答"));
    } finally { setAsking(false); }
  };

  return <AppFrame serviceState={error ? "offline" : eventDetail ? "ready" : "checking"}>
    <main className="event-page">
      <Link className="back-link" to={returnTarget}><ArrowLeft size={16} />返回时间线</Link>
      {error ? <div className="state-panel error"><CircleAlert size={22} /><h2>无法读取事件</h2><p>{error}</p></div> : eventDetail ? <article className="event-detail">
        <p className="eyebrow">事件详情 · P5 真实只读样本</p>
        <h2>{eventDetail.event.title_zh}</h2>
        <dl>
          <div><dt>时间</dt><dd>{eventDate(eventDetail.event)}</dd></div>
          <div><dt>数据状态</dt><dd>{eventDetail.event.data_status}</dd></div>
          <div><dt>地区关联</dt><dd>{eventDetail.event.region_refs.length} 条</dd></div>
          <div><dt>时间线位置</dt><dd>{eventDetail.placements.length} 条</dd></div>
        </dl>
        <div className="coverage-notice"><CircleAlert size={16} /><span>事件来自 P1 真实只读抽样；尚未逐条核验外部参考页，数据状态反映当前证据强度。</span></div>
        <section className="media-section" aria-labelledby="media-heading">
          <div><p className="eyebrow">许可媒体</p><h3 id="media-heading">事件图片</h3></div>
          {!media && !mediaError && <div className="media-empty"><p>正在读取本地图片</p></div>}
          {media?.state === "no_image" && <div className="media-empty"><p>暂无可用图片</p><small>没有许可明确且已缓存的图片，正文仍可正常阅读。</small></div>}
          {mediaError && <div className="media-empty media-empty--error"><p>图片暂时无法读取</p><small>图片失败不会影响事件和讲解正文。</small></div>}
          {media?.state === "cached" && <div className="media-grid">{media.images.map((image) => <figure key={image.image_id}>
            <img src={`/api/media/${encodeURIComponent(eventId)}/${encodeURIComponent(image.image_id)}/content`} alt={image.caption_zh} width={image.dimensions.width} height={image.dimensions.height} />
            <figcaption><strong>{image.caption_zh}</strong><span>{image.author} · {image.publisher}</span><span><a href={image.source_url} target="_blank" rel="noreferrer">原始页面 <ExternalLink size={12} /></a><a href={image.license_url} target="_blank" rel="noreferrer">{image.license} <ExternalLink size={12} /></a></span></figcaption>
          </figure>)}</div>}
        </section>
        <section className="article-section" aria-labelledby="article-heading">
          <div className="article-heading">
            <div><p className="eyebrow">本地缓存</p><h3 id="article-heading">事件讲解</h3></div>
            {article && <button type="button" disabled={generating} onClick={() => generateArticle(true)}><RefreshCw size={15} className={generating ? "spin" : undefined} />重新生成</button>}
          </div>
          {articleState === "loading" && <div className="article-empty"><p>正在读取讲解缓存</p></div>}
          {articleState === "none" && <div className="article-empty"><BookOpen size={22} /><h4>尚无讲解</h4><p>生成前需要可核验来源和已配置的模型服务。</p><button type="button" disabled={generating} onClick={() => generateArticle(false)}><BookOpen size={15} />{generating ? "正在生成" : "生成讲解"}</button></div>}
          {articleState === "failed" && !article && <div className="article-empty article-empty--error"><CircleAlert size={22} /><h4>讲解暂不可用</h4>{articleMessage && <p role="alert">{articleMessage}</p>}<button type="button" disabled={generating} onClick={() => generateArticle(false)}><RefreshCw size={15} className={generating ? "spin" : undefined} />重试</button></div>}
          {article && <div className="article-content">
            {articleMessage && <div className="inline-error" role="alert"><CircleAlert size={16} /><span>{articleMessage}</span></div>}
            <p className="article-body">{article.content_zh}</p>
            {article.uncertainty && <div className="uncertainty"><strong>争议与不确定性</strong><p>{article.uncertainty}</p></div>}
            <div className="sources"><h4>来源</h4>{article.citations.map((citation) => <a key={citation.evidence_id} href={citation.source_url} target="_blank" rel="noreferrer"><span>{citation.publisher}</span><ExternalLink size={14} /></a>)}</div>
            {article.link_refs.length > 0 && <div className="related-links"><h4>已有事件链接</h4>{article.link_refs.map((link) => <Link key={`${link.kind}:${link.target_id}`} to={link.kind === "event" ? `/event/${link.target_id}` : returnTarget}>{link.label_zh}</Link>)}</div>}
          </div>}
        </section>
        <section className="qa-section" aria-labelledby="qa-heading">
          <div><p className="eyebrow">不保存会话</p><h3 id="qa-heading">临时追问</h3></div>
          <p className="qa-note">回答仅保留在当前页面内存中，刷新或离开后清空。</p>
          <form onSubmit={askQuestion}><label htmlFor="event-question">问题</label><div><textarea id="event-question" rows={3} maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="针对当前事件提出问题" /><button type="submit" disabled={asking || question.trim().length < 2} aria-label="发送问题"><Send size={17} /></button></div></form>
          {qaError && <div className="inline-error" role="alert"><CircleAlert size={16} /><span>{qaError}</span></div>}
          {qaAnswer && <div className="qa-answer"><MessageCircleQuestion size={20} /><div><p>{qaAnswer.answer_zh}</p>{qaAnswer.revision_request && <div className="revision-request">已形成待审核修订请求，尚未修改时间线数据。</div>}<div className="qa-sources">{qaAnswer.citations.map((citation) => <a key={citation.evidence_id} href={citation.source_url} target="_blank" rel="noreferrer">{citation.publisher}<ExternalLink size={12} /></a>)}</div></div></div>}
        </section>
      </article> : <div className="state-panel"><p>正在读取事件</p></div>}
    </main>
  </AppFrame>;
}

export function App() {
  return <Routes>
    <Route path="/" element={<TimelinePage />} />
    <Route path="/event/:eventId" element={<EventPage />} />
    <Route path="*" element={<AppFrame serviceState="offline"><main className="event-page"><div className="state-panel error"><h2>页面不存在</h2><Link to="/">返回时间线</Link></div></main></AppFrame>} />
  </Routes>;
}
