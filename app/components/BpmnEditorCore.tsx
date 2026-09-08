import { useEffect, useRef, useState } from "react";
import type Modeler from "bpmn-js/lib/Modeler";
import { t, type Locale } from "../lib/i18n";
import {
  downloadBlob,
  renderSvgToPng,
  safeDiagramFilename,
  sanitizeDiagramSvg,
  type DiagramExportExtension,
} from "../lib/diagram-export.client";

type CommandStack = {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  clear(): void;
};

type Rect = { x: number; y: number; width: number; height: number };
type Dimensions = { width: number; height: number };
type CanvasInsets = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};
type CanvasViewbox = Rect & {
  inner: Rect;
  outer: Dimensions;
  scale: number;
};

type Canvas = {
  resized(): void;
  scroll(delta: { dx: number; dy: number }): { x: number; y: number };
  viewbox(): CanvasViewbox;
  viewbox(box: Rect): Rect;
  zoom(): number;
  zoom(
    value: number | "fit-viewport",
    center?: { x: number; y: number },
  ): number;
};

type DirectEditing = { isActive(): boolean };
type HistoryState = { canUndo: boolean; canRedo: boolean; dirty: boolean };

export type BpmnEditorActivity =
  | "shape.create"
  | "shape.delete"
  | "shape.move"
  | "element.updateProperties"
  | "connection.create"
  | "connection.delete"
  | "viewbox.changed"
  | "document.loaded"
  | "document.import_failed"
  | `document.export_${DiagramExportExtension}`;

export type BpmnEditorSaveResult = { ok: boolean; status: string };

type FitOptions = {
  center?: { x: number; y: number };
  focus?: { x: number; y: number };
  minimumZoom?: number;
  offset?: { x: number; y: number };
};

export type InitialFit = FitOptions & {
  minimumZoomWidth?: number;
  compact?: FitOptions & { maximumWidth: number };
};

const cleanHistory: HistoryState = {
  canUndo: false,
  canRedo: false,
  dirty: false,
};

const CANVAS_FIT_PADDING = 24;
const CANVAS_ZOOM_RANGE = { minimum: 0.2, maximum: 4 } as const;

function historyState(commandStack: CommandStack): HistoryState {
  const canUndo = commandStack.canUndo();
  return { canUndo, canRedo: commandStack.canRedo(), dirty: canUndo };
}

export function framedContentViewbox(
  content: Rect,
  viewport: Dimensions,
  insets: CanvasInsets = {},
): Rect | null {
  if (
    content.width <= 0 ||
    content.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;

  const left = Math.max(0, insets.left ?? 0) + CANVAS_FIT_PADDING;
  const right = Math.max(0, insets.right ?? 0) + CANVAS_FIT_PADDING;
  const top = Math.max(0, insets.top ?? 0) + CANVAS_FIT_PADDING;
  const bottom = Math.max(0, insets.bottom ?? 0) + CANVAS_FIT_PADDING;
  const availableWidth = viewport.width - left - right;
  const availableHeight = viewport.height - top - bottom;
  if (availableWidth <= 0 || availableHeight <= 0) return null;

  const scale = Math.min(
    1,
    availableWidth / content.width,
    availableHeight / content.height,
  );
  const targetCenter = {
    x: left + availableWidth / 2,
    y: top + availableHeight / 2,
  };
  return {
    x: content.x + content.width / 2 - targetCenter.x / scale,
    y: content.y + content.height / 2 - targetCenter.y / scale,
    width: viewport.width / scale,
    height: viewport.height / scale,
  };
}

export function boundedCanvasZoom(current: number, factor: number): number {
  return Math.min(
    CANVAS_ZOOM_RANGE.maximum,
    Math.max(CANVAS_ZOOM_RANGE.minimum, current * factor),
  );
}

function visiblePaletteInsets(container: HTMLElement): CanvasInsets {
  const palette = container.querySelector<HTMLElement>(".djs-palette");
  if (!palette) return {};
  const style = getComputedStyle(palette);
  if (style.display === "none" || style.visibility === "hidden") return {};
  const canvasBounds = container.getBoundingClientRect();
  const paletteBounds = palette.getBoundingClientRect();
  const overlapsCanvas =
    paletteBounds.right > canvasBounds.left &&
    paletteBounds.left < canvasBounds.right &&
    paletteBounds.bottom > canvasBounds.top &&
    paletteBounds.top < canvasBounds.bottom;
  if (!overlapsCanvas) return {};
  return {
    left: Math.max(0, paletteBounds.right - canvasBounds.left),
  };
}

function fitCanvasContent(canvas: Canvas, insets: CanvasInsets = {}): void {
  const current = canvas.viewbox();
  const next = framedContentViewbox(current.inner, current.outer, insets);
  if (next) canvas.viewbox(next);
  else canvas.zoom("fit-viewport");
}

function zoomCanvas(
  canvas: Canvas,
  factor: number,
  insets: CanvasInsets = {},
): void {
  const current = canvas.viewbox();
  const left = Math.max(0, insets.left ?? 0) + CANVAS_FIT_PADDING;
  const right = Math.max(0, insets.right ?? 0) + CANVAS_FIT_PADDING;
  const top = Math.max(0, insets.top ?? 0) + CANVAS_FIT_PADDING;
  const bottom = Math.max(0, insets.bottom ?? 0) + CANVAS_FIT_PADDING;
  canvas.zoom(boundedCanvasZoom(current.scale, factor), {
    x: left + Math.max(0, current.outer.width - left - right) / 2,
    y: top + Math.max(0, current.outer.height - top - bottom) / 2,
  });
}

export function fitInitialCanvas(
  canvas: Pick<Canvas, "zoom"> & Partial<Pick<Canvas, "scroll" | "viewbox">>,
  options?: FitOptions,
  insets: CanvasInsets = {},
): void {
  if (!options && canvas.viewbox) {
    fitCanvasContent(canvas as Canvas, insets);
    return;
  }
  const fittedZoom = options?.center
    ? canvas.zoom("fit-viewport", options.center)
    : canvas.zoom("fit-viewport");
  if (options?.minimumZoom !== undefined && fittedZoom < options.minimumZoom)
    canvas.zoom(options.minimumZoom);
  if (options?.focus && canvas.viewbox) {
    const viewbox = canvas.viewbox();
    canvas.viewbox({
      x: options.focus.x - viewbox.width / 2,
      y: options.focus.y - viewbox.height / 2,
      width: viewbox.width,
      height: viewbox.height,
    });
  }
  if (options?.offset && canvas.scroll)
    canvas.scroll({ dx: options.offset.x, dy: options.offset.y });
}

export function initialFitForViewport(
  initialFit: InitialFit | undefined,
  viewportWidth: number,
): FitOptions | undefined {
  if (!initialFit) return undefined;
  const { compact, minimumZoomWidth, ...defaultFit } = initialFit;
  if (compact) {
    const { maximumWidth, ...compactFit } = compact;
    if (viewportWidth <= maximumWidth) return compactFit;
  }
  if (minimumZoomWidth !== undefined && viewportWidth < minimumZoomWidth) {
    const fitWithoutMinimum = { ...defaultFit };
    delete fitWithoutMinimum.minimumZoom;
    return fitWithoutMinimum;
  }
  return defaultFit;
}

export function scheduleCanvasFit(
  canvas: Pick<Canvas, "resized" | "zoom"> & Partial<Pick<Canvas, "viewbox">>,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  insets: CanvasInsets | (() => CanvasInsets) = {},
): number {
  return schedule(() => {
    canvas.resized();
    if (canvas.viewbox)
      fitCanvasContent(
        canvas as Canvas,
        typeof insets === "function" ? insets() : insets,
      );
    else canvas.zoom("fit-viewport");
  });
}

export function BpmnEditorCore({
  xml,
  locale,
  revisionNumber,
  documentTitle,
  initialFit,
  onSelectionChange,
  onActivity,
  onSave,
}: {
  xml: string;
  locale: Locale;
  revisionNumber: number;
  documentTitle: string;
  initialFit?: InitialFit;
  onSelectionChange?: (elementId: string | null) => void;
  onActivity?: (activity: BpmnEditorActivity) => void;
  onSave?: (xml: string) => Promise<BpmnEditorSaveResult>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const modeler = useRef<Modeler | null>(null);
  const activityHandler = useRef(onActivity);
  const selectionHandler = useRef(onSelectionChange);
  const hasExpandedTransitioned = useRef(false);
  const [status, setStatus] = useState(() => t(locale, "editor.loading"));
  const [history, setHistory] = useState<HistoryState>(cleanHistory);
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState<DiagramExportExtension | null>(
    null,
  );
  activityHandler.current = onActivity;
  selectionHandler.current = onSelectionChange;

  useEffect(() => {
    let mounted = true;
    void import("../lib/bpmn-modeler.client").then(
      async ({ createBpmnModeler }) => {
        if (!mounted || !container.current) return;
        const instance = createBpmnModeler(container.current, locale);
        modeler.current = instance;
        try {
          await instance.importXML(xml);
          const canvas = instance.get<Canvas>("canvas");
          const commandStack = instance.get<CommandStack>("commandStack");
          commandStack.clear();
          setHistory(historyState(commandStack));
          fitInitialCanvas(
            canvas,
            initialFitForViewport(initialFit, container.current.clientWidth),
            visiblePaletteInsets(container.current),
          );
          const eventBus = instance.get<{
            on(
              event: string | string[],
              callback: (event: {
                newSelection?: Array<{ id: string }>;
              }) => void,
            ): void;
          }>("eventBus");
          eventBus.on("commandStack.changed", () =>
            setHistory(historyState(commandStack)),
          );
          for (const command of [
            "shape.create",
            "shape.delete",
            "shape.move",
            "element.updateProperties",
            "connection.create",
            "connection.delete",
          ] as const)
            eventBus.on(`commandStack.${command}.executed`, () =>
              activityHandler.current?.(command),
            );
          eventBus.on("canvas.viewbox.changed", () =>
            activityHandler.current?.("viewbox.changed"),
          );
          eventBus.on("selection.changed", (event) =>
            selectionHandler.current?.(event.newSelection?.[0]?.id ?? null),
          );
          setStatus(t(locale, "editor.historyBaselineImported"));
          setReady(true);
          activityHandler.current?.("document.loaded");
        } catch {
          setReady(false);
          setStatus(t(locale, "editor.loadError"));
          activityHandler.current?.("document.import_failed");
        }
      },
    );
    return () => {
      mounted = false;
      modeler.current?.destroy();
      modeler.current = null;
    };
  }, [xml, locale, initialFit]);

  useEffect(() => {
    if (!hasExpandedTransitioned.current) {
      hasExpandedTransitioned.current = true;
      return;
    }
    const instance = modeler.current;
    if (!instance) return;
    const frame = scheduleCanvasFit(
      instance.get<Canvas>("canvas"),
      requestAnimationFrame,
      () => (container.current ? visiblePaletteInsets(container.current) : {}),
    );
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const directEditing =
        modeler.current?.get<DirectEditing>("directEditing");
      if (directEditing?.isActive()) return;
      event.preventDefault();
      setExpanded(false);
    }
    window.addEventListener("keydown", closeOnEscape, { capture: true });
    return () => {
      window.removeEventListener("keydown", closeOnEscape, { capture: true });
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  function commandStack(): CommandStack | null {
    return modeler.current?.get<CommandStack>("commandStack") ?? null;
  }
  function undo() {
    commandStack()?.undo();
  }
  function redo() {
    commandStack()?.redo();
  }
  function fit() {
    const canvas = modeler.current?.get<Canvas>("canvas");
    if (canvas && container.current)
      fitCanvasContent(canvas, visiblePaletteInsets(container.current));
  }
  function zoom(factor: number) {
    const canvas = modeler.current?.get<Canvas>("canvas");
    if (canvas && container.current)
      zoomCanvas(canvas, factor, visiblePaletteInsets(container.current));
  }

  async function save() {
    if (!onSave) return;
    const result = await modeler.current?.saveXML({ format: true });
    if (!result?.xml) return;
    setStatus(t(locale, "editor.saving"));
    const saved = await onSave(result.xml);
    setStatus(saved.status);
    if (!saved.ok) return;
    const stack = commandStack();
    stack?.clear();
    setHistory(stack ? historyState(stack) : cleanHistory);
  }

  async function exportDiagram(extension: DiagramExportExtension) {
    const instance = modeler.current;
    if (!instance || !ready) return;
    setExporting(extension);
    try {
      const filename = safeDiagramFilename(
        documentTitle,
        revisionNumber,
        extension,
      );
      if (extension === "bpmn") {
        const result = await instance.saveXML({ format: true });
        if (!result.xml) throw new Error("bpmn_export_failed");
        downloadBlob(
          new Blob([result.xml], { type: "application/xml;charset=utf-8" }),
          filename,
        );
      } else {
        const result = await instance.saveSVG();
        if (!result.svg) throw new Error("svg_export_failed");
        const svg = sanitizeDiagramSvg(result.svg);
        const blob =
          extension === "svg"
            ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
            : await renderSvgToPng(svg);
        downloadBlob(blob, filename);
      }
      setStatus(t(locale, `editor.exported.${extension}`));
      activityHandler.current?.(`document.export_${extension}`);
    } catch {
      setStatus(t(locale, "editor.exportError"));
    } finally {
      setExporting(null);
    }
  }

  return (
    <section
      className={`canvas-shell${expanded ? " is-expanded" : ""}`}
      aria-label={t(locale, "editor.aria")}
      aria-expanded={expanded}
    >
      <header>
        <div className="editor-status">
          <p className="step-marker">{t(locale, "editor.workspace")}</p>
          <p aria-live="polite">
            {status}
            {history.dirty ? ` · ${t(locale, "editor.unsaved")}` : ""}
          </p>
        </div>
        <div className="editor-header-controls">
          <div
            className="editor-toolbar"
            role="toolbar"
            aria-label={t(locale, "editor.controls")}
          >
            <EditorControl
              label={t(locale, "editor.undo")}
              icon="↶"
              onClick={undo}
              disabled={!history.canUndo}
            />
            <EditorControl
              label={t(locale, "editor.redo")}
              icon="↷"
              onClick={redo}
              disabled={!history.canRedo}
            />
            <EditorControl
              label={t(locale, "editor.fit")}
              icon="⊡"
              onClick={fit}
            />
            <EditorControl
              label={t(locale, "editor.zoomOut")}
              icon="−"
              onClick={() => zoom(0.8)}
            />
            <EditorControl
              label={t(locale, "editor.zoomIn")}
              icon="+"
              onClick={() => zoom(1.25)}
            />
            <EditorControl
              label={t(locale, expanded ? "editor.collapse" : "editor.expand")}
              icon={expanded ? "↙" : "↗"}
              onClick={() => setExpanded((value) => !value)}
              pressed={expanded}
            />
          </div>
          <div className="button-row editor-actions">
            {onSave ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => void save()}
                disabled={!history.dirty}
              >
                {t(locale, "editor.save")}
              </button>
            ) : null}
            {ready ? (
              <div
                className="export-actions"
                aria-label={t(locale, "editor.exports")}
              >
                {(["bpmn", "svg", "png"] as const).map((extension) => (
                  <button
                    key={extension}
                    className={
                      extension === "bpmn"
                        ? "button primary"
                        : "button secondary"
                    }
                    type="button"
                    disabled={exporting !== null}
                    onClick={() => void exportDiagram(extension)}
                  >
                    {t(locale, `editor.export.${extension}`)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div ref={container} className="bpmn-canvas" />
    </section>
  );
}

function EditorControl({
  label,
  icon,
  onClick,
  disabled = false,
  pressed,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className="editor-control"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={label}
    >
      <span className="editor-control-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="editor-control-label">{label}</span>
    </button>
  );
}
