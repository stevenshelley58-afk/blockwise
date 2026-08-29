
export function containsInlineImageData(value: unknown): boolean {
  if (typeof value === "string") return /^data:image\//i.test(value) || /base64,/i.test(value);
  if (Array.isArray(value)) return value.some(containsInlineImageData);
  if (value && typeof value === "object") return Object.values(value).some(containsInlineImageData);
  return false;
}
