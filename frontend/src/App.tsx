import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  Snackbar,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Tooltip,
  Drawer,
} from "@mui/material";
import {
  Add,
  ArrowBack,
  ArrowForward,
  AutoAwesomeOutlined,
  Check,
  ChevronRight,
  Close,
  CloudUploadOutlined,
  Code,
  ContentCopy,
  DescriptionOutlined,
  FolderOutlined,
  GraphicEq,
  GridViewOutlined,
  HelpOutlined,
  HubOutlined,
  ImageOutlined,
  Menu,
  MovieOutlined,
  Refresh,
  Search,
  Tune,
  UploadFileOutlined,
} from "@mui/icons-material";
import type {
  Asset,
  FileKind,
  Workspace,
  AppConfig,
  MapSnapshot,
  Job,
} from "./types";
import { matches, sizeLabel } from "./data";
import { api } from "./api";
import AssetVisual from "./components/AssetVisual";
import MapView from "./components/MapView";
import DetailPanel from "./components/DetailPanel";
import FilesView from "./components/FilesView";
import AskView from "./components/AskView";
const Map3D = lazy(() => import("./components/Map3D"));

type Route = {
  page: "collection" | "collections" | "mcp";
  collection: string;
  tab: string;
};
function readRoute(): Route {
  const [, page, id, tab] = location.hash.split("/");
  return {
    page: page === "collections" || page === "mcp" ? page : "collection",
    collection: id || "coastal",
    tab: ["map", "files", "ask"].includes(tab) ? tab : "map",
  };
}
const kinds: { kind: FileKind; label: string; icon: React.ReactElement }[] = [
  { kind: "image", label: "Images", icon: <ImageOutlined /> },
  { kind: "video", label: "Video", icon: <MovieOutlined /> },
  { kind: "audio", label: "Audio", icon: <GraphicEq /> },
  { kind: "document", label: "Documents", icon: <DescriptionOutlined /> },
];
const accept = ".jpg,.jpeg,.png,.webp,.mp4,.mov,.mp3,.wav,.pdf,.md,.txt";

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>({
    collections: [],
    assets: [],
    conversations: {},
  });
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [backendError, setBackendError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState(readRoute);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FileKind | "">("");
  const [sort, setSort] = useState("name");
  const [lens, setLens] = useState("content");
  const [mapMode, setMapMode] = useState<"2d" | "3d">("2d");
  const [map, setMap] = useState<MapSnapshot>({
    version: null,
    points: [],
    edges: [],
    method: "empty",
    provider: "",
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [related, setRelated] = useState<Asset[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [searchIds, setSearchIds] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [preview, setPreview] = useState<Asset | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [replace, setReplace] = useState<Asset | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [estimate, setEstimate] = useState<{
    files: number;
    unchanged: number;
    bytes: number;
    max_ai_calls: number;
    note: string;
  } | null>(null);
  const [indexError, setIndexError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [deleting, setDeleting] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [snack, setSnack] = useState("");
  const [initialQuestion, setInitialQuestion] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pendingMapSources = useRef<string[] | null>(null);
  const collection =
    workspace.collections.find((c) => c.id === route.collection) ??
    workspace.collections[0];
  const assets = workspace.assets.filter(
    (a) => a.collection === collection?.id,
  );
  const pending = assets.filter((a) => a.status !== "indexed");
  const shown = assets
    .filter(
      (a) =>
        (!filter || a.kind === filter) &&
        (!query.trim() ||
          (searchIds ? searchIds.includes(a.id) : matches(a, query))) &&
        (!sourceIds.length || sourceIds.includes(a.id)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.created.localeCompare(a.created),
    );
  const selectedAsset = assets.find((a) => a.id === selected);
  const needsFiltering = !!query || !!filter || sourceIds.length > 0;
  const running =
    !!job &&
    job.collection === collection?.id &&
    ["queued", "running"].includes(job.state);
  const message = (error: unknown) =>
    error instanceof Error
      ? error.message
      : "The request failed. Please try again.";
  async function refresh() {
    try {
      const [configuration, collections] = await Promise.all([
        api.config(),
        api.collections(),
      ]);
      const all = await Promise.all(collections.map((c) => api.assets(c.id)));
      setConfig(configuration);
      setWorkspace((w) => ({ ...w, collections, assets: all.flat() }));
      setBackendError("");
      return collections;
    } catch (error) {
      setBackendError(message(error));
      return [];
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    const change = () => {
      setRoute(readRoute());
      setSelected(null);
      clearFilters();
      if (pendingMapSources.current) {
        setSourceIds(pendingMapSources.current);
        setSelected(pendingMapSources.current[0] ?? null);
        pendingMapSources.current = null;
      }
    };
    window.addEventListener("hashchange", change);
    window.addEventListener("atlas-upload", openUpload);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("atlas-upload", openUpload);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setMap({
      version: null,
      points: [],
      edges: [],
      method: "empty",
      provider: config?.provider ?? "",
    });
    if (collection)
      void api
        .map(collection.id, lens)
        .then((data) => {
          if (!cancelled) setMap(data);
        })
        .catch((error) => {
          if (!cancelled) setBackendError(message(error));
        });
    return () => {
      cancelled = true;
    };
  }, [collection?.id, lens, workspace.assets]);
  useEffect(() => {
    let cancelled = false;
    setRelated([]);
    if (selectedAsset?.status === "indexed")
      void api
        .similar(selectedAsset.id)
        .then((hits) => {
          const ids = [...new Set(hits.map((h) => h.asset))].slice(0, 3);
          if (!cancelled)
            setRelated(
              ids.flatMap(
                (id) => workspace.assets.find((a) => a.id === id) ?? [],
              ),
            );
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected, workspace.assets]);
  useEffect(() => {
    const controller = new AbortController();
    setSearchIds(null);
    setSearchError("");
    setSearching(false);
    if (!query.trim() || !collection) return;
    const timer = setTimeout(() => {
      setSearching(true);
      void api
        .search(collection.id, query, controller.signal)
        .then((hits) => {
          if (!controller.signal.aborted)
            setSearchIds([...new Set(hits.map((h) => h.asset))]);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setSearchError(message(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, collection?.id, map.version]);
  useEffect(() => {
    if (collection?.active_job)
      void api
        .job(collection.active_job)
        .then(setJob)
        .catch((error) => setSnack(message(error)));
  }, [collection?.active_job]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.state)) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api
        .job(job.id)
        .then((next) => {
          if (cancelled) return;
          setJob(next);
          if (!["queued", "running"].includes(next.state)) {
            void refresh();
            setSnack(next.message);
          }
        })
        .catch((error) => {
          if (!cancelled) setIndexError(message(error));
        });
    }, 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.state]);
  useEffect(() => {
    if (indexOpen && collection) {
      setIndexError("");
      setEstimate(null);
      void api
        .estimate(collection.id)
        .then(setEstimate)
        .catch((error) => setIndexError(message(error)));
    }
  }, [indexOpen, collection?.id, workspace.assets]);
  function navigate(
    page: Route["page"],
    id = collection?.id ?? "",
    tab = "map",
  ) {
    location.hash = `/${page}/${id}/${tab}`;
    setMobileOpen(false);
  }
  function clearFilters() {
    setQuery("");
    setFilter("");
    setSourceIds([]);
    setSearchIds(null);
  }
  function openUpload() {
    setReplace(null);
    setUploadError("");
    setUploadOpen(true);
  }
  function showSources(ids: string[]) {
    if (route.page === "collection" && route.tab === "map") {
      clearFilters();
      setSourceIds(ids);
      setSelected(ids[0] ?? null);
    } else {
      pendingMapSources.current = ids;
      navigate("collection", collection.id, "map");
    }
  }
  async function openPreview(asset: Asset) {
    try {
      const full = await api.asset(asset.id);
      setPreview({
        ...full,
        ...(full.kind === "image" ? { image: full.url } : {}),
        ...(asset.url?.includes("#") ? { url: asset.url } : {}),
        ...(asset.text ? { text: asset.text } : {}),
      });
    } catch (error) {
      setSnack(message(error));
    }
  }
  async function uploadFiles(files: FileList | File[]) {
    if (uploading || !collection) return;
    setUploading(true);
    setUploadError("");
    const errors: string[] = [];
    let added = 0;
    for (const file of Array.from(files).slice(0, replace ? 1 : undefined)) {
      try {
        await api.upload(collection.id, file, replace?.id);
        added++;
      } catch (error) {
        errors.push(`${file.name}: ${message(error)}`);
      }
    }
    await refresh();
    setUploading(false);
    setUploadError(errors.join(" "));
    if (added) {
      navigate("collection", collection.id, "files");
      setSnack(
        `${added} file(s) uploaded. Update the index to make them searchable.`,
      );
    }
    if (!errors.length) {
      setUploadOpen(false);
      setReplace(null);
    }
    if (input.current) input.current.value = "";
  }
  async function removeFiles() {
    try {
      for (const id of deleting) await api.remove(id);
      setDeleting([]);
      setSelected(null);
      setSnack("Files removed");
    } catch (error) {
      setSnack(message(error));
    } finally {
      await refresh();
    }
  }
  async function createCollection() {
    if (!newName.trim()) return;
    try {
      const c = await api.createCollection(newName.trim(), newDescription);
      await refresh();
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      navigate("collection", c.id);
    } catch (error) {
      setSnack(message(error));
    }
  }
  async function startIndex() {
    setIndexError("");
    try {
      setJob(await api.index(collection.id));
    } catch (error) {
      setIndexError(message(error));
    }
  }
  const sidebar = (
    <div className="sidebar-inner">
      <button
        className="brand"
        onClick={() => navigate("collections")}
        aria-label="Atlas collections"
      >
        <img src="/favicon.svg" alt="" />
        <span>
          atlas<span className="brand-period">.</span>
        </span>
      </button>
      <div className="workspace-label">
        <span className="workspace-avatar">W</span>
        <span>
          My workspace<small>Shared library</small>
        </span>
      </div>
      <div className="side-main-nav">
        <button
          className={route.page === "collections" ? "active" : ""}
          onClick={() => navigate("collections")}
        >
          <GridViewOutlined />
          Collections
        </button>
      </div>
      <div className="sidebar-section-title">
        <span>Your collections</span>
        <Tooltip title="New collection">
          <IconButton
            size="small"
            aria-label="New collection"
            onClick={() => setCreateOpen(true)}
          >
            <Add sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </div>
      <nav className="collection-nav" aria-label="Collections">
        {workspace.collections.map((c) => (
          <button
            className={
              route.page === "collection" && collection?.id === c.id
                ? "active"
                : ""
            }
            key={c.id}
            onClick={() => {
              setSelected(
                workspace.assets.find((a) => a.collection === c.id)?.id ?? null,
              );
              setInitialQuestion("");
              navigate("collection", c.id);
            }}
          >
            <FolderOutlined />
            <span>{c.name}</span>
            <small>
              {workspace.assets.filter((a) => a.collection === c.id).length}
            </small>
          </button>
        ))}
      </nav>
      <button className="add-collection" onClick={() => setCreateOpen(true)}>
        <Add fontSize="small" />
        New collection
      </button>
      <div className="sidebar-bottom">
        <button
          className={route.page === "mcp" ? "active" : ""}
          onClick={() => navigate("mcp")}
        >
          <Code />
          MCP connection
          <ChevronRight sx={{ marginLeft: "auto", fontSize: 16 }} />
        </button>
        <button onClick={() => setHelpOpen(true)}>
          <HelpOutlined />
          About Atlas
        </button>
        <Divider />
        <div className="demo-indicator">
          <span />
          <div>
            {config?.provider === "offline"
              ? "Offline development"
              : "Vertex AI workspace"}
            <small>Datastore · Shared files</small>
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <div className="app-layout">
        <aside className="sidebar">{sidebar}</aside>
        <Drawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          slotProps={{ paper: { sx: { width: 238 } } }}
        >
          {sidebar}
        </Drawer>
        <main className="workspace-main">
          {!loaded && <LinearProgress />}
          {backendError && (
            <Alert
              severity="error"
              action={<Button onClick={() => void refresh()}>Retry</Button>}
              sx={{ mt: 2 }}
            >
              {backendError}
            </Alert>
          )}
          {config?.provider === "offline" && (
            <Alert severity="info" icon={false} sx={{ mt: 2 }}>
              Offline development · Text indexing and source excerpts. Set
              Vertex AI on the server for multimodal embeddings and generated
              answers.
            </Alert>
          )}
          {config && !config.configured && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {config.configuration_error ??
                "Configure Vertex AI with gcloud Application Default Credentials."}{" "}
              Uploads are available.
            </Alert>
          )}
          <header className="topbar">
            <IconButton
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </IconButton>
            <Breadcrumbs separator={<ChevronRight sx={{ fontSize: 14 }} />}>
              <button onClick={() => navigate("collections")}>Workspace</button>
              <span>
                {route.page === "collection"
                  ? collection?.name
                  : route.page === "mcp"
                    ? "MCP connection"
                    : "Collections"}
              </span>
            </Breadcrumbs>
            <Chip
              label="Material UI template"
              variant="outlined"
              className="topbar-chip"
            />
          </header>
          {route.page === "collection" && collection && (
            <>
              <section className="page-heading">
                <div>
                  <div className="heading-title">
                    <h1>{collection.name}</h1>
                    <Chip label={"Shared collection"} size="small" />
                  </div>
                  <p>{collection.description}</p>
                </div>
                <div className="heading-actions">
                  <Button
                    variant="outlined"
                    startIcon={<Refresh />}
                    onClick={() => setIndexOpen(true)}
                  >
                    Update index
                    {pending.length > 0 && (
                      <span className="pending-count">{pending.length}</span>
                    )}
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={openUpload}
                  >
                    Upload files
                  </Button>
                </div>
              </section>
              <div className="collection-tabs">
                <Tabs
                  value={route.tab}
                  onChange={(_, tab) => {
                    setInitialQuestion("");
                    navigate("collection", collection.id, tab);
                  }}
                  aria-label="Collection views"
                >
                  <Tab
                    icon={<HubOutlined sx={{ fontSize: 18 }} />}
                    iconPosition="start"
                    label="Map"
                    value="map"
                  />
                  <Tab
                    icon={<FolderOutlined sx={{ fontSize: 18 }} />}
                    iconPosition="start"
                    label={
                      <span>
                        Files{" "}
                        <small className="tab-count">{assets.length}</small>
                      </span>
                    }
                    value="files"
                  />
                  <Tab
                    icon={<AutoAwesomeOutlined sx={{ fontSize: 18 }} />}
                    iconPosition="start"
                    label="Ask"
                    value="ask"
                  />
                </Tabs>
                <span className="index-summary">
                  <span
                    className={`status-dot ${pending.length ? "pending" : "indexed"}`}
                  />
                  {pending.length
                    ? `${pending.length} waiting to index`
                    : assets.length
                      ? "Index ready"
                      : "No index yet"}
                </span>
              </div>
              {route.tab !== "ask" && (
                <div className="collection-toolbar">
                  <TextField
                    size="small"
                    placeholder="Find a file, topic, or detail…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSourceIds([]);
                    }}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Search sx={{ fontSize: 19 }} />
                          </InputAdornment>
                        ),
                        endAdornment: query ? (
                          <IconButton
                            size="small"
                            aria-label="Clear search"
                            onClick={() => setQuery("")}
                          >
                            <Close sx={{ fontSize: 15 }} />
                          </IconButton>
                        ) : undefined,
                      },
                      htmlInput: { "aria-label": "Search collection" },
                    }}
                  />
                  <div className="type-filters">
                    <Chip
                      label="All files"
                      clickable
                      onClick={() => setFilter("")}
                      className={!filter ? "filter-active" : ""}
                    />
                    {kinds.map((k) => (
                      <Chip
                        key={k.kind}
                        icon={k.icon}
                        label={k.label}
                        clickable
                        onClick={() =>
                          setFilter(filter === k.kind ? "" : k.kind)
                        }
                        className={filter === k.kind ? "filter-active" : ""}
                      />
                    ))}
                  </div>
                  <div className="toolbar-select">
                    {route.tab === "map" && (
                      <ToggleButtonGroup
                        className="map-mode-switch"
                        size="small"
                        exclusive
                        value={mapMode}
                        onChange={(_, value) => {
                          if (value) setMapMode(value);
                        }}
                        aria-label="Map dimensions"
                      >
                        <ToggleButton value="2d" aria-label="2D map">
                          2D
                        </ToggleButton>
                        <ToggleButton value="3d" aria-label="3D map">
                          3D
                        </ToggleButton>
                      </ToggleButtonGroup>
                    )}
                    <Tune sx={{ fontSize: 16 }} />
                    <Select
                      variant="standard"
                      disableUnderline
                      value={route.tab === "map" ? lens : sort}
                      onChange={(e) =>
                        route.tab === "map"
                          ? setLens(e.target.value)
                          : setSort(e.target.value)
                      }
                      inputProps={{
                        "aria-label":
                          route.tab === "map" ? "Map lens" : "Sort files",
                      }}
                    >
                      {route.tab === "map"
                        ? [
                            <MenuItem value="content" key="content">
                              Content
                            </MenuItem>,
                            <MenuItem value="text" key="text">
                              Descriptions
                            </MenuItem>,
                          ]
                        : [
                            <MenuItem value="name" key="name">
                              Name
                            </MenuItem>,
                            <MenuItem value="added" key="added">
                              Recently added
                            </MenuItem>,
                          ]}
                    </Select>
                  </div>
                </div>
              )}
              {needsFiltering && route.tab !== "ask" && (
                <div className="filter-summary">
                  <span>
                    {sourceIds.length ? "Sources from Ask" : "Matching files"}:{" "}
                    {shown.length} of {assets.length}
                  </span>
                  <Button
                    size="small"
                    onClick={clearFilters}
                    endIcon={<Close sx={{ fontSize: 14 }} />}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
              {route.tab === "map" && (
                <div
                  className={`map-layout ${selectedAsset ? "" : "without-detail"}`}
                >
                  {mapMode === "2d" ? (
                    <MapView
                      assets={assets}
                      snapshot={map}
                      selected={selected ?? undefined}
                      matches={new Set(shown.map((a) => a.id))}
                      lens={lens}
                      onSelect={(a) => setSelected(a.id)}
                    />
                  ) : (
                    <Suspense
                      fallback={
                        <div className="map-surface">
                          <LinearProgress />
                          <p className="loading-space">Opening 3D space…</p>
                        </div>
                      }
                    >
                      <Map3D
                        assets={assets}
                        snapshot={map}
                        selected={selected ?? undefined}
                        matches={new Set(shown.map((a) => a.id))}
                        lens={lens}
                        onSelect={(a) => setSelected(a.id)}
                        onFallback={() => setMapMode("2d")}
                      />
                    </Suspense>
                  )}
                  {selectedAsset && (
                    <DetailPanel
                      asset={selectedAsset}
                      related={related}
                      onClose={() => setSelected(null)}
                      onSelect={(a) => setSelected(a.id)}
                      onPreview={() => void openPreview(selectedAsset)}
                      onAsk={() => {
                        setInitialQuestion(
                          `Tell me about ${selectedAsset.name}`,
                        );
                        navigate("collection", collection.id, "ask");
                      }}
                    />
                  )}
                </div>
              )}
              {route.tab === "files" && (
                <FilesView
                  assets={shown}
                  onPreview={(a) => void openPreview(a)}
                  onDelete={setDeleting}
                  onReplace={(a) => {
                    setReplace(a);
                    setUploadError("");
                    setUploadOpen(true);
                  }}
                  onUpload={openUpload}
                />
              )}
              {route.tab === "ask" && (
                <AskView
                  key={collection.id}
                  assets={assets}
                  collectionName={collection.name}
                  collectionId={collection.id}
                  provider={config?.provider ?? "vertex"}
                  turns={workspace.conversations[collection.id] ?? []}
                  initialQuestion={initialQuestion}
                  onTurns={(turns) =>
                    setWorkspace((w) => ({
                      ...w,
                      conversations: {
                        ...w.conversations,
                        [collection.id]: turns,
                      },
                    }))
                  }
                  onMap={showSources}
                  onPreview={(a) => void openPreview(a)}
                />
              )}
            </>
          )}
          {(route.page === "collections" ||
            (route.page === "collection" && !collection && loaded)) && (
            <>
              <section className="page-heading">
                <div>
                  <h1>Your collections</h1>
                  <p>Give your files a place. Discover what connects them.</p>
                </div>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={() => setCreateOpen(true)}
                >
                  New collection
                </Button>
              </section>
              <div className="collections-grid">
                {workspace.collections.map((c) => {
                  const files = workspace.assets.filter(
                    (a) => a.collection === c.id,
                  );
                  return (
                    <button
                      className="collection-card"
                      key={c.id}
                      onClick={() => {
                        setSelected(files[0]?.id ?? null);
                        navigate("collection", c.id);
                      }}
                    >
                      <div className="collection-cover">
                        {files.some((a) => a.image) ? (
                          files
                            .filter((a) => a.image)
                            .slice(0, 3)
                            .map((a) => <img key={a.id} src={a.image} alt="" />)
                        ) : (
                          <FolderOutlined sx={{ fontSize: 44 }} />
                        )}
                      </div>
                      <div className="collection-card-body">
                        <h2>
                          {c.name}
                          <ArrowForward sx={{ fontSize: 18 }} />
                        </h2>
                        <p>{c.description}</p>
                        <span>
                          {files.length} files
                          <span className="quiet-dot" />
                          {files.reduce((sum, a) => sum + a.chunks, 0)} indexed
                          points
                        </span>
                      </div>
                    </button>
                  );
                })}
                <button
                  className="new-collection-card"
                  onClick={() => setCreateOpen(true)}
                >
                  <Add />
                  <b>Start a new collection</b>
                  <span>Bring a different set of files together.</span>
                </button>
              </div>
            </>
          )}
          {route.page === "mcp" && (
            <>
              <section className="page-heading">
                <div>
                  <h1>Bring your collection into the conversation.</h1>
                  <p>
                    Let an assistant find files, explore connections, and read
                    the source.
                  </p>
                </div>
              </section>
              <div className="connection-page">
                <div className="connection-intro">
                  <div className="connection-icon">
                    <Code />
                  </div>
                  <div>
                    <h2>MCP connection</h2>
                    <p>
                      A standard interface to the same collection you explore
                      here.
                    </p>
                  </div>
                  <Chip
                    label={config ? "Server connected" : "Connecting"}
                    className="pending-chip"
                  />
                </div>
                <Alert severity="info">
                  The MCP server is live. These read-only tools use the same
                  index as Map and Ask.
                </Alert>
                <div className="connection-grid">
                  <section>
                    <h3>Connect your assistant</h3>
                    <p>
                      Add the endpoint below to an assistant that supports
                      Streamable HTTP.
                    </p>
                    <label className="config-label">
                      Example client configuration
                    </label>
                    <pre className="config-code">
                      {JSON.stringify(
                        {
                          mcpServers: {
                            atlas: {
                              url: config?.mcp_url ?? `${location.origin}/mcp/`,
                            },
                          },
                        },
                        null,
                        2,
                      )}
                    </pre>
                    <Button
                      variant="outlined"
                      startIcon={<ContentCopy />}
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(
                            JSON.stringify(
                              {
                                mcpServers: {
                                  atlas: {
                                    url:
                                      config?.mcp_url ??
                                      `${location.origin}/mcp/`,
                                  },
                                },
                              },
                              null,
                              2,
                            ),
                          )
                          .then(() => setSnack("Example configuration copied"))
                          .catch(() =>
                            setSnack(
                              "Copy unavailable. Select the configuration text to copy it.",
                            ),
                          );
                      }}
                    >
                      Copy example
                    </Button>
                  </section>
                  <section>
                    <h3>Tools for exploring your files</h3>
                    {[
                      ["list_collections", "See the available collections."],
                      ["get_collection", "Read a collection’s overview."],
                      ["search", "Find files by meaning."],
                      ["similar", "Explore related files."],
                      ["get_item", "Read a source and its preview."],
                    ].map(([name, detail]) => (
                      <div className="tool-row" key={name}>
                        <code>{name}</code>
                        <span>{detail}</span>
                      </div>
                    ))}
                  </section>
                </div>
                <Divider />
                <div className="architecture-strip">
                  <span>
                    <b>Datastore mode</b>Catalogue & indexing jobs
                  </span>
                  <span>
                    <b>Cloud Storage</b>Files, embeddings & previews
                  </span>
                  <span>
                    <b>Cloud Run</b>App, Ask & MCP
                  </span>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <Dialog
        open={uploadOpen}
        onClose={() => {
          if (!uploading) setUploadOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {replace ? "Replace file" : "Add to your collection"}
          <IconButton
            className="dialog-close"
            aria-label="Close upload"
            disabled={uploading}
            onClick={() => setUploadOpen(false)}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <p className="dialog-intro">
            {replace
              ? `Choose a new version of ${replace.name}. It will need indexing again.`
              : `Upload to ${collection?.name}. Images, recordings, documents—keep them together.`}
          </p>
          <button
            disabled={uploading}
            className={`upload-dropzone ${dragging ? "dragging" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void uploadFiles(e.dataTransfer.files);
            }}
          >
            <CloudUploadOutlined sx={{ fontSize: 38 }} />
            <strong>
              {uploading ? "Saving files…" : "Drop files here, or browse"}
            </strong>
            <span>Images, MP4, MOV, MP3, WAV, PDF, Markdown, TXT</span>
            <small>Up to {config?.max_upload_mb ?? 100} MB per file</small>
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept={accept}
            multiple={!replace}
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
            }}
            aria-label="Choose files"
          />
          {uploading && <LinearProgress sx={{ mt: 2 }} />}
          {uploadError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {uploadError}
            </Alert>
          )}
          <Alert icon={<UploadFileOutlined />} severity="info" sx={{ mt: 2 }}>
            Files are saved to shared storage. Uploads stay pending until you
            update the index.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button disabled={uploading} onClick={() => setUploadOpen(false)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={indexOpen}
        onClose={() => setIndexOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Update collection index</DialogTitle>
        <DialogContent>
          <div className="index-detail-row">
            <span>New or changed files</span>
            <b>{estimate?.files ?? pending.length}</b>
          </div>
          <div className="index-detail-row">
            <span>Unchanged files</span>
            <b>{estimate?.unchanged ?? 0}</b>
          </div>
          <p className="dialog-intro">
            Only new or changed content is embedded. A complete map is published
            when the job finishes.
          </p>
          {estimate && (
            <Alert severity="info">
              {sizeLabel(estimate.bytes)} to process.{" "}
              {config?.provider === "offline"
                ? "Offline indexing makes no model calls."
                : `Up to ${estimate.max_ai_calls} model calls; actual usage depends on pages and duration.`}
            </Alert>
          )}
          {indexError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {indexError}
            </Alert>
          )}
          {job && job.collection === collection?.id && (
            <div style={{ marginTop: 20 }}>
              <p>{job.message}</p>
              {running && (
                <LinearProgress
                  sx={{ my: 2 }}
                  variant={job.total ? "determinate" : "indeterminate"}
                  value={job.total ? (100 * job.completed) / job.total : 0}
                />
              )}
              {job.errors?.map((e) => (
                <Alert key={e.asset} severity="warning" sx={{ mt: 1 }}>
                  {e.name}: {e.message}
                </Alert>
              ))}
            </div>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIndexOpen(false)}>Close</Button>
          <Button
            variant="contained"
            disabled={running || !config?.configured}
            onClick={() => void startIndex()}
          >
            {running ? "Indexing…" : "Start update"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createCollection();
          }}
        >
          <DialogTitle>New collection</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Collection name"
              fullWidth
              margin="dense"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={2}
              margin="normal"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 240 } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              type="submit"
              disabled={!newName.trim()}
            >
              Create collection
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Dialog
        open={deleting.length > 0}
        onClose={() => setDeleting([])}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          Remove {deleting.length} {deleting.length === 1 ? "file" : "files"}?
        </DialogTitle>
        <DialogContent>
          <p>
            This removes the files, previews, and search references from this
            collection. Original files on your computer are unaffected.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting([])}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void removeFiles()}
          >
            Remove files
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={!!preview}
        onClose={() => setPreview(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {preview?.name}
          <IconButton
            className="dialog-close"
            aria-label="Close preview"
            onClick={() => setPreview(null)}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {preview && (
            <>
              {preview.url && preview.kind === "video" ? (
                <video className="media-player" controls src={preview.url} />
              ) : preview.url && preview.kind === "audio" ? (
                <audio className="audio-player" controls src={preview.url} />
              ) : preview.url && preview.mime === "application/pdf" ? (
                <object
                  className="pdf-preview"
                  type="application/pdf"
                  data={preview.url}
                >
                  <a href={preview.url} download={preview.name}>
                    Download PDF to view it
                  </a>
                </object>
              ) : preview.kind === "document" ? (
                <pre className="text-preview">
                  {preview.text || preview.description}
                </pre>
              ) : (
                <AssetVisual asset={preview} large />
              )}
              {preview.kind !== "document" && <p>{preview.description}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Atlas, a workspace for your files</DialogTitle>
        <DialogContent>
          <p>
            Upload files, explore their connections in 2D or 3D, and ask
            questions with source references.
          </p>
          <h3>One shared workspace</h3>
          <p>
            Collections and jobs are stored in Datastore mode. Sources,
            embeddings, and map snapshots live in object storage. There are no
            accounts or sign-in.
          </p>
          <h3>Connected tools</h3>
          <p>
            The MCP server exposes the same search and file information to your
            assistant. Content and Descriptions lenses use the corresponding
            embedding vectors.
          </p>
          <Alert severity="info">
            {config?.provider === "offline"
              ? "Offline mode uses hashed text features and verbatim excerpts for development. It is not Gemini."
              : "Gemini processes the files you choose to index. Answers include references to retrieved source passages."}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setHelpOpen(false)}>
            Got it
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!snack}
        autoHideDuration={5000}
        message={snack}
        onClose={() => setSnack("")}
        action={
          <IconButton
            color="inherit"
            size="small"
            aria-label="Dismiss notification"
            onClick={() => setSnack("")}
          >
            <Close fontSize="small" />
          </IconButton>
        }
      />
    </>
  );
}
