import { ArrowLeft, BookOpen, CircleAlert, ExternalLink, MessageCircleQuestion, RefreshCw, Scale, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { ArticleResponse, CachedArticle, EventResponse, MediaResponse, QaAnswer } from "./api";
import { articleErrorMessage, fetchJson, ServiceError } from "./api";
import { AppFrame } from "./App";
import { eventDate, kindLabel, statusLabel } from "./format";
import { COMPARE_LIMIT, parseTimelineParams, serializeTimelineParams, toggleCompare } from "./timeline-model";

export function EventPage() {
  const { eventId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const returnValue = new URLSearchParams(location.search).get("return");
  const returnTarget = returnValue?.startsWith("?") ? `/${returnValue}` : "/";
  const returnState = parseTimelineParams(returnValue?.startsWith("?") ? returnValue.slice(1) : "");
  const inCompare = returnState.compare.includes(eventId);
  const compareUpdate = toggleCompare(returnState.compare, eventId);
  const compareFull = compareUpdate.kind === "full";

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

  const toggleCompareHere = () => {
    if (compareFull) return;
    const next = serializeTimelineParams({ ...returnState, compare: compareUpdate.next, focus: eventId });
    navigate(`/${next ? `?${next}` : ""}`);
  };

  return <AppFrame serviceState={error ? "offline" : eventDetail ? "ready" : "checking"}>
    <main className="event-page">
      <Link className="back-link" to={returnTarget}><ArrowLeft size={16} />返回时间线</Link>
      {error ? <div className="state-panel error"><CircleAlert size={22} /><h2>无法读取事件</h2><p>{error}</p></div> : eventDetail ? <article className="event-detail">
        <p className="eyebrow">事件详情 · P5 真实只读样本</p>
        <h2>{eventDetail.event.title_zh}</h2>
        <div className="event-meta">
          <span>{eventDate(eventDetail.event)}</span>
          <span>{kindLabel(eventDetail.event.event_kind)}</span>
          <span className={`status-chip is-${eventDetail.event.data_status}`}>{statusLabel(eventDetail.event.data_status)}</span>
          <button
            type="button"
            className={`compare-toggle${inCompare ? " is-in" : ""}`}
            disabled={compareFull}
            title={compareFull ? `最多同时比较 ${COMPARE_LIMIT} 个事件` : undefined}
            aria-pressed={inCompare}
            onClick={toggleCompareHere}
          ><Scale size={14} />{inCompare ? "移出对比" : "加入对比"}（{returnState.compare.length}/{COMPARE_LIMIT}）</button>
        </div>
        <div className="coverage-notice"><CircleAlert size={16} /><span>事件来自 P1 真实只读抽样；尚未逐条核验外部参考页，数据状态反映当前证据强度。</span></div>
        <div className="event-layout">
          <div className="event-main">
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
            <section className="qa-section" aria-labelledby="qa-heading">
              <div><p className="eyebrow">不保存会话</p><h3 id="qa-heading">临时追问</h3></div>
              <p className="qa-note">回答仅保留在当前页面内存中，刷新或离开后清空。</p>
              <form onSubmit={askQuestion}><label htmlFor="event-question">问题</label><div><textarea id="event-question" rows={3} maxLength={500} value={question} onChange={(changeEvent) => setQuestion(changeEvent.target.value)} placeholder="针对当前事件提出问题" /><button type="submit" disabled={asking || question.trim().length < 2} aria-label="发送问题"><Send size={17} /></button></div></form>
              {qaError && <div className="inline-error" role="alert"><CircleAlert size={16} /><span>{qaError}</span></div>}
              {qaAnswer && <div className="qa-answer"><MessageCircleQuestion size={20} /><div><p>{qaAnswer.answer_zh}</p>{qaAnswer.revision_request && <div className="revision-request">已形成待审核修订请求，尚未修改时间线数据。</div>}<div className="qa-sources">{qaAnswer.citations.map((citation) => <a key={citation.evidence_id} href={citation.source_url} target="_blank" rel="noreferrer">{citation.publisher}<ExternalLink size={12} /></a>)}</div></div></div>}
            </section>
          </div>
          <aside className="event-aside" aria-label="事实摘要">
            <h3>事实摘要</h3>
            <dl>
              <div><dt>时间</dt><dd>{eventDate(eventDetail.event)}</dd></div>
              <div><dt>类型</dt><dd>{kindLabel(eventDetail.event.event_kind)}</dd></div>
              <div><dt>数据状态</dt><dd>{eventDetail.event.data_status}</dd></div>
              <div><dt>地区关联</dt><dd>{eventDetail.event.region_refs.length} 条</dd></div>
              <div><dt>时间线位置</dt><dd>{eventDetail.placements.length} 条</dd></div>
            </dl>
            <p className="aside-note">事实字段来自本地 JSONL 事实源；修订需经过审核流程。</p>
          </aside>
        </div>
      </article> : <div className="state-panel"><p>正在读取事件</p></div>}
    </main>
  </AppFrame>;
}
