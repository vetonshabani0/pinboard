import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeShareCode } from "@pinboard/shared";
import { pinboardApi } from "../extensionApi";
import "./styles.css";

type Settings = {
  apiUrl?: string;
  authorName?: string;
  enabled?: boolean;
  shareCode?: string;
};

function App() {
  const [settings, setSettings] = useState<Settings>({});
  const [reviewName, setReviewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void chrome.storage.local
      .get(["apiUrl", "authorName", "enabled", "shareCode"])
      .then((value) => setSettings(value as Settings));
  }, []);

  const saveSettings = async (next: Settings) => {
    const merged = { ...settings, ...next };
    await chrome.storage.local.set(merged);
    setSettings(merged);
  };

  const getActiveTabOrigin = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return undefined;

    try {
      return new URL(tab.url).origin;
    } catch {
      return undefined;
    }
  };

  const createSession = async () => {
    setStatus("Creating review...");

    try {
      const response = await pinboardApi<{ session: { shareCode: string; name: string } }>(
        "/api/session/create",
        {
          name: reviewName,
          siteOrigin: await getActiveTabOrigin(),
          authorName: settings.authorName
        }
      );

      await saveSettings({
        shareCode: response.session.shareCode,
        enabled: true
      });
      setStatus(`Created ${response.session.shareCode}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create review");
    }
  };

  const joinSession = async () => {
    const shareCode = normalizeShareCode(joinCode || settings.shareCode || "");
    if (!shareCode) return;

    setStatus("Joining review...");

    try {
      await pinboardApi("/api/session/join", { shareCode });
      await saveSettings({ shareCode, enabled: true });
      setStatus(`Joined ${shareCode}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not join review");
    }
  };

  return (
    <main>
      <header>
        <div>
          <h1>Pinboard</h1>
          <p>Shared pins for website feedback.</p>
        </div>
        <label className="switch">
          <input
            checked={Boolean(settings.enabled)}
            onChange={(event) => void saveSettings({ enabled: event.target.checked })}
            type="checkbox"
          />
          <span />
        </label>
      </header>

      <label>
        Convex site URL
        <input
          onChange={(event) => void saveSettings({ apiUrl: event.target.value })}
          placeholder="https://name.convex.site"
          value={settings.apiUrl || ""}
        />
      </label>

      <label>
        Your name
        <input
          onChange={(event) => void saveSettings({ authorName: event.target.value })}
          placeholder="Veton"
          value={settings.authorName || ""}
        />
      </label>

      <section>
        <label>
          New review
          <input
            onChange={(event) => setReviewName(event.target.value)}
            placeholder="Homepage design pass"
            value={reviewName}
          />
        </label>
        <button onClick={() => void createSession()} type="button">
          Create session
        </button>
      </section>

      <section>
        <label>
          Join code
          <input
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder={settings.shareCode || "ABC123"}
            value={joinCode}
          />
        </label>
        <button onClick={() => void joinSession()} type="button">
          Join session
        </button>
      </section>

      {settings.shareCode ? (
        <div className="current">
          <span>Current code</span>
          <strong>{settings.shareCode}</strong>
        </div>
      ) : null}

      {status ? <p className="status">{status}</p> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

