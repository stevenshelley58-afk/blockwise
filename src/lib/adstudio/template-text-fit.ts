export type TemplateTextFitInput = {
  text: string;
  maxChars?: number;
  maxLines?: number;
  width?: number;
  fontSize?: number;
  widthFactor?: number;
};

export type TemplateTextFitResult = {
  text: string;
  lines: string[];
  truncated: boolean;
};

const ELLIPSIS = "...";

export function fitTemplateText(input: TemplateTextFitInput): TemplateTextFitResult {
  const maxChars = positiveInt(input.maxChars);
  const maxLines = positiveInt(input.maxLines);
  const width = positiveNumber(input.width);
  const fontSize = positiveNumber(input.fontSize) ?? 24;
  const widthFactor = positiveNumber(input.widthFactor) ?? 0.52;
  const source = normaliseText(input.text);
  const charClamped = maxChars ? source.slice(0, maxChars).trimEnd() : source;
  const charTruncated = charClamped.length < source.length;

  if (!width || !maxLines) {
    return {
      text: charTruncated ? appendEllipsis(charClamped, maxChars) : charClamped,
      lines: charClamped ? [charTruncated ? appendEllipsis(charClamped, maxChars) : charClamped] : [""],
      truncated: charTruncated,
    };
  }

  const maxLineChars = Math.max(4, Math.floor(width / Math.max(1, fontSize * widthFactor)));
  const wrapped = wrapByCharacterBudget(charClamped, maxLineChars, maxLines);
  const lineTruncated = wrapped.usedChars < charClamped.length;
  if (lineTruncated || charTruncated) {
    wrapped.lines[wrapped.lines.length - 1] = appendEllipsis(wrapped.lines[wrapped.lines.length - 1] ?? "", maxLineChars);
  }

  return {
    text: wrapped.lines.join(" "),
    lines: wrapped.lines.length ? wrapped.lines : [""],
    truncated: charTruncated || lineTruncated,
  };
}

export function clampTemplateText(input: TemplateTextFitInput): string {
  return fitTemplateText(input).text;
}

function wrapByCharacterBudget(text: string, maxLineChars: number, maxLines: number): { lines: string[]; usedChars: number } {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return { lines: [""], usedChars: 0 };

  const lines: string[] = [];
  let current = "";
  let usedWords = 0;

  for (const word of words) {
    const chunks = chunkLongWord(word, maxLineChars);
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length <= maxLineChars) {
        current = next;
        continue;
      }

      if (current) {
        lines.push(current);
        usedWords += current.split(/\s+/u).filter(Boolean).length;
      }

      current = chunk;
      if (lines.length === maxLines) {
        return { lines: lines.slice(0, maxLines), usedChars: lines.join(" ").length };
      }
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
    usedWords += current.split(/\s+/u).filter(Boolean).length;
  }

  return { lines, usedChars: words.slice(0, usedWords).join(" ").length };
}

function chunkLongWord(word: string, maxLineChars: number): string[] {
  if (word.length <= maxLineChars) return [word];
  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxLineChars) {
    chunks.push(word.slice(index, index + maxLineChars));
  }
  return chunks;
}

function appendEllipsis(value: string, limit?: number): string {
  const trimmed = value.replace(/[\s.,;:]+$/u, "");
  if (!trimmed) return ELLIPSIS;
  if (limit && trimmed.length + ELLIPSIS.length > limit) {
    return `${trimmed.slice(0, Math.max(1, limit - ELLIPSIS.length)).trimEnd()}${ELLIPSIS}`;
  }
  return `${trimmed}${ELLIPSIS}`;
}

function normaliseText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function positiveInt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
