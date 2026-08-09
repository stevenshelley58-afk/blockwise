export function toWellFormedText(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += "?";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += "?";
    } else {
      output += value[index];
    }
  }
  return output;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(toWellFormedText(svg))}`;
}
