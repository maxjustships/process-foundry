const MAX_PNG_DIMENSION = 8_192;
const MAX_PNG_PIXELS = 32_000_000;
const PNG_SCALE = 3;

export type DiagramExportExtension = "bpmn" | "svg" | "png";

export function safeDiagramFilename(
  projectTitle: string,
  versionNumber: number,
  extension: DiagramExportExtension,
): string {
  const slug = projectTitle
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72);
  return `${slug || "process"}-v${Math.max(1, Math.trunc(versionNumber))}.${extension}`;
}

export function sanitizeDiagramSvg(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg"
  )
    throw new Error("invalid_svg");
  for (const element of document.querySelectorAll(
    "script, foreignObject, iframe, object, embed",
  ))
    element.remove();
  for (const element of document.querySelectorAll("*"))
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (
        (name === "href" || name === "xlink:href") &&
        !attribute.value.startsWith("#") &&
        !attribute.value.startsWith("data:image/")
      )
        element.removeAttribute(attribute.name);
    }
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function svgDimensions(svg: string): { width: number; height: number } {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  const viewBox = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (
    viewBox.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  )
    return { width: viewBox[2], height: viewBox[3] };
  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("invalid_svg_dimensions");
  return { width, height };
}

export function boundedPngDimensions(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const scale = Math.min(
    PNG_SCALE,
    MAX_PNG_DIMENSION / sourceWidth,
    MAX_PNG_DIMENSION / sourceHeight,
    Math.sqrt(MAX_PNG_PIXELS / (sourceWidth * sourceHeight)),
  );
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}

export async function renderSvgToPng(svg: string): Promise<Blob> {
  const { width, height } = svgDimensions(svg);
  const pngDimensions = boundedPngDimensions(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = pngDimensions.width;
  canvas.height = pngDimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const sourceUrl = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("svg_image_load_failed"));
      image.src = sourceUrl;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("png_encoding_failed")),
      "image/png",
    ),
  );
}
