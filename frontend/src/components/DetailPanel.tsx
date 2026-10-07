import { Button, Chip, IconButton, Tooltip } from "@mui/material";
import {
  Close,
  OpenInFull,
  ArrowForward,
  AutoAwesomeOutlined,
  DescriptionOutlined,
} from "@mui/icons-material";
import AssetVisual from "./AssetVisual";
import { sizeLabel } from "../data";
import type { Asset } from "../types";

export default function DetailPanel({
  asset,
  related,
  onSelect,
  onClose,
  onPreview,
  onAsk,
}: {
  asset: Asset;
  related: Asset[];
  onSelect: (a: Asset) => void;
  onClose: () => void;
  onPreview: () => void;
  onAsk: () => void;
}) {
  return (
    <aside className="detail-panel" aria-label="File details">
      <div className="detail-top">
        <span>File details</span>
        <IconButton
          size="small"
          aria-label="Close file details"
          onClick={onClose}
        >
          <Close fontSize="small" />
        </IconButton>
      </div>
      <button
        className="detail-image-button"
        onClick={onPreview}
        aria-label={`Open preview of ${asset.name}`}
      >
        <AssetVisual asset={asset} large />
        <span className="expand-preview">
          <OpenInFull sx={{ fontSize: 15 }} />
        </span>
      </button>
      <div className="detail-content">
        <div className="file-kind">
          {asset.kind}
          <span>{asset.detail}</span>
        </div>
        <h2>{asset.name}</h2>
        <p className="detail-description">{asset.description}</p>
        {asset.error && <p role="alert">{asset.error}</p>}
        <div className="tag-list">
          {asset.tags.map((t) => (
            <Chip key={t} label={t} variant="outlined" size="small" />
          ))}
        </div>
        <dl className="file-metadata">
          <div>
            <dt>Size</dt>
            <dd>{sizeLabel(asset.size)}</dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>
              {new Date(asset.created).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </dd>
          </div>
          <div>
            <dt>Index</dt>
            <dd>
              <span className={`status-dot ${asset.status}`} />
              {asset.status === "indexed"
                ? `${asset.chunks} ${asset.chunks === 1 ? "point" : "points"}`
                : asset.status === "error"
                  ? "Needs attention"
                  : "Ready to index"}
            </dd>
          </div>
        </dl>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<AutoAwesomeOutlined sx={{ fontSize: 17 }} />}
          onClick={onAsk}
        >
          Ask about this file
        </Button>
        <div className="related-heading">
          <h3>Related files</h3>
          <Tooltip title="Nearest files in embedding space">
            <span>
              <DescriptionOutlined
                sx={{ fontSize: 14, color: "text.secondary" }}
              />
            </span>
          </Tooltip>
        </div>
        <div className="related-files">
          {related.map((a) => (
            <button
              key={a.id}
              className="related-file"
              onClick={() => onSelect(a)}
            >
              <AssetVisual asset={a} />
              <span>
                <b>{a.name}</b>
                <small>
                  {a.tags
                    .filter((t) => asset.tags.includes(t))
                    .slice(0, 2)
                    .join(", ") || a.kind}
                </small>
              </span>
              <ArrowForward sx={{ fontSize: 15 }} />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
