// Canvas abstraction for the v2 renderer.
//
// One draw sequence (render-doc.ts), two backends: the browser's
// CanvasRenderingContext2D (editor preview) and @napi-rs/canvas (server, the
// canonical pixel producer). This interface is the minimum common surface —
// deliberately smaller than CanvasRenderingContext2D so a mock can implement it
// and the parity test can prove both sides draw the same commands.

export type CanvasImageLike = {
  width: number;
  height: number;
};

export type CanvasGradientLike = {
  addColorStop(offset: number, color: string): void;
};

export type CanvasTextMetricsLike = {
  width: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
};

/**
 * The draw surface renderAdDoc needs. Both CanvasRenderingContext2D and
 * @napi-rs/canvas's CanvasRenderingContext2D satisfy this structurally.
 */
export type Canvas2DLike = {
  canvas: { width: number; height: number };
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string;
  font: string;
  textAlign: "left" | "center" | "right";
  textBaseline: string;
  lineWidth: number;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** Present in Chrome 99+ and napi-rs/canvas; absent elsewhere. */
  letterSpacing?: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  drawImage(image: CanvasImageLike, dx: number, dy: number): void;
  drawImage(image: CanvasImageLike, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: CanvasImageLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): CanvasTextMetricsLike;
};

/**
 * Decoded images keyed the way renderAdDoc looks them up:
 *   plate        — the layout's background plate
 *   patch:<id>   — overlay patch layers, by layer id
 *   slot:<inputKey> — customer (or fixture) photos for image slots
 */
export type RenderedAssets = {
  plate: CanvasImageLike;
  patches: Map<string, CanvasImageLike>;
  slotImages: Map<string, CanvasImageLike>;
};
