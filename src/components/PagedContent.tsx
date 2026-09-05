import { Button } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { paginateWorkspace, type PageInterval } from "../lib/workspacePagination";

const BLOCKS = "tr, .ant-form-item, .ant-card, .ant-card-head, .ant-alert, .ant-select, .ketcher-shell, .structure-preview, button, input, textarea, p, li, [data-page-header], [data-page-block]";

/** Window-sized pages, with the original form mounted once so edits survive every page change. */
export default function PagedContent({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const { t } = useLanguage();
  const container = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageInterval[]>([{ start: 0, end: 0 }]);
  const [height, setHeight] = useState(0);
  const [page, setPage] = useState(0);
  const [linear, setLinear] = useState(false);

  useLayoutEffect(() => {
    const host = container.current;
    const content = flow.current;
    if (!host || !content) return;
    let frame = 0;
    const measure = () => {
      const available = host.clientHeight;
      if (!available) return; // A tab that is currently hidden has no viewport yet.
      const rect = content.getBoundingClientRect();
      const total = Math.ceil(Math.max(rect.height, content.scrollHeight));
      const pageHeight = Math.max(1, available - (total > available + 1 ? (compact ? 64 : 40) : 0));
      const blocks = Array.from(content.querySelectorAll<HTMLElement>(BLOCKS))
        .filter((element) => element.getClientRects().length)
        .map((element) => {
          const block = element.getBoundingClientRect();
          return { start: Math.max(0, block.top - rect.top), end: block.bottom - rect.top };
        });
      const next = paginateWorkspace(total, pageHeight, blocks);
      // Staggered columns can have no shared gap. Stack them before accepting a cut through a field.
      if (next.some((item) => blocks.some((block) =>
        block.end - block.start <= pageHeight && block.start < item.end - 0.5 && block.end > item.end + 0.5
      ))) setLinear(true);
      setHeight(pageHeight);
      setPages((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      setPage((previous) => Math.min(previous, next.length - 1));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resize?.observe(host);
    resize?.observe(content);
    window.addEventListener("resize", schedule);
    const changes = new MutationObserver(schedule);
    changes.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      changes.disconnect();
    };
  }, [compact]);

  const index = Math.min(page, pages.length - 1);
  const current = pages[index];
  return (
    <div ref={container} className="paged-content">
      <div className="paged-stage">
        <div className="paged-window" style={{ height: height ? Math.min(height, current.end - current.start) : "100%" }}>
          <div
            ref={flow}
            className={`paged-flow${linear ? " paged-flow-linear" : ""}`}
            style={{ transform: `translateY(-${current.start}px)`, "--paged-height": height ? `${height}px` : "100%" } as CSSProperties}
            onFocusCapture={(event) => {
              // Keyboard navigation and form validation also reveal the page containing the field.
              const content = flow.current;
              if (!content || !content.contains(event.target)) return;
              const rect = event.target.getBoundingClientRect();
              const position = (rect.top + rect.bottom) / 2 - content.getBoundingClientRect().top;
              const next = pages.findIndex((item) => position >= item.start && position < item.end);
              if (next >= 0) setPage(next);
            }}
          >
            {children}
          </div>
        </div>
      </div>
      {pages.length > 1 ? (
        <nav className={`workspace-pagination${compact ? " workspace-pagination-compact" : ""}`} aria-label={t("workspace.pageNavigation")}>
          <Button size="small" aria-label={t("workspace.previousPage")} disabled={index === 0} onClick={() => setPage(index - 1)}>{compact ? <LeftOutlined /> : t("workspace.previousPage")}</Button>
          <span aria-live="polite" aria-label={t("workspace.pagePosition", { current: index + 1, total: pages.length })}>{compact ? `${index + 1} / ${pages.length}` : t("workspace.pagePosition", { current: index + 1, total: pages.length })}</span>
          <Button size="small" aria-label={t("workspace.nextPage")} disabled={index === pages.length - 1} onClick={() => setPage(index + 1)}>{compact ? <RightOutlined /> : t("workspace.nextPage")}</Button>
        </nav>
      ) : null}
    </div>
  );
}
