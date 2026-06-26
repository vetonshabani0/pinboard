import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeShareCode, type PinboardComment } from "@pinboard/shared";
import { pinboardApi } from "../extensionApi";
import "./styles.css";

type Settings = {
  authorName?: string;
  enabled?: boolean;
  shareCode?: string;
};

type ActivePage = {
  tabId?: number;
  url?: string;
  origin?: string;
  path?: string;
};

type ApiComment = PinboardComment & { _id?: string };

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
  const [settings, setSettings] = useState<Settings>({});
  const [page, setPage] = useState<ActivePage>({});
  const [comments, setComments] = useState<PinboardComment[]>([]);
  const [reviewName, setReviewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => comments.find((comment) => comment.id === selectedId) || comments[0],
    [comments, selectedId]
  );

  const openCount = useMemo(
    () => comments.filter((comment) => comment.status === "open").length,
    [comments]
  );

  const loadSettings = useCallback(async () => {
    const value = await chrome.storage.local.get(["authorName", "enabled", "shareCode"]);
    setSettings(value as Settings);
  }, []);

  const loadActivePage = useCallback(async (): Promise<ActivePage> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url) {
      setPage({});
      return {};
    }

    try {
      const url = new URL(tab.url);
      const next: ActivePage = {
        tabId: tab.id,
        url: tab.url,
        origin: url.origin,
        path: `${url.pathname}${url.search}`
      };
      setPage(next);
      return next;
    } catch {
      const next: ActivePage = { tabId: tab.id, url: tab.url };
      setPage(next);
      return next;
    }
  }, []);

  const saveSettings = async (next: Settings) => {
    const merged = { ...settings, ...next };
    await chrome.storage.local.set(merged);
    setSettings(merged);
  };

  const loadComments = useCallback(async () => {
    if (!settings.shareCode) return;

    const activePage = await loadActivePage();
    if (!activePage.origin || !activePage.path) return;

    try {
      const response = await pinboardApi<{ comments: ApiComment[] }>("/api/comments/list", {
        shareCode: settings.shareCode,
        origin: activePage.origin,
        path: activePage.path
      });

      const nextComments = response.comments.map(toComment).sort((a, b) => a.createdAt - b.createdAt);
      setComments(nextComments);

      if (selectedId && !nextComments.some((comment) => comment.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load comments");
    }
  }, [loadActivePage, selectedId, settings.shareCode]);

  useEffect(() => {
    void loadSettings();
    void loadActivePage();

    const onStorageChanged = () => void loadSettings();
    chrome.storage.onChanged.addListener(onStorageChanged);

    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [loadActivePage, loadSettings]);

  useEffect(() => {
    void loadComments();
    const interval = window.setInterval(() => void loadComments(), 3000);

    return () => window.clearInterval(interval);
  }, [loadComments]);

  const createSession = async () => {
    setStatus("Creating review...");
    const activePage = await loadActivePage();

    try {
      const response = await pinboardApi<{ session: { shareCode: string } }>("/api/session/create", {
        name: reviewName,
        siteOrigin: activePage.origin,
        authorName: settings.authorName
      });

      await saveSettings({
        enabled: true,
        shareCode: response.session.shareCode
      });
      setStatus(`Active session ${response.session.shareCode}`);
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not connect");
    }
  };

  const sendToActiveTab = async (message: unknown) => {
    const activePage = await loadActivePage();
    if (!activePage.tabId) return;

    try {
      await chrome.tabs.sendMessage(activePage.tabId, message);
    } catch {
      setStatus("Reload the page once so Pinboard can attach.");
    }
  };

  const startPin = async () => {
    if (!settings.shareCode) {
      setStatus("Create or connect to a session first.");
      return;
    }

    await saveSettings({ enabled: true });
    await sendToActiveTab({
      type: "pinboard:startPin"
    });
    setStatus("Click the page to place a pin.");
  };

  const focusComment = async (commentId: string) => {
    setSelectedId(commentId);
    await sendToActiveTab({
      type: "pinboard:focusComment",
      commentId
    });
  };

  const updateStatus = async (comment: PinboardComment, nextStatus: "open" | "resolved") => {
    if (!settings.shareCode) return;

    await pinboardApi("/api/comments/status", {
      shareCode: settings.shareCode,
      commentId: comment.id,
      status: nextStatus
    });
    await loadComments();
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

  const copyText = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    setStatus(message);
  };

  const copyPageLink = async () => {
    if (!settings.shareCode || !page.url) return;

    try {
      const url = new URL(page.url);
      url.hash = `pinboard=${settings.shareCode}`;
      await copyText(url.toString(), "Copied review link");
    } catch {
      await copyText(settings.shareCode, "Copied review code");
    }
  };

  return (
    <main>
      <header>
        <div>
          <h1>Pinboard</h1>
          <p>{page.origin ? page.origin.replace(/^https?:\/\//, "") : "Open a webpage to review"}</p>
        </div>
        <label className="switch" title="Show pins on page">
          <input
            checked={Boolean(settings.enabled)}
            onChange={(event) => void saveSettings({ enabled: event.target.checked })}
            type="checkbox"
          />
          <span />
        </label>
      </header>

      <label>
        Your name
        <input
          onChange={(event) => void saveSettings({ authorName: event.target.value })}
          placeholder="Your name"
          value={settings.authorName || ""}
        />
      </label>

      {settings.shareCode ? (
        <section className="active-review">
          <div className="active-review-top">
            <span>Active session</span>
            <strong>{settings.shareCode}</strong>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={() => void copyText(settings.shareCode!, "Copied code")} type="button">
              Copy code
            </button>
            <button className="secondary" onClick={() => void copyPageLink()} type="button">
              Copy link
            </button>
          </div>
        </section>
      ) : (
        <section className="setup">
          <label>
            New review
            <input
              onChange={(event) => setReviewName(event.target.value)}
              placeholder="Homepage pass"
              value={reviewName}
            />
          </label>
          <button onClick={() => void createSession()} type="button">
            Create session
          </button>

          <label>
            Connect to session
            <input
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              value={joinCode}
            />
          </label>
          <button className="secondary" onClick={() => void joinSession()} type="button">
            Connect
          </button>
        </section>
      )}

      {settings.shareCode ? (
        <>
          <section className="comment-toolbar">
            <div>
              <strong>Comments</strong>
              <span>{openCount} open</span>
            </div>
            <button onClick={() => void startPin()} type="button">
              Add pin
            </button>
          </section>

          <section className="comment-list">
            {comments.length === 0 ? (
              <div className="empty-state">
                <strong>No pins here yet</strong>
                <span>Click Add pin, then pick a place on the webpage.</span>
              </div>
            ) : null}

            {comments.map((comment, index) => (
              <article
                className={comment.id === selected?.id ? "is-selected" : ""}
                key={comment.id}
                onClick={() => void focusComment(comment.id)}
              >
                <div className="comment-card-top">
                  <span>#{index + 1} · {comment.elementLabel || "Page"}</span>
                  <button
                    className="ghost"
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
                <div className="comment-meta">
                  <span>{comment.authorName}</span>
                  <span>{formatAge(comment.createdAt)}</span>
                </div>

                {(comment.replies || []).map((reply) => (
                  <div className="reply" key={reply.id}>
                    <p>{reply.text}</p>
                    <span>{reply.authorName} · {formatAge(reply.createdAt)}</span>
                  </div>
                ))}

                <div className="reply-box" onClick={(event) => event.stopPropagation()}>
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
                  <button className="icon-button" onClick={() => void addReply(comment)} type="button">
                    ↑
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}

      {status ? <p className="status">{status}</p> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
