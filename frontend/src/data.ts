import type { Asset } from "./types";

export const groups = [
  { name: "Images", color: "#468c88", center: [285, 260] },
  { name: "Video", color: "#b1845d", center: [690, 230] },
  { name: "Audio", color: "#7b7eaa", center: [600, 530] },
  { name: "Documents", color: "#8a9b70", center: [280, 515] },
];
export function sizeLabel(bytes: number) {
  if (bytes === 0) return "0 B";
  return bytes < 1000000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1000000).toFixed(1)} MB`;
}
export function matches(asset: Asset, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text =
    `${asset.name} ${asset.description} ${asset.tags.join(" ")}`.toLowerCase();
  return terms.every((t) => text.includes(t));
}
