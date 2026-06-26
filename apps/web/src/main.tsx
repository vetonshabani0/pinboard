import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeShareCode, type PinboardComment } from "@pinboard/shared";
import "./styles.css";

const DEFAULT_API_URL =
  (import.meta.env.VITE_PINBOARD_API_URL as string | undefined) ||
  "https://prestigious-jay-126.eu-west-1.convex.site";

async function api<T>(apiUrl: string, endpoint: string, payload?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload ?? {})
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Request failed with ${response.status}`);
  }

  return body as T;
}

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL || "");
  const [shareCode, setShareCode] = useState(
    normalizeShareCode(new URLSearchParams(window.location.search).get("code") || "")
  );
  const [comments, setComments] = useState<PinboardComment[]>([]);
  const [status, setStatus] = useState("");

  const openCount = useMemo(
    () => comments.filter((comment) => comment.status === "open").length,
    [comments]
  );

  const loadComments = async () => {
    const code = normalizeShareCode(shareCode);
    if (!apiUrl || !code) return;

    setStatus("Loading...");

    try {
      const response = await api<{ comments: Array<PinboardComment & { _id?: string }> }>(
        apiUrl,
        "/api/comments/list",
        { shareCode: code }
      );

      setComments(
        response.comments.map((comment) => ({
          ...comment,
          id: comment.id || comment._id || ""
        }))
      );
      setStatus(`Loaded ${response.comments.length} comments`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load session");
    }
  };

  const updateStatus = async (comment: PinboardComment, nextStatus: "open" | "resolved") => {
    const code = normalizeShareCode(shareCode);
    await api(apiUrl, "/api/comments/status", {
      shareCode: code,
      commentId: comment.id,
      status: nextStatus
    });
    await loadComments();
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Pinboard</p>
          <h1>Website feedback sessions</h1>
        </div>
        <div className="summary">
          <span>{comments.length} total</span>
          <strong>{openCount} open</strong>
        </div>
      </header>

      <section className="controls">
        <label>
          Convex site URL
          <input
            onChange={(event) => setApiUrl(event.target.value)}
            placeholder="https://name.convex.site"
            value={apiUrl}
          />
        </label>
        <label>
          Share code
          <input
            onChange={(event) => setShareCode(event.target.value.toUpperCase())}
            placeholder="ABC123"
            value={shareCode}
          />
        </label>
        <button onClick={() => void loadComments()} type="button">
          Load comments
        </button>
      </section>

      {status ? <p className="status">{status}</p> : null}

      <section className="comment-list">
        {comments.map((comment, index) => (
          <article key={comment.id}>
            <div className="comment-topline">
              <span>#{index + 1}</span>
              <strong>{comment.status}</strong>
            </div>
            <p>{comment.text}</p>
            <dl>
              <div>
                <dt>Author</dt>
                <dd>{comment.authorName}</dd>
              </div>
              <div>
                <dt>Page</dt>
                <dd>{comment.path}</dd>
              </div>
              {comment.elementLabel ? (
                <div>
                  <dt>Element</dt>
                  <dd>{comment.elementLabel}</dd>
                </div>
              ) : null}
            </dl>
            <button
              onClick={() =>
                void updateStatus(comment, comment.status === "resolved" ? "open" : "resolved")
              }
              type="button"
            >
              {comment.status === "resolved" ? "Reopen" : "Resolve"}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
