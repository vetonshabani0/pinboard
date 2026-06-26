import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeShareCode, type PinboardComment } from "@pinboard/shared";
import { pinboardApi } from "./extensionApi";
import "./content.css";

type StorageState = {
  enabled?: boolean;
  shareCode?: string;
  authorName?: string;
};

type DraftPin = {
  pageX: number;
  pageY: number;
  xPercent: number;
  yPercent: number;
  elementLabel?: string;
};

const rootId = "pinboard-extension-root";

function getPageMeta() {
  return {
    url: window.location.href,
    origin: window.location.origin,
    path: `${window.location.pathname}${window.location.search}`,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };
}

function getDocumentSize() {
  const doc = document.documentElement;
  return {
    width: Math.max(doc.scrollWidth, document.body.scrollWidth, window.innerWidth),
    height: Math.max(doc.scrollHeight, document.body.scrollHeight, window.innerHeight)
  };
}

function getElementLabel(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return undefined;

  const aria = target.getAttribute("aria-label");
  const text = target.innerText?.trim().replace(/\s+/g, " ");
  const label = aria || text || target.id || target.tagName.toLowerCase();

  return label.slice(0, 120);
}

function isPinboardTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("[data-pinboard-ui='true']"));
}

function getShareCodeFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const code = new URLSearchParams(hash).get("pinboard");

  return code ? normalizeShareCode(code) : "";
}

function App() {
  const [settings, setSettings] = useState<StorageState>({});
  const [comments, setComments] = useState<PinboardComment[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [draftText, setDraftText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docSize, setDocSize] = useState(getDocumentSize);

  const selected = useMemo(
    () => comments.find((comment) => comment.id === selectedId),
    [comments, selectedId]
  );

  const loadSettings = useCallback(async () => {
    const next = await chrome.storage.local.get(["enabled", "shareCode", "authorName"]);
    setSettings(next as StorageState);
  }, []);

  const loadComments = useCallback(async () => {
    if (!settings.enabled || !settings.shareCode) return;

    try {
      setError(null);
      const page = getPageMeta();
      const response = await pinboardApi<{ comments: Array<PinboardComment & { _id?: string }> }>(
        "/api/comments/list",
        {
          shareCode: settings.shareCode,
          origin: page.origin,
          path: page.path
        }
      );

      setComments(
        response.comments.map((comment) => ({
          ...comment,
          id: comment.id || comment._id || ""
        }))
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load comments");
    }
  }, [settings.enabled, settings.shareCode]);

  useEffect(() => {
    const codeFromLink = getShareCodeFromHash();

    if (codeFromLink) {
      void chrome.storage.local.set({
        enabled: true,
        shareCode: codeFromLink
      });
    }

    void loadSettings();

    const onStorageChanged = () => void loadSettings();
    chrome.storage.onChanged.addListener(onStorageChanged);

    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [loadSettings]);

  useEffect(() => {
    void loadComments();

    const interval = window.setInterval(() => void loadComments(), 5000);
    return () => window.clearInterval(interval);
  }, [loadComments]);

  useEffect(() => {
    const syncSize = () => setDocSize(getDocumentSize());
    window.addEventListener("resize", syncSize);
    window.addEventListener("scroll", syncSize, { passive: true });

    return () => {
      window.removeEventListener("resize", syncSize);
      window.removeEventListener("scroll", syncSize);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("pinboard-crosshair", isAdding);
    return () => document.body.classList.remove("pinboard-crosshair");
  }, [isAdding]);

  useEffect(() => {
    if (!isAdding) return undefined;

    const onClick = (event: MouseEvent) => {
      if (isPinboardTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();

      const size = getDocumentSize();
      setDraft({
        pageX: event.pageX,
        pageY: event.pageY,
        xPercent: (event.pageX / size.width) * 100,
        yPercent: (event.pageY / size.height) * 100,
        elementLabel: getElementLabel(event.target)
      });
      setIsAdding(false);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isAdding]);

  const saveDraft = async () => {
    if (!draft || !settings.shareCode || !draftText.trim()) return;

    const page = getPageMeta();
    await pinboardApi("/api/comments/create", {
      shareCode: settings.shareCode,
      ...page,
      xPercent: draft.xPercent,
      yPercent: draft.yPercent,
      elementLabel: draft.elementLabel,
      text: draftText,
      authorName: settings.authorName || "Anonymous"
    });

    setDraft(null);
    setDraftText("");
    await loadComments();
  };

  const updateStatus = async (comment: PinboardComment, status: "open" | "resolved") => {
    if (!settings.shareCode) return;

    await pinboardApi("/api/comments/status", {
      shareCode: settings.shareCode,
      commentId: comment.id,
      status
    });

    setSelectedId(null);
    await loadComments();
  };

  if (!settings.enabled || !settings.shareCode) {
    return null;
  }

  return (
    <div
      className="pinboard-root"
      style={{ height: docSize.height, width: docSize.width }}
      data-pinboard-ui="true"
    >
      <div className="pinboard-toolbar">
        <strong>{settings.shareCode}</strong>
        <button
          className={`pinboard-button ${isAdding ? "is-active" : ""}`}
          onClick={() => {
            setDraft(null);
            setSelectedId(null);
            setIsAdding((value) => !value);
          }}
          type="button"
        >
          Pin
        </button>
        <button className="pinboard-button" onClick={() => void loadComments()} type="button">
          Sync
        </button>
        {error ? <span className="pinboard-hint">{error}</span> : null}
      </div>

      {comments.map((comment, index) => (
        <button
          key={comment.id}
          className={`pinboard-pin ${comment.status === "resolved" ? "is-resolved" : ""}`}
          onClick={() => setSelectedId(comment.id)}
          style={{
            left: `${comment.xPercent}%`,
            top: `${comment.yPercent}%`
          }}
          title={comment.text}
          type="button"
        >
          <span>{index + 1}</span>
        </button>
      ))}

      {draft ? (
        <div className="pinboard-composer" style={{ left: draft.pageX, top: draft.pageY }}>
          <textarea
            autoFocus
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="What should change here?"
            value={draftText}
          />
          <div className="pinboard-actions">
            <button className="pinboard-button" onClick={() => setDraft(null)} type="button">
              Cancel
            </button>
            <button className="pinboard-button is-active" onClick={() => void saveDraft()} type="button">
              Save
            </button>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div
          className="pinboard-popover"
          style={{
            left: `${selected.xPercent}%`,
            top: `${selected.yPercent}%`
          }}
        >
          <div className="pinboard-meta">
            <span>{selected.authorName}</span>
            <span>{selected.status}</span>
          </div>
          <p>{selected.text}</p>
          <div className="pinboard-actions">
            <button className="pinboard-button" onClick={() => setSelectedId(null)} type="button">
              Close
            </button>
            <button
              className="pinboard-button is-active"
              onClick={() => void updateStatus(selected, selected.status === "resolved" ? "open" : "resolved")}
              type="button"
            >
              {selected.status === "resolved" ? "Reopen" : "Resolve"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function mount() {
  if (document.getElementById(rootId)) return;

  const host = document.createElement("div");
  host.id = rootId;
  document.body.append(host);
  createRoot(host).render(<App />);
}

mount();
