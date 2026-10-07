import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  IconButton,
  TextField,
  Tooltip,
  LinearProgress,
} from "@mui/material";
import {
  ArrowUpward,
  AutoAwesomeOutlined,
  NorthEast,
  HubOutlined,
  DeleteOutlined,
} from "@mui/icons-material";
import type { Asset, Turn } from "../types";
import { api } from "../api";
import AssetVisual from "./AssetVisual";

const suggestions = [
  "What are the main themes in this collection?",
  "Which files discuss similar ideas?",
  "Summarize the most useful source material.",
];
export default function AskView({
  assets,
  collectionName,
  collectionId,
  provider,
  turns,
  initialQuestion,
  onTurns,
  onMap,
  onPreview,
}: {
  assets: Asset[];
  collectionName: string;
  collectionId: string;
  provider: string;
  turns: Turn[];
  initialQuestion: string;
  onTurns: (turns: Turn[]) => void;
  onMap: (ids: string[]) => void;
  onPreview: (a: Asset) => void;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setQuestion(initialQuestion);
  }, [initialQuestion]);
  useEffect(() => {
    if (turns.length)
      end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length]);
  async function submit(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.ask(collectionId, q.trim(), turns);
      onTurns([
        ...turns,
        {
          id: crypto.randomUUID(),
          question: q.trim(),
          answer: response.answer,
          sources: response.citations.map((c) => c.asset),
          citations: response.citations,
          provider: response.provider,
        },
      ]);
      setQuestion("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not answer. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function sourceAsset(t: Turn, index: number) {
    const asset = assets.find((a) => a.id === t.sources[index]);
    const citation = t.citations?.[index];
    if (!asset || !citation) return asset;
    const fragment = citation.location.page
      ? `#page=${citation.location.page}`
      : citation.location.start !== undefined
        ? `#t=${citation.location.start},${citation.location.end}`
        : "";
    return {
      ...asset,
      url: asset.url?.split("#")[0] + fragment,
      text: citation.text,
      description: citation.text,
    };
  }
  return (
    <div className="ask-view">
      <div className="ask-width">
        {turns.length === 0 ? (
          <div className="ask-welcome">
            <div className="ask-symbol">
              <AutoAwesomeOutlined />
            </div>
            <h2>A question is another way in.</h2>
            <p>
              Explore {collectionName.toLowerCase()} through its files.
              <br />
              Follow each answer back to its sources.
            </p>
            <div className="ask-suggestions">
              {suggestions.map((s) => (
                <button key={s} disabled={busy} onClick={() => void submit(s)}>
                  {s}
                  <NorthEast sx={{ fontSize: 16 }} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ask-conversation">
            <div className="conversation-heading">
              <span>About {collectionName}</span>
              <Tooltip title="Clear this conversation">
                <IconButton
                  aria-label="Clear conversation"
                  size="small"
                  onClick={() => onTurns([])}
                >
                  <DeleteOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
            {turns.map((t) => (
              <section className="ask-turn" key={t.id}>
                <h3>{t.question}</h3>
                <div className="answer-label">
                  <AutoAwesomeOutlined sx={{ fontSize: 16 }} />
                  <b>Atlas</b>
                  <Chip
                    label={
                      t.provider === "offline"
                        ? "Offline excerpts"
                        : "Gemini on Vertex AI · With sources"
                    }
                    size="small"
                  />
                </div>
                <div className="answer-text">
                  {t.answer.split(/(\[\d+\])/).map((part, i) => {
                    const ref = /^\[(\d+)\]$/.exec(part);
                    const asset = ref
                      ? sourceAsset(t, Number(ref[1]) - 1)
                      : undefined;
                    return asset ? (
                      <button
                        key={i}
                        className="citation"
                        onClick={() => onPreview(asset)}
                        aria-label={`Source ${ref![1]}: ${asset.name}`}
                      >
                        {ref![1]}
                      </button>
                    ) : (
                      <span key={i}>{part}</span>
                    );
                  })}
                </div>
                <div className="source-grid">
                  {t.sources.map((id, i) => {
                    const a = sourceAsset(t, i);
                    return (
                      a && (
                        <button key={`${id}-${i}`} onClick={() => onPreview(a)}>
                          <AssetVisual asset={a} />
                          <span>
                            <small>
                              Source {i + 1}
                              {t.citations?.[i]?.location.page
                                ? ` · Page ${t.citations[i].location.page}`
                                : t.citations?.[i]?.location.start !== undefined
                                  ? ` · ${t.citations[i].location.start}s`
                                  : ""}
                            </small>
                            <b>{a.name}</b>
                          </span>
                        </button>
                      )
                    );
                  })}
                </div>
                {t.sources.length > 0 && (
                  <Button
                    size="small"
                    startIcon={<HubOutlined />}
                    onClick={() => onMap(t.sources)}
                  >
                    Show sources on the map
                  </Button>
                )}
              </section>
            ))}
            <div ref={end} />
          </div>
        )}
        <div className="ask-composer-wrap">
          {provider === "offline" && (
            <Alert icon={false} severity="info" className="preview-notice">
              Offline development · Word-feature retrieval and source excerpts.
              Gemini is not being called.
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {busy && (
            <LinearProgress aria-label="Finding sources and writing answer" />
          )}
          <form
            className="ask-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(question);
            }}
          >
            <TextField
              fullWidth
              multiline
              maxRows={5}
              variant="standard"
              placeholder="Ask something about your collection…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              slotProps={{
                input: { disableUnderline: true },
                htmlInput: { "aria-label": "Ask your collection" },
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit(question);
                }
              }}
            />
            <IconButton
              color="primary"
              aria-label="Send question"
              onClick={() => submit(question)}
              disabled={busy || !question.trim()}
            >
              <ArrowUpward />
            </IconButton>
          </form>
          <div className="composer-caption">
            <span>Answers should always lead to evidence.</span>
            <span>Enter to send</span>
          </div>
        </div>
      </div>
    </div>
  );
}
