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

type ApiComment = PinboardComment & { _id?: string };

const rootId = "pinboard-extension-root";
const openPanelKey = "pinboardOpenPanelRequest";

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

function getShareCodeFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const code = new URLSearchParams(hash).get("pinboard");

  return code ? normalizeShareCode(code) : "";
}

function isPinboardTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("[data-pinboard-ui='true']"));
}

function toComment(comment: ApiComment): PinboardComment {
  return {
    ...comment,
    id: comment.id || comment._id || ""
  };
}

function formatAge(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

function App() {
  const [settings, setSettings] = useState<StorageState>({});
  const [comments, setComments] = useState<PinboardComment[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [draftText, setDraftText] = useState("");
  const [reviewName, setReviewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [docSize, setDocSize] = useState(getDocumentSize);
  const [pageKey, setPageKey] = useState(() => {
    const page = getPageMeta();
    return `${page.origin}${page.path}`;
  });

  const page = getPageMeta();
  const selected = useMemo(
    () => comments.find((comment) => comment.id === selectedId),
    [comments, selectedId]
  );
  const openCount = useMemo(
    () => comments.filter((comment) => comment.status === "open").length,
    [comments]
  );

  const loadSettings = useCallback(async () => {
    const next = await chrome.storage.local.get([
      "enabled",
      "shareCode",
      "authorName",
      openPanelKey
    ]);
    setSettings(next as StorageState);

    if (next[openPanelKey]) {
      setPanelOpen(true);
      void chrome.storage.local.remove(openPanelKey);
    }
  }, []);

  const saveSettings = async (next: StorageState) => {
    const merged = { ...settings, ...next };
    await chrome.storage.local.set(merged);
    setSettings(merged);
  };

  const loadComments = useCallback(async () => {
    if (!settings.enabled || !settings.shareCode) {
      setComments([]);
      return;
    }

    try {
      const current = getPageMeta();
      const response = await pinboardApi<{ comments: ApiComment[] }>("/api/comments/list", {
        shareCode: settings.shareCode,
        origin: current.origin,
        path: current.path
      });

      const nextComments = response.comments.map(toComment).sort((a, b) => a.createdAt - b.createdAt);
      setComments(nextComments);

      if (selectedId && !nextComments.some((comment) => comment.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load comments");
    }
  }, [selectedId, settings.enabled, settings.shareCode]);

  useEffect(() => {
    const codeFromLink = getShareCodeFromHash();

    if (codeFromLink) {
      setPanelOpen(true);
      void chrome.storage.local.set({
        enabled: true,
        shareCode: codeFromLink
      });
    }

    void loadSettings();

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[openPanelKey]?.newValue) {
        setPanelOpen(true);
        void chrome.storage.local.remove(openPanelKey);
        return;
      }

      void loadSettings();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [loadSettings]);

  useEffect(() => {
    void loadComments();
    const interval = window.setInterval(() => void loadComments(), 3000);

    return () => window.clearInterval(interval);
  }, [loadComments, pageKey]);

  useEffect(() => {
    const syncSize = () => setDocSize(getDocumentSize());
    window.addEventListener("resize", syncSize);
    window.addEventListener("scroll", syncSize, { passive: true });

    const interval = window.setInterval(() => {
      syncSize();
      const current = getPageMeta();
      const nextPageKey = `${current.origin}${current.path}`;

      if (nextPageKey !== pageKey) {
        setPageKey(nextPageKey);
        setSelectedId(null);
        setDraft(null);
        setDraftText("");
      }
    }, 500);

    return () => {
      window.removeEventListener("resize", syncSize);
      window.removeEventListener("scroll", syncSize);
      window.clearInterval(interval);
    };
  }, [pageKey]);

  useEffect(() => {
    document.body.classList.toggle("pinboard-pin-cursor", isAdding);
    return () => document.body.classList.remove("pinboard-pin-cursor");
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

  useEffect(() => {
    const onMessage = (
      message: { type?: string; commentId?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (message.type === "pinboard:ping") {
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "pinboard:togglePanel") {
        setPanelOpen((value) => !value);
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "pinboard:openPanel") {
        setPanelOpen(true);
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "pinboard:startPin") {
        setPanelOpen(true);
        setDraft(null);
        setSelectedId(null);
        setIsAdding(true);
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "pinboard:focusComment" && message.commentId) {
        focusComment(message.commentId);
        sendResponse({ ok: true });
        return true;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  });

  const createSession = async () => {
    setStatus("Creating review...");

    try {
      const response = await pinboardApi<{ session: { shareCode: string } }>("/api/session/create", {
        name: reviewName,
        siteOrigin: page.origin,
        authorName: settings.authorName
      });

      await saveSettings({
        enabled: true,
        shareCode: response.session.shareCode
      });
      setStatus(`Active session ${response.session.shareCode}`);
      await loadComments();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create review");
    }
  };

  const joinSession = async () => {
    const shareCode = normalizeShareCode(joinCode || settings.shareCode || "");
    if (!shareCode) return;

    setStatus("Connecting...");

    try {
      await pinboardApi("/api/session/join", { shareCode });
      await saveSettings({ enabled: true, shareCode });
      setStatus(`Active session ${shareCode}`);
      await loadComments();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not connect");
    }
  };

  const startPin = async () => {
    if (!settings.shareCode) {
      setStatus("Create or connect to a session first.");
      return;
    }

    await saveSettings({ enabled: true });
    setPanelOpen(false);
    setDraft(null);
    setSelectedId(null);
    setIsAdding(true);
    setStatus("Click the page to place a pin.");
  };

  const saveDraft = async () => {
    if (!draft || !settings.shareCode || !draftText.trim()) return;

    const current = getPageMeta();
    await pinboardApi("/api/comments/create", {
      shareCode: settings.shareCode,
      ...current,
      xPercent: draft.xPercent,
      yPercent: draft.yPercent,
      elementLabel: draft.elementLabel,
      text: draftText,
      authorName: settings.authorName || "Anonymous"
    });

    setDraft(null);
    setDraftText("");
    setPanelOpen(true);
    await loadComments();
  };

  const focusComment = (commentId: string) => {
    const comment = comments.find((item) => item.id === commentId);
    setSelectedId(commentId);

    if (!comment) return;

    const x = (comment.xPercent / 100) * docSize.width;
    const y = (comment.yPercent / 100) * docSize.height;
    window.scrollTo({
      left: Math.max(0, x - window.innerWidth / 2),
      top: Math.max(0, y - window.innerHeight / 2),
      behavior: "smooth"
    });
  };

  const addReply = async (comment: PinboardComment) => {
    if (!settings.shareCode) return;

    const text = replyDrafts[comment.id]?.trim();
    if (!text) return;

    await pinboardApi("/api/comments/reply", {
      shareCode: settings.shareCode,
      commentId: comment.id,
      text,
      authorName: settings.authorName || "Anonymous"
    });

    setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: "" }));
    await loadComments();
  };

  const updateStatus = async (comment: PinboardComment, status: "open" | "resolved") => {
    if (!settings.shareCode) return;

    await pinboardApi("/api/comments/status", {
      shareCode: settings.shareCode,
      commentId: comment.id,
      status
    });

    if (status === "resolved") setSelectedId(null);
    await loadComments();
  };

  const copyText = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    setStatus(message);
  };

  const copyPageLink = async () => {
    if (!settings.shareCode) return;

    const url = new URL(window.location.href);
    url.hash = `pinboard=${settings.shareCode}`;
    await copyText(url.toString(), "Copied review link");
  };

  return (
    <div
      className="pinboard-root"
      style={{ height: docSize.height, width: docSize.width }}
      data-pinboard-ui="true"
    >
      {settings.enabled && settings.shareCode
        ? comments.map((comment, index) => (
            <button
              key={comment.id}
              className={`pinboard-pin ${comment.status === "resolved" ? "is-resolved" : ""}`}
              onClick={() => focusComment(comment.id)}
              style={{
                left: `${comment.xPercent}%`,
                top: `${comment.yPercent}%`
              }}
              title={comment.text}
              type="button"
            >
              <span>{index + 1}</span>
            </button>
          ))
        : null}

      {isAdding ? (
        <div className="pinboard-placement-hint">
          <strong>Place a pin</strong>
          <span>Click anywhere on this page.</span>
          <button className="pinboard-button" onClick={() => setIsAdding(false)} type="button">
            Cancel
          </button>
        </div>
      ) : null}

      {draft ? (
        <div className="pinboard-composer" style={{ left: draft.pageX, top: draft.pageY }}>
          <div className="pinboard-composer-title">Add comment</div>
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
          {(selected.replies || []).map((reply) => (
            <div className="pinboard-reply" key={reply.id}>
              <p>{reply.text}</p>
              <span>{reply.authorName}</span>
            </div>
          ))}
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

      {panelOpen ? (
        <aside className="pinboard-panel">
          <header>
            <div>
              <h2>Pinboard</h2>
              <p>{page.origin.replace(/^https?:\/\//, "")}</p>
            </div>
            <button className="pinboard-icon-button" onClick={() => setPanelOpen(false)} type="button">
              ×
            </button>
          </header>

          <label className="pinboard-field">
            Your name
            <input
              onChange={(event) => void saveSettings({ authorName: event.target.value })}
              placeholder="Your name"
              value={settings.authorName || ""}
            />
          </label>

          {settings.shareCode ? (
            <section className="pinboard-active-session">
              <div>
                <span>Active session</span>
                <strong>{settings.shareCode}</strong>
              </div>
              <div className="pinboard-button-row">
                <button
                  className="pinboard-secondary-button"
                  onClick={() => void copyText(settings.shareCode!, "Copied code")}
                  type="button"
                >
                  Copy code
                </button>
                <button className="pinboard-secondary-button" onClick={() => void copyPageLink()} type="button">
                  Copy link
                </button>
              </div>
            </section>
          ) : (
            <section className="pinboard-setup">
              <label className="pinboard-field">
                New review
                <input
                  onChange={(event) => setReviewName(event.target.value)}
                  placeholder="Homepage pass"
                  value={reviewName}
                />
              </label>
              <button className="pinboard-primary-button" onClick={() => void createSession()} type="button">
                Create session
              </button>

              <label className="pinboard-field">
                Connect to session
                <input
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="ABC123"
                  value={joinCode}
                />
              </label>
              <button className="pinboard-secondary-button" onClick={() => void joinSession()} type="button">
                Connect
              </button>
            </section>
          )}

          {settings.shareCode ? (
            <>
              <section className="pinboard-comment-toolbar">
                <div>
                  <strong>Comments</strong>
                  <span>{openCount} open on this page</span>
                </div>
                <button className="pinboard-primary-button" onClick={() => void startPin()} type="button">
                  Add pin
                </button>
              </section>

              <section className="pinboard-comment-list">
                {comments.length === 0 ? (
                  <div className="pinboard-empty-state">
                    <strong>No pins on this page yet</strong>
                    <span>Add a pin here, or go to another page in this same session.</span>
                  </div>
                ) : null}

                {comments.map((comment, index) => (
                  <article
                    className={comment.id === selectedId ? "is-selected" : ""}
                    key={comment.id}
                    onClick={() => focusComment(comment.id)}
                  >
                    <div className="pinboard-comment-card-top">
                      <span>#{index + 1} · {comment.elementLabel || "Page"}</span>
                      <button
                        className="pinboard-text-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void updateStatus(comment, comment.status === "resolved" ? "open" : "resolved");
                        }}
                        type="button"
                      >
                        {comment.status === "resolved" ? "Reopen" : "Resolve"}
                      </button>
                    </div>
                    <p>{comment.text}</p>
                    <div className="pinboard-comment-meta">
                      <span>{comment.authorName}</span>
                      <span>{formatAge(comment.createdAt)}</span>
                    </div>

                    {(comment.replies || []).map((reply) => (
                      <div className="pinboard-panel-reply" key={reply.id}>
                        <p>{reply.text}</p>
                        <span>{reply.authorName} · {formatAge(reply.createdAt)}</span>
                      </div>
                    ))}

                    <div className="pinboard-reply-box" onClick={(event) => event.stopPropagation()}>
                      <input
                        onChange={(event) =>
                          setReplyDrafts((drafts) => ({
                            ...drafts,
                            [comment.id]: event.target.value
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void addReply(comment);
                        }}
                        placeholder="Reply"
                        value={replyDrafts[comment.id] || ""}
                      />
                      <button className="pinboard-icon-button is-send" onClick={() => void addReply(comment)} type="button">
                        ↑
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            </>
          ) : null}

          {status ? <p className="pinboard-status">{status}</p> : null}
        </aside>
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
