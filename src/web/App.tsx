import { Link, Route, Routes } from "react-router-dom";
import type { ServiceState } from "./api";
import { EventPage } from "./EventPage";
import { TimelinePage } from "./TimelinePage";

export function AppFrame({ children, serviceState }: { children: React.ReactNode; serviceState: ServiceState }) {
  return <div className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">个人历史研究</p><h1>全球历史时间线</h1></div>
      <div className="topbar-side">
        <span className="data-version">数据版本：P5 首批样本</span>
        <span className={`service-state service-state--${serviceState}`}>{serviceState === "ready" ? "本地索引已连接" : serviceState === "checking" ? "正在读取索引" : "本地服务不可用"}</span>
      </div>
    </header>
    {children}
  </div>;
}

export function App() {
  return <Routes>
    <Route path="/" element={<TimelinePage />} />
    <Route path="/event/:eventId" element={<EventPage />} />
    <Route path="*" element={<AppFrame serviceState="offline"><main className="event-page"><div className="state-panel error"><h2>页面不存在</h2><Link to="/">返回时间线</Link></div></main></AppFrame>} />
  </Routes>;
}
