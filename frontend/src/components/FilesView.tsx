import { useState } from "react";
import {
  Checkbox,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
} from "@mui/material";
import {
  MoreHoriz,
  DeleteOutlined,
  Add,
  FileUploadOutlined,
} from "@mui/icons-material";
import type { Asset } from "../types";
import { sizeLabel } from "../data";
import AssetVisual from "./AssetVisual";

export default function FilesView({
  assets,
  onPreview,
  onDelete,
  onReplace,
  onUpload,
}: {
  assets: Asset[];
  onPreview: (a: Asset) => void;
  onDelete: (ids: string[]) => void;
  onReplace: (a: Asset) => void;
  onUpload: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    asset: Asset;
  } | null>(null);
  const selected = chosen.filter((id) => assets.some((a) => a.id === id));
  const toggle = (id: string) =>
    setChosen((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  if (!assets.length)
    return (
      <div className="empty-files">
        <FileUploadOutlined sx={{ fontSize: 42 }} />
        <h2>No files here yet</h2>
        <p>Upload images, video, audio, PDFs, or text to your collection.</p>
        <Button startIcon={<Add />} variant="contained" onClick={onUpload}>
          Upload files
        </Button>
      </div>
    );
  return (
    <div className="files-view">
      <div className="file-table-label">
        <span>
          {selected.length
            ? `${selected.length} selected`
            : `${assets.length} files in this view`}
        </span>
        {selected.length > 0 && (
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlined />}
            onClick={() => onDelete(selected)}
          >
            Delete selected
          </Button>
        )}
        <span className="files-local-note">
          Shared collection · Server storage
        </span>
      </div>
      <TableContainer>
        <Table size="small" aria-label="Collection files">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  slotProps={{ input: { "aria-label": "Select all files" } }}
                  checked={selected.length === assets.length}
                  indeterminate={
                    selected.length > 0 && selected.length < assets.length
                  }
                  onChange={(e) =>
                    setChosen(e.target.checked ? assets.map((a) => a.id) : [])
                  }
                />
              </TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Size</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Added</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {assets.map((a) => (
              <TableRow key={a.id} hover selected={selected.includes(a.id)}>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={selected.includes(a.id)}
                    slotProps={{ input: { "aria-label": `Select ${a.name}` } }}
                    onChange={() => toggle(a.id)}
                  />
                </TableCell>
                <TableCell>
                  <button className="table-file" onClick={() => onPreview(a)}>
                    <AssetVisual asset={a} />
                    <span>
                      <b>{a.name}</b>
                      <small>{a.detail}</small>
                    </span>
                  </button>
                </TableCell>
                <TableCell className="capitalize">{a.kind}</TableCell>
                <TableCell>{sizeLabel(a.size)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={
                      a.status === "indexed"
                        ? "Indexed"
                        : a.status === "error"
                          ? "Needs attention"
                          : "Ready to index"
                    }
                    className={
                      a.status === "indexed" ? "indexed-chip" : "pending-chip"
                    }
                  />
                </TableCell>
                <TableCell>
                  {new Date(a.created).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    aria-label={`Actions for ${a.name}`}
                    onClick={(e) =>
                      setMenu({ anchor: e.currentTarget, asset: a })
                    }
                  >
                    <MoreHoriz />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            if (menu) onPreview(menu.asset);
            setMenu(null);
          }}
        >
          Preview
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) onReplace(menu.asset);
            setMenu(null);
          }}
        >
          Replace file
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            if (menu) onDelete([menu.asset.id]);
            setMenu(null);
          }}
        >
          Delete
        </MenuItem>
      </Menu>
    </div>
  );
}
