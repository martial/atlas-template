import {
  GraphicEq,
  DescriptionOutlined,
  PlayArrowRounded,
  ImageOutlined,
} from "@mui/icons-material";
import type { Asset } from "../types";

export default function AssetVisual({
  asset,
  large = false,
}: {
  asset: Asset;
  large?: boolean;
}) {
  if (asset.image)
    return (
      <div className={`asset-visual ${large ? "large" : ""}`}>
        <img src={asset.image} alt={asset.name} loading="lazy" />
        {asset.kind === "video" && (
          <span className="play-badge">
            <PlayArrowRounded fontSize="small" />
          </span>
        )}
      </div>
    );
  if (asset.kind === "audio")
    return (
      <div
        className={`asset-visual waveform ${large ? "large" : ""}`}
        aria-label="Audio file"
      >
        <div className="wave-bars">
          {Array.from({ length: large ? 52 : 20 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${14 + Math.abs(Math.sin(i * 1.6) * Math.cos(i * 0.3)) * 75}%`,
              }}
            />
          ))}
        </div>
        {large && (
          <span>
            <GraphicEq fontSize="small" /> {asset.detail}
          </span>
        )}
      </div>
    );
  if (asset.kind === "document")
    return (
      <div className={`asset-visual document-visual ${large ? "large" : ""}`}>
        <div className="paper-mini">
          <DescriptionOutlined />
          <b>{asset.name.replace(/\.[^.]+$/, "")}</b>
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  return (
    <div className={`asset-visual blank-visual ${large ? "large" : ""}`}>
      {asset.kind === "video" ? <PlayArrowRounded /> : <ImageOutlined />}
    </div>
  );
}
