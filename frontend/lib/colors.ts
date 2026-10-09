// A stable color per user id (used for group sender names and avatar fallbacks).
export const SENDER_COLORS = [
  "#c2410c", "#0e7490", "#7c3aed", "#be185d", "#15803d",
  "#b45309", "#1d4ed8", "#a21caf", "#047857", "#b91c1c",
];

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const colorFor = (id: string) => SENDER_COLORS[hashString(id) % SENDER_COLORS.length];
