export function cleanName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, 100);
}

export function cleanEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}
