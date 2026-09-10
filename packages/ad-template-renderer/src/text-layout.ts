export type TextOverflowBehaviour = "refuse" | "truncate" | "scale_down";

export type MeasuredText = {
  width: number;
  ascent: number;
  descent: number;
};

export type TextMeasurer = (text: string, fontSize: number) => MeasuredText;

export type PreparedTextLayout =
  | { kind: "skip" }
  | { kind: "unfit" }
  | {
      kind: "paint";
      fontSize: number;
      lines: string[];
      ascent: number;
      descent: number;
      trackingPixels: number;
    };

export type PrepareTextLayoutOptions = {
  text: string;
  width: number;
  height: number;
  baseFontSize: number;
  readabilityFloor: number;
  maxLines: number;
  lineHeight: number;
  trackingPixels: number;
  overflowBehaviour: TextOverflowBehaviour;
  measure: TextMeasurer;
};

export function segmentGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      ({ segment }) => segment,
    );
  }
  return Array.from(text);
}

export function measureTrackedTextWidth(
  measure: TextMeasurer,
  text: string,
  fontSize: number,
  trackingPixels: number,
): number {
  return text.length === 0
    ? 0
    : measure(text, fontSize).width
      + trackingPixels * Math.max(0, segmentGraphemes(text).length - 1);
}

export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  trackingPixels: number,
  measure: TextMeasurer,
): string[] {
  const width = (value: string) => measureTrackedTextWidth(measure, value, fontSize, trackingPixels);
  const output: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (width(word) > maxWidth) {
        if (line) output.push(line);
        line = "";
        for (const glyph of segmentGraphemes(word)) {
          const candidate = `${line}${glyph}`;
          if (line && width(candidate) > maxWidth) {
            output.push(line);
            line = glyph;
          } else line = candidate;
        }
        continue;
      }
      const candidate = `${line} ${word}`;
      if (!line || width(candidate.trim()) <= maxWidth) line = line ? candidate : word;
      else {
        output.push(line);
        line = word;
      }
    }
    output.push(line);
  }
  return output;
}

export function prepareTextLayout(options: PrepareTextLayoutOptions): PreparedTextLayout {
  const {
    text, width, height, baseFontSize, readabilityFloor, maxLines,
    lineHeight, trackingPixels, overflowBehaviour, measure,
  } = options;
  const boxFloor = height / Math.max(1, maxLines * lineHeight);
  const minimumSize = overflowBehaviour === "scale_down"
    ? readabilityFloor
    : overflowBehaviour === "truncate"
      ? Math.max(readabilityFloor, Math.min(baseFontSize, boxFloor))
      : baseFontSize;
  let fontSize = Math.max(1, baseFontSize);
  let lines: string[] = [];
  let fits = false;
  for (; fontSize >= minimumSize - 0.001; fontSize -= 0.5) {
    lines = wrapText(text, width, fontSize, trackingPixels, measure);
    const metrics = lines.map((line) => measure(line || "M", fontSize));
    const ascent = Math.max(0, ...metrics.map((line) => line.ascent));
    const descent = Math.max(0, ...metrics.map((line) => line.descent));
    const widest = Math.max(0, ...lines.map((line) =>
      measureTrackedTextWidth(measure, line, fontSize, trackingPixels)));
    const paintedHeight = ascent + descent + Math.max(0, lines.length - 1) * fontSize * lineHeight;
    fits = lines.length <= maxLines && widest <= width && paintedHeight <= height;
    if (fits) break;
  }
  if (!fits && overflowBehaviour === "refuse") return { kind: "skip" };
  if (!fits && overflowBehaviour === "scale_down") return { kind: "unfit" };
  if (!fits) {
    fontSize = Math.max(1, minimumSize);
    lines = wrapText(text, width, fontSize, trackingPixels, measure).slice(0, maxLines);
    if (overflowBehaviour === "truncate" && lines.length > 0) {
      let last = lines[lines.length - 1] ?? "";
      while (last && measureTrackedTextWidth(measure, `${last}…`, fontSize, trackingPixels) > width) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${last.trimEnd()}…`;
    }
  }
  const metrics = lines.map((line) => measure(line || "M", fontSize));
  return {
    kind: "paint", fontSize, lines, trackingPixels,
    ascent: Math.max(0, ...metrics.map((line) => line.ascent)),
    descent: Math.max(0, ...metrics.map((line) => line.descent)),
  };
}
