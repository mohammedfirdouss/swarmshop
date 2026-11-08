const ELLIPSIS = "...";

export function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - ELLIPSIS.length)) + ELLIPSIS;
}
