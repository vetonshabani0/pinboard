import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeShareCode } from "@pinboard/shared";
import { pinboardApi } from "../extensionApi";
import "./styles.css";

type Settings = {
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
      .get(["authorName", "enabled", "shareCode"])
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

  const getActiveTabUrl = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url;
  };

  const copyText = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    setStatus(message);
  };

  const copyPageLink = async () => {
    if (!settings.shareCode) return;

    const tabUrl = await getActiveTabUrl();
    if (!tabUrl) return;

    try {
      const url = new URL(tabUrl);
      url.hash = `pinboard=${settings.shareCode}`;
      await copyText(url.toString(), "Copied review link");
    } catch {
      await copyText(settings.shareCode, "Copied review code");
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
      setStatus(`Created review ${response.session.shareCode}`);
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
          <p>Drop shared feedback pins on this page.</p>
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

      {settings.shareCode ? (
        <section className="active-review">
          <div>
            <span>Active review</span>
            <strong>{settings.shareCode}</strong>
          </div>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() => void copyText(settings.shareCode!, "Copied review code")}
              type="button"
            >
              Copy code
            </button>
            <button className="secondary" onClick={() => void copyPageLink()} type="button">
              Copy link
            </button>
          </div>
        </section>
      ) : null}

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

      {status ? <p className="status">{status}</p> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
