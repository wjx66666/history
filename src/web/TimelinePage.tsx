import { ArrowLeft, ChevronRight, CircleAlert, GitCommitHorizontal, List, Plus, Scale, Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import type { Region, TimelineEvent } from "../shared/timeline";
import type { PeriodResponse, SearchResponse, ServiceState, TimelinePlacement, TimelineResponse } from "./api";
import { fetchJson, ServiceError } from "./api";
import { AppFrame } from "./App";
import { axisYearLabel, buildAxisTicks, COMPARE_LIMIT, comparisonSummary, eventRange, filterByStatus, formatDuration, parseTimelineParams, periodRange, toggleCompare } from "./timeline-model";
import type { DataStatus } from "./timeline-model";
import { eventDate, kindLabel, statusLabel } from "./format";
import { useElementWidth, useMediaQuery } from "./hooks";
import { layoutLane } from "./timeline-layout";
import type { LaneItemInput } from "./timeline-layout";

const LAYER_HEIGHT_PX = 19;
const TRACK_ZONE_PX = 26;

function shortYearLabel(event: TimelineEvent): string {
  const compact = (ordinal: number, approx: boolean) => `${approx ? "约" : ""}${axisYearLabel(ordinal)}`;
  if (event.time_span.kind === "point") {
    return compact(event.time_span.at.year_ordinal, event.time_span.at.approx);
  }
  const { start, end_exclusive: end } = event.time_span;
  const endOrdinal = end.precision === "year" && !end.month && !end.day ? end.year_ordinal - 1 : end.year_ordinal;
  if (endOrdinal === start.year_ordinal) return compact(start.year_ordinal, start.approx);
  return `${compact(start.year_ordinal, start.approx)}–${axisYearLabel(endOrdinal)}`;
}

interface LaneEntry extends LaneItemInput {
  event: TimelineEvent;
}

function toLaneEntry(item: TimelinePlacement): LaneEntry {
  const [start, end] = eventRange(item.event);
  return {
    key: item.placement.placement_id,
    eventId: item.event.event_id,
    title: item.event.title_zh,
    yearLabel: shortYearLabel(item.event),
    start,
    end,
    isRange: item.event.time_span.kind === "range",
    event: item.event,
  };
}

function LaneRow({ region, entries, spanStart, spanEnd, activeEventId, focusId, compareIds, onFocusEvent, onHoverEvent }: {
  region: Region;
  entries: LaneEntry[];
  spanStart: number;
  spanEnd: number;
  activeEventId: string | null;
  focusId: string | null;
  compareIds: string[];
  onFocusEvent: (eventId: string) => void;
  onHoverEvent: (eventId: string | null) => void;
}) {
  const [canvasRef, canvasWidth] = useElementWidth<HTMLDivElement>();
  const [openCluster, setOpenCluster] = useState<number>(-1);
  const layout = useMemo(
    () => layoutLane(entries, spanStart, spanEnd, canvasWidth),
    [entries, spanStart, spanEnd, canvasWidth],
  );
  const laneHeight = Math.max(1, layout.layersUsed) * LAYER_HEIGHT_PX + TRACK_ZONE_PX + 8;
  const entryByKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

  if (entries.length === 0) {
    return <div className="lane lane--empty" data-region-id={region.region_id}>
      <div className="lane-label"><strong>{region.name_zh}</strong></div>
      <div className="lane-canvas lane-canvas--empty"><span>本段未收录</span></div>
    </div>;
  }

  const markerClass = (eventId: string, isRange: boolean, status: DataStatus) => [
    "lane-marker",
    isRange ? "lane-marker--bar" : "lane-marker--dot",
    `is-${status}`,
    activeEventId === eventId ? "is-active" : "",
    focusId === eventId ? "is-focused" : "",
    compareIds.includes(eventId) ? "is-compared" : "",
  ].filter(Boolean).join(" ");

  return <div className="lane" data-region-id={region.region_id} style={{ "--lane-h": `${laneHeight}px` } as CSSProperties}>
    <div className="lane-label"><strong>{region.name_zh}</strong><span>{entries.length} 条事件</span></div>
    <div className="lane-canvas" ref={canvasRef} style={{ height: laneHeight }}>
      <i className="lane-track-line" aria-hidden="true" />
      {layout.markers.map((marker) => {
        const entry = entryByKey.get(marker.key);
        if (!entry) return null;
        const dateText = eventDate(entry.event);
        return <button
          key={marker.key}
          type="button"
          className={markerClass(marker.eventId, marker.isRange, entry.event.data_status)}
          data-event-id={marker.eventId}
          style={marker.isRange
            ? { left: `${marker.leftPct}%`, width: `${marker.widthPct}%` }
            : { left: `${marker.leftPct}%` }}
          title={`${entry.title} · ${dateText}`}
          aria-label={`${entry.title}，${dateText}，${region.name_zh}`}
          onClick={() => onFocusEvent(marker.eventId)}
          onMouseEnter={() => onHoverEvent(marker.eventId)}
          onMouseLeave={() => onHoverEvent(null)}
          onFocus={() => onHoverEvent(marker.eventId)}
          onBlur={() => onHoverEvent(null)}
        />;
      })}
      {layout.labels.map((label, index) => {
        if (label.kind === "cluster") {
          const clusterEntries = label.keys.map((key) => entryByKey.get(key)).filter((entry): entry is LaneEntry => Boolean(entry));
          return <span key={`cluster-${index}`} className="cluster-wrap" style={{ left: label.leftPx }}>
            <button
              type="button"
              className="cluster-badge"
              aria-expanded={openCluster === index}
              aria-label={`${label.count} 个事件聚合，点击展开列表`}
              onClick={() => setOpenCluster(openCluster === index ? -1 : index)}
            >{label.count}</button>
            {openCluster === index && <span className="cluster-pop" role="group" aria-label="聚合事件列表">
              {clusterEntries.map((entry) => <button
                key={entry.key}
                type="button"
                onClick={() => { setOpenCluster(-1); onFocusEvent(entry.eventId); }}
              ><strong>{entry.title}</strong><small>{eventDate(entry.event)}</small></button>)}
            </span>}
          </span>;
        }
        const entry = entryByKey.get(label.key);
        if (!entry) return null;
        return <button
          key={label.key}
          type="button"
          className={["lane-tag", `is-${entry.event.data_status}`, activeEventId === label.eventId ? "is-active" : "", focusId === label.eventId ? "is-focused" : "", compareIds.includes(label.eventId) ? "is-compared" : ""].filter(Boolean).join(" ")}
          data-event-id={label.eventId}
          style={{ left: label.leftPx, width: label.widthPx, bottom: TRACK_ZONE_PX + label.layer * LAYER_HEIGHT_PX }}
          title={`${entry.title} · ${eventDate(entry.event)}`}
          onClick={() => onFocusEvent(label.eventId)}
          onMouseEnter={() => onHoverEvent(label.eventId)}
          onMouseLeave={() => onHoverEvent(null)}
          onFocus={() => onHoverEvent(label.eventId)}
          onBlur={() => onHoverEvent(null)}
        >{label.text}</button>;
      })}
    </div>
  </div>;
}

function ScaleRow({ spanStart, spanEnd, maxTicks, label }: { spanStart: number; spanEnd: number; maxTicks: number; label?: string }) {
  const ticks = buildAxisTicks(spanStart, spanEnd, maxTicks);
  return <div className="matrix-scale" {...(label ? { "aria-label": label, role: "img" as const } : { "aria-hidden": true })}>
    <div className="scale-corner" />
    <div className="scale-track">
      <span className="scale-end scale-end--start">{axisYearLabel(Math.ceil(spanStart))}</span>
      {ticks.map((tick) => <span key={tick.value} className="scale-tick" style={{ left: `${tick.position * 100}%` }}>{tick.label}</span>)}
      <span className="scale-end scale-end--end">{axisYearLabel(Math.floor(spanEnd))}</span>
    </div>
  </div>;
}

export function TimelinePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const url = useMemo(() => parseTimelineParams(location.search), [location.search]);
  const isMobile = useMediaQuery("(max-width: 779px)");
  const view = url.view ?? (isMobile ? "list" : "timeline");

  const [serviceState, setServiceState] = useState<ServiceState>("checking");
  const [timeline, setTimeline] = useState<TimelineResponse>();
  const [periodDetail, setPeriodDetail] = useState<PeriodResponse>();
  const [loadError, setLoadError] = useState<{ code: string; message: string }>();
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<TimelineEvent[]>();
  const [showEmptyLanes, setShowEmptyLanes] = useState(true);
  const [hoverEventId, setHoverEventId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);

  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    navigate({ pathname: "/", search: next.toString() }, { replace: false });
  }, [location.search, navigate]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(undefined);
    const load = async () => {
      const root = await fetchJson<TimelineResponse>("/api/timeline", controller.signal);
      const selectedPeriod = url.period ?? root.periods?.[0]?.period_id;
      if (!selectedPeriod) throw new ServiceError("no_root_period", "时间线没有可用的根时间段");
      const regionQuery = url.regions.length > 0 ? `&regions=${encodeURIComponent(url.regions.join(","))}` : "";
      const [timelineData, detail] = await Promise.all([
        fetchJson<TimelineResponse>(`/api/timeline?period_id=${encodeURIComponent(selectedPeriod)}${regionQuery}`, controller.signal),
        fetchJson<PeriodResponse>(`/api/periods/${encodeURIComponent(selectedPeriod)}`, controller.signal),
      ]);
      return { timelineData, detail, selectedPeriod, root };
    };
    load().then(({ timelineData, detail, selectedPeriod, root }) => {
      setTimeline(timelineData);
      setPeriodDetail(detail);
      setServiceState("ready");
      if (!url.period && root.periods?.[0]) updateParams({ period: root.periods[0].period_id });
      else if (selectedPeriod !== url.period) updateParams({ period: selectedPeriod });
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (reason instanceof ServiceError && (reason.code === "region_not_found" || reason.code === "period_not_found")) {
        setNotice(reason.code === "region_not_found" ? "链接中的地区参数无效，已恢复显示全部地区。" : "链接中的时段不存在，已回到根时段。");
        updateParams(reason.code === "region_not_found" ? { regions: undefined } : { period: undefined });
        return;
      }
      if (reason instanceof ServiceError && (reason.code === "unbuilt" || reason.code === "source_failed")) {
        setServiceState("ready");
        setTimeline(undefined);
        setPeriodDetail(undefined);
        setLoadError({ code: reason.code, message: reason.message });
        return;
      }
      setServiceState("offline");
      setLoadError({ code: "offline", message: reason instanceof Error ? reason.message : "本地服务不可用" });
    });
    return () => controller.abort();
  }, [location.search, url.period, url.regions, updateParams]);

  const currentPeriod = timeline?.period;
  const parentPeriodId = currentPeriod?.parent_period_id ?? (url.period && url.period !== "period_global_sample" ? "period_global_sample" : undefined);
  const range = currentPeriod ? periodRange(currentPeriod) : null;
  const allPlacements = timeline?.placements ?? [];
  const filteredPlacements = useMemo(() => filterByStatus(allPlacements, url.statuses), [allPlacements, url.statuses]);
  const lanes = timeline?.regions ?? [];
  const eventById = useMemo(() => {
    const map = new Map<string, TimelineEvent>();
    for (const item of filteredPlacements) map.set(item.event.event_id, item.event);
    return map;
  }, [filteredPlacements]);
  const regionName = useMemo(() => {
    const map = new Map<string, string>();
    for (const region of lanes) map.set(region.region_id, region.name_zh);
    return map;
  }, [lanes]);

  const focusEvent = url.focus ? eventById.get(url.focus) : undefined;
  const compareKnown = url.compare.map((id) => eventById.get(id)).filter((event): event is TimelineEvent => Boolean(event));
  const compareMissing = url.compare.filter((id) => !eventById.has(id));
  const compareFull = url.compare.length >= COMPARE_LIMIT;

  useEffect(() => {
    if (!timeline || timeline.state !== "built") return;
    const unknown = url.compare.filter((id) => !eventById.has(id)).length + (url.focus && !eventById.has(url.focus) ? 1 : 0);
    if (unknown > 0) setNotice("链接中包含当前时段没有收录的事件，对比栏已按当前范围展示。");
  }, [timeline, url.compare, url.focus, eventById]);

  const presentStatuses = useMemo(() => {
    const counts = new Map<DataStatus, number>();
    for (const item of allPlacements) counts.set(item.event.data_status, (counts.get(item.event.data_status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allPlacements]);

  const uniqueEvents = eventById.size;
  const lanesWithRecords = lanes.filter((region) => filteredPlacements.some((item) => item.region.region_id === region.region_id)).length;
  const filterActive = url.statuses.length > 0 || url.regions.length > 0 || Boolean(searchResults);
  const activeEventId = hoverEventId ?? focusEvent?.event_id ?? null;
  const activeFraction = (() => {
    if (!activeEventId || !range) return null;
    const event = eventById.get(activeEventId);
    if (!event) return null;
    const [start] = eventRange(event);
    const fraction = (start - range[0]) / (range[1] - range[0]);
    return fraction >= 0 && fraction <= 1 ? fraction : null;
  })();

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const child of periodDetail?.children ?? []) {
      const childRange = periodRange(child);
      if (!childRange) continue;
      const ids = new Set<string>();
      for (const item of filteredPlacements) {
        const [start, end] = eventRange(item.event);
        if (start < childRange[1] && Math.max(end, start) >= childRange[0]) ids.add(item.event.event_id);
      }
      counts.set(child.period_id, ids.size);
    }
    return counts;
  }, [periodDetail, filteredPlacements]);

  const toggleRegion = (regionId: string) => {
    const next = new Set(url.regions.length === 0 ? lanes.map((region) => region.region_id) : url.regions);
    if (next.has(regionId)) next.delete(regionId);
    else next.add(regionId);
    const allSelected = lanes.length > 0 && next.size === lanes.length;
    updateParams({ regions: allSelected || next.size === 0 ? undefined : [...next].join(",") });
  };

  const toggleStatus = (status: DataStatus) => {
    const next = new Set(url.statuses.length === 0 ? presentStatuses.map(([present]) => present) : url.statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    updateParams({ status: next.size === 0 || next.size === presentStatuses.length ? undefined : [...next].join(",") });
  };

  const clearFilters = () => {
    setSearchText("");
    setSearchResults(undefined);
    updateParams({ regions: undefined, status: undefined });
  };

  const submitSearch = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    try {
      const result = await fetchJson<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`);
      setSearchResults(result.events);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "搜索失败");
    }
  };

  const focusEventParam = (eventId: string) => {
    setSheetCollapsed(false);
    updateParams({ focus: eventId });
  };

  const applyCompare = (eventId: string) => {
    const update = toggleCompare(url.compare, eventId);
    if (update.kind === "full") {
      setNotice(`最多同时比较 ${COMPARE_LIMIT} 个事件`);
      return;
    }
    setSheetCollapsed(false);
    updateParams({ compare: update.next.length > 0 ? update.next.join(",") : undefined });
  };

  const returnSearch = location.search || (currentPeriod ? `?period=${encodeURIComponent(currentPeriod.period_id)}` : "");
  const detailLink = (eventId: string) => `/event/${eventId}?return=${encodeURIComponent(returnSearch)}`;

  const railHasContent = Boolean(focusEvent) || url.compare.length > 0;
  const comparison = comparisonSummary(compareKnown);
  const titleOf = (id: string) => eventById.get(id)?.title_zh ?? id;

  return <AppFrame serviceState={serviceState}>
    <main className="workspace">
      <aside className={`filters${filtersOpen ? " is-open" : ""}`} aria-label="时间线筛选">
        <button type="button" className="filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          <SlidersHorizontal size={15} />筛选与搜索<ChevronRight size={14} className="filters-toggle-caret" />
        </button>
        <div className="filters-body">
          <h2>浏览范围</h2>
          <div className="coverage-notice"><CircleAlert size={16} /><span>当前展示首批真实只读样本；全球批次仍在构建，薄弱来源已标记。</span></div>
          <div className="filter-section">
            <div className="filter-title"><span>地区</span><button type="button" onClick={() => updateParams({ regions: undefined })}>清除</button></div>
            {lanes.map((region) => <label className="region-option" key={region.region_id}><input type="checkbox" checked={url.regions.length === 0 || url.regions.includes(region.region_id)} onChange={() => toggleRegion(region.region_id)} /><span>{region.name_zh}</span></label>)}
          </div>
          {presentStatuses.length > 0 && <div className="filter-section" aria-label="数据状态筛选">
            <div className="filter-title"><span>数据状态</span><button type="button" onClick={() => updateParams({ status: undefined })}>清除</button></div>
            {presentStatuses.map(([status, count]) => <label className="region-option" key={status}><input type="checkbox" checked={url.statuses.length === 0 || url.statuses.includes(status)} onChange={() => toggleStatus(status)} /><span>{statusLabel(status)}（{count}）</span></label>)}
          </div>}
          <label className="region-option region-option--switch"><input type="checkbox" checked={showEmptyLanes} onChange={(changeEvent) => setShowEmptyLanes(changeEvent.target.checked)} /><span>显示无记录地区</span></label>
          {filterActive && <button type="button" className="clear-filters" onClick={clearFilters}>清除全部筛选</button>}
          <form className="search-form" onSubmit={submitSearch}>
            <label htmlFor="timeline-search">搜索事件或人物</label>
            <div className="search-input"><Search size={16} /><input id="timeline-search" value={searchText} onChange={(changeEvent) => setSearchText(changeEvent.target.value)} placeholder="输入中文关键词" /><button type="submit" aria-label="搜索"><ChevronRight size={17} /></button></div>
          </form>
          {searchResults && <div className="search-results"><div className="filter-title"><span>搜索结果</span><button type="button" aria-label="关闭搜索结果" onClick={() => setSearchResults(undefined)}><X size={15} /></button></div>{searchResults.length === 0 ? <p>没有匹配事件</p> : searchResults.map((event) => <Link key={event.event_id} to={detailLink(event.event_id)}>{event.title_zh}<small>{eventDate(event)}</small></Link>)}</div>}
        </div>
      </aside>

      <section className="timeline" aria-labelledby="timeline-heading">
        <nav className="breadcrumbs" aria-label="时间线层级">
          {parentPeriodId && <button type="button" className="period-back" onClick={() => updateParams({ period: parentPeriodId, focus: undefined })}><ArrowLeft size={16} />返回上一级</button>}
          <button type="button" onClick={() => updateParams({ period: "period_global_sample", focus: undefined })}>全球样本根段</button>
          {url.period && url.period !== "period_global_sample" && <><ChevronRight size={14} /><span>{currentPeriod?.title_zh}</span></>}
        </nav>
        <div className="timeline-heading">
          <div><p className="eyebrow">预制时间段</p><h2 id="timeline-heading">{currentPeriod?.title_zh ?? (loadError ? "无法读取此时间段" : "读取时间线")}</h2></div>
          <div className="view-toggle" role="group" aria-label="视图模式">
            <button type="button" aria-pressed={view === "timeline"} onClick={() => updateParams({ view: "timeline" })}><GitCommitHorizontal size={15} />时间轴</button>
            <button type="button" aria-pressed={view === "list"} onClick={() => updateParams({ view: "list" })}><List size={15} />年表</button>
          </div>
        </div>

        {notice && <div className="inline-notice" role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice(undefined)}><X size={14} /></button></div>}

        {loadError ? <div className="state-panel error"><CircleAlert size={22} />
          <h3>{loadError.code === "unbuilt" ? "此时段尚未构建" : loadError.code === "source_failed" ? "此时段来源构建失败" : "无法读取此时间段"}</h3>
          <p>{loadError.code === "unbuilt" ? "该时段还没有完成资料整理，与已查为空不同。" : loadError.message}</p>
          <button type="button" className="btn-primary" onClick={() => updateParams({ period: undefined })}>返回根时段</button>
        </div> : timeline?.state === "checked_empty" ? <div className="state-panel"><h3>已按来源范围检查，此段为空</h3><p>这是有查询范围记录的空段，与尚未构建不同。</p></div> : currentPeriod && range && <>
          <div className="timeline-summary" aria-label="当前范围概览">
            <div><strong>{uniqueEvents}</strong><span>收录事件</span></div>
            <div><strong>{lanesWithRecords}</strong><span>有记录的地区</span></div>
            <div><strong>{periodDetail?.children.length ?? 0}</strong><span>下级时段</span></div>
            <p>首批抽样资料，尚未完成全球和逐十年覆盖。事件日期与地区仍待进一步来源核验。</p>
          </div>

          {periodDetail?.children.length ? <div className="period-nav" aria-label="下一层时间段">
            {periodDetail.children.map((child) => {
              const childRange = periodRange(child);
              const widthShare = childRange ? Math.max(4, ((childRange[1] - childRange[0]) / (range[1] - range[0])) * 100) : 20;
              const count = childCounts.get(child.period_id) ?? 0;
              const caption = child.coverage_status === "built"
                ? `${childRange ? `${axisYearLabel(Math.ceil(childRange[0]))}–${axisYearLabel(Math.floor(childRange[1]))}` : ""} · ${count} 条样本`
                : child.coverage_status === "checked_empty" ? "已查为空" : child.coverage_status === "failed" ? "构建失败" : "未构建";
              // every child stays navigable: non-built ones lead to the explicit coverage state page
              return <button key={child.period_id} type="button" className={`period-chip${child.coverage_status === "built" ? "" : " is-static"}`} style={{ flexGrow: widthShare }} onClick={() => updateParams({ period: child.period_id, focus: undefined })}><span>{child.title_zh}</span><small>{caption}</small></button>;
            })}
          </div> : <div className="terminal-scale">当前已是首批样本的最细预制层级</div>}

          {filteredPlacements.length === 0 ? <div className="state-panel"><h3>当前筛选没有匹配事件</h3><p>这是筛选结果为空，不代表该时段历史上没有事件。</p><button type="button" className="btn-primary" onClick={clearFilters}>清除筛选</button></div> : view === "list" ? <div className="chrono-list" aria-label="年表列表">
            {[...eventById.values()].sort((a, b) => eventRange(a)[0] - eventRange(b)[0] || a.title_zh.localeCompare(b.title_zh)).map((event) => {
              const eventRegions = filteredPlacements.filter((item) => item.event.event_id === event.event_id).map((item) => item.region.name_zh);
              const inCompare = url.compare.includes(event.event_id);
              return <div className="chrono-row" key={event.event_id} data-event-id={event.event_id}>
                <span className={`chrono-dot is-${event.data_status}`} aria-hidden="true" />
                <div className="chrono-time">{eventDate(event)}</div>
                <div className="chrono-main">
                  <Link to={detailLink(event.event_id)}>{event.title_zh}</Link>
                  <small>{kindLabel(event.event_kind)} · {statusLabel(event.data_status)}{eventRegions.length > 0 ? ` · ${eventRegions.join("、")}` : ""}</small>
                </div>
                <button type="button" className={`compare-add${inCompare ? " is-in" : ""}`} disabled={!inCompare && compareFull} title={!inCompare && compareFull ? `最多同时比较 ${COMPARE_LIMIT} 个事件` : undefined} aria-label={`${inCompare ? "移出对比" : "加入对比"}：${event.title_zh}`} aria-pressed={inCompare} onClick={() => applyCompare(event.event_id)}>{inCompare ? <X size={14} /> : <Plus size={14} />}</button>
              </div>;
            })}
          </div> : <div className="matrix">
            <div className="matrix-legend" aria-hidden="true">
              <span><i className="legend-mark legend-mark--dot" />时点事件</span>
              <span><i className="legend-mark legend-mark--bar" />区间事件</span>
              <span><i className="legend-mark is-provisional" />待核验</span>
              <span><i className="legend-mark is-insufficient" />来源不足</span>
            </div>
            <ScaleRow spanStart={range[0]} spanEnd={range[1]} maxTicks={isMobile ? 4 : 8} label="共享时间刻度" />
            <div className="matrix-lanes">
              {activeFraction !== null && <i className="matrix-refline" style={{ "--ref-x": activeFraction } as CSSProperties} aria-hidden="true" />}
              {lanes.map((region) => {
                const entries = filteredPlacements.filter((item) => item.region.region_id === region.region_id).map(toLaneEntry);
                if (entries.length === 0 && !showEmptyLanes) return null;
                return <LaneRow
                  key={region.region_id}
                  region={region}
                  entries={entries}
                  spanStart={range[0]}
                  spanEnd={range[1]}
                  activeEventId={activeEventId}
                  focusId={focusEvent?.event_id ?? null}
                  compareIds={url.compare}
                  onFocusEvent={focusEventParam}
                  onHoverEvent={setHoverEventId}
                />;
              })}
            </div>
            <ScaleRow spanStart={range[0]} spanEnd={range[1]} maxTicks={isMobile ? 4 : 8} />
          </div>}
        </>}
        {!loadError && !timeline && <div className="state-panel"><p>正在读取时间线</p></div>}
      </section>

      <aside className={`context-rail${railHasContent && !sheetCollapsed ? " is-open" : ""}`} aria-label="上下文与对比">
        {railHasContent && sheetCollapsed && <button type="button" className="sheet-restore" onClick={() => setSheetCollapsed(false)}>焦点 / 对比（{url.compare.length}）· 展开</button>}
        {focusEvent && <section className="rail-block focus-panel" aria-label="焦点事件">
          <div className="rail-block-head"><h3>{focusEvent.title_zh}</h3><div className="rail-head-actions">
            <button type="button" className="rail-icon-btn sheet-collapse" aria-label="收起面板" onClick={() => setSheetCollapsed(true)}><ChevronRight size={15} /></button>
            <button type="button" className="rail-icon-btn" aria-label="清除焦点" onClick={() => updateParams({ focus: undefined })}><X size={15} /></button>
          </div></div>
          <p className="focus-meta">{eventDate(focusEvent)}</p>
          <dl className="rail-facts">
            <div><dt>类型</dt><dd>{kindLabel(focusEvent.event_kind)}</dd></div>
            <div><dt>数据状态</dt><dd>{statusLabel(focusEvent.data_status)}</dd></div>
            <div><dt>关联地区</dt><dd>{focusEvent.region_refs.map((id) => regionName.get(id) ?? id).join("、") || "暂无"}</dd></div>
          </dl>
          {filteredPlacements.filter((item) => item.event.event_id === focusEvent.event_id).length > 1 && <p className="focus-cross">同一事件在当前范围的 {filteredPlacements.filter((item) => item.event.event_id === focusEvent.event_id).length} 个地区行中显示，已同步高亮。</p>}
          <div className="focus-actions">
            <Link className="btn-primary" to={detailLink(focusEvent.event_id)}>打开详情</Link>
            <button type="button" className="btn-ghost" disabled={!url.compare.includes(focusEvent.event_id) && compareFull} title={!url.compare.includes(focusEvent.event_id) && compareFull ? `最多同时比较 ${COMPARE_LIMIT} 个事件` : undefined} onClick={() => applyCompare(focusEvent.event_id)}>{url.compare.includes(focusEvent.event_id) ? "移出对比" : "加入对比"}</button>
          </div>
        </section>}

        {url.compare.length > 0 && <section className="rail-block compare-panel" aria-label="事件对比">
          <div className="rail-block-head"><h3><Scale size={15} />事件对比 {url.compare.length}/{COMPARE_LIMIT}</h3><div className="rail-head-actions">
            {!focusEvent && <button type="button" className="rail-icon-btn sheet-collapse" aria-label="收起面板" onClick={() => setSheetCollapsed(true)}><ChevronRight size={15} /></button>}
            <button type="button" className="rail-clear" onClick={() => updateParams({ compare: undefined })}>清空</button>
          </div></div>
          {compareMissing.map((id) => <div className="compare-item is-missing" key={id}><p>事件 {id} 不在当前时段范围内</p><button type="button" aria-label={`移除事件 ${id}`} onClick={() => applyCompare(id)}><X size={14} /></button></div>)}
          {compareKnown.map((event) => {
            const names = event.region_refs.map((id) => regionName.get(id) ?? id).join("、");
            return <div className="compare-item" key={event.event_id} data-event-id={event.event_id}>
              <div className="compare-item-head"><Link to={detailLink(event.event_id)}>{event.title_zh}</Link><button type="button" aria-label={`移出对比：${event.title_zh}`} onClick={() => applyCompare(event.event_id)}><X size={14} /></button></div>
              <dl className="rail-facts">
                <div><dt>时间</dt><dd>{eventDate(event)}</dd></div>
                <div><dt>持续</dt><dd>{formatDuration(event)}</dd></div>
                <div><dt>类型</dt><dd>{kindLabel(event.event_kind)}</dd></div>
                <div><dt>状态</dt><dd>{statusLabel(event.data_status)}</dd></div>
                <div><dt>地区</dt><dd>{names || "暂无"}</dd></div>
              </dl>
            </div>;
          })}
          {compareKnown.length >= 2 && <div className="compare-summary">
            <p><strong>共同地区</strong>{comparison.sharedRegionIds.length > 0 ? comparison.sharedRegionIds.map((id) => regionName.get(id) ?? id).join("、") : "无共同地区"}</p>
            <p><strong>时间重叠</strong>{comparison.overlappingPairs.length > 0 ? comparison.overlappingPairs.map(([a, b]) => `「${titleOf(a)}」与「${titleOf(b)}」`).join("；") : "所选事件时间互不重叠"}</p>
          </div>}
          {compareFull && <p className="rail-notice">最多同时比较 {COMPARE_LIMIT} 个事件</p>}
        </section>}

        {!railHasContent && <section className="rail-block" aria-label="范围覆盖摘要">
          <div className="rail-block-head"><h3>当前范围</h3></div>
          <dl className="rail-facts">
            <div><dt>收录事件</dt><dd>{uniqueEvents} 条</dd></div>
            <div><dt>地区覆盖</dt><dd>{lanesWithRecords} / {lanes.length} 个地区有记录</dd></div>
            {presentStatuses.map(([status, count]) => <div key={status}><dt>{statusLabel(status)}</dt><dd>{count} 条放置</dd></div>)}
          </dl>
          <p className="rail-note">点选时间轴或年表中的事件查看摘要；可将 2 至 3 个事件加入对比。</p>
        </section>}
      </aside>
    </main>
  </AppFrame>;
}
