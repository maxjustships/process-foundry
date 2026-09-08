import { describe, expect, it, vi } from "vitest";
import {
  boundedCanvasZoom,
  framedContentViewbox,
  fitInitialCanvas,
  initialFitForViewport,
  scheduleCanvasFit,
} from "../../app/components/BpmnEditorCore";
import {
  boundedPngDimensions,
  safeDiagramFilename,
} from "../../app/lib/diagram-export.client";

describe("BPMN editor viewport transitions", () => {
  it("centers fitted content inside padding and a visible palette inset", () => {
    const viewbox = framedContentViewbox(
      { x: 30, y: 40, width: 1_225, height: 204 },
      { width: 390, height: 628 },
      { left: 72 },
    );

    expect(viewbox).not.toBeNull();
    const scale = 390 / viewbox!.width;
    expect((30 - viewbox!.x) * scale).toBeCloseTo(96);
    expect((1_255 - viewbox!.x) * scale).toBeCloseTo(366);
    expect((142 - viewbox!.y) * scale).toBeCloseTo(314);
  });

  it("keeps toolbar zoom inside the bpmn-js navigation range", () => {
    expect(boundedCanvasZoom(3.8, 1.25)).toBe(4);
    expect(boundedCanvasZoom(0.21, 0.8)).toBe(0.2);
    expect(boundedCanvasZoom(0.4, 1.25)).toBe(0.5);
  });

  it("preserves fit-viewport as the project initial zoom", () => {
    const canvas = {
      zoom: vi.fn(() => 0.32),
    };

    fitInitialCanvas(canvas);

    expect(canvas.zoom).toHaveBeenCalledTimes(1);
    expect(canvas.zoom).toHaveBeenCalledWith("fit-viewport");
  });

  it("raises an excessively small demo fit to the readable minimum", () => {
    const canvas = {
      zoom: vi
        .fn<(value: number | "fit-viewport") => number>()
        .mockReturnValueOnce(0.32)
        .mockReturnValueOnce(0.45),
    };

    fitInitialCanvas(canvas, { center: { x: 0, y: 0 }, minimumZoom: 0.45 });

    expect(canvas.zoom.mock.calls).toEqual([
      ["fit-viewport", { x: 0, y: 0 }],
      [0.45],
    ]);
  });

  it("centers a readable zoom on a useful diagram region", () => {
    const canvas = {
      zoom: vi
        .fn<(value: number | "fit-viewport") => number>()
        .mockReturnValueOnce(0.32)
        .mockReturnValueOnce(0.9),
      viewbox: vi
        .fn<
          (box?: { x: number; y: number; width: number; height: number }) => {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        >()
        .mockReturnValue({ x: 0, y: 0, width: 400, height: 300 }),
    };

    fitInitialCanvas(canvas, {
      focus: { x: 380, y: 230 },
      minimumZoom: 0.9,
    });

    expect(canvas.viewbox).toHaveBeenLastCalledWith({
      x: 180,
      y: 80,
      width: 400,
      height: 300,
    });
  });

  it("uses a focused readable fit only below the configured viewport width", () => {
    const initialFit = {
      minimumZoom: 0.62,
      minimumZoomWidth: 700,
      offset: { x: 12, y: 0 },
      compact: {
        maximumWidth: 699,
        focus: { x: 325, y: 230 },
        minimumZoom: 0.9,
      },
    };

    expect(initialFitForViewport(initialFit, 390)).toEqual({
      focus: { x: 325, y: 230 },
      minimumZoom: 0.9,
    });
    expect(initialFitForViewport(initialFit, 1_440)).toEqual({
      minimumZoom: 0.62,
      offset: { x: 12, y: 0 },
    });
  });

  it("resizes before fitting on the scheduled frame", () => {
    const calls: string[] = [];
    const canvas = {
      resized: vi.fn(() => calls.push("resized")),
      zoom: vi.fn((value: "fit-viewport") => calls.push(`zoom:${value}`)),
    };
    let scheduled: FrameRequestCallback | undefined;

    scheduleCanvasFit(canvas, (callback) => {
      scheduled = callback;
      return 1;
    });

    expect(calls).toEqual([]);
    scheduled?.(0);
    expect(calls).toEqual(["resized", "zoom:fit-viewport"]);
  });
});

describe("live diagram export filenames", () => {
  it("creates deterministic bounded filenames for every client export", () => {
    expect(safeDiagramFilename("  Invoice / Approval!?  ", 7, "bpmn")).toBe(
      "invoice-approval-v7.bpmn",
    );
    expect(safeDiagramFilename("Схема процесса", 2, "svg")).toBe(
      "process-v2.svg",
    );
    expect(safeDiagramFilename("A".repeat(100), 0, "png")).toBe(
      `${"a".repeat(72)}-v1.png`,
    );
  });

  it("downscales oversized SVG canvases within dimension and pixel caps", () => {
    const dimensions = boundedPngDimensions(20_000, 10_000);

    expect(dimensions.width).toBeLessThanOrEqual(8_192);
    expect(dimensions.height).toBeLessThanOrEqual(8_192);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(
      32_000_000,
    );
    expect(dimensions).toEqual({ width: 8_000, height: 4_000 });
  });
});
