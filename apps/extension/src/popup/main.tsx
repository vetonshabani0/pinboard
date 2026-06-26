import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ActiveTab = {
  id?: number;
  url?: string;
};

const OPEN_PANEL_KEY = "pinboardOpenPanelRequest";

function canAttachToPage(tab: ActiveTab) {
  return Boolean(tab.id && tab.url && /^https?:\/\//.test(tab.url));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  return {
    id: tab?.id,
    url: tab?.url
  };
}

async function openDrawerOnPage(tab: ActiveTab) {
  if (!tab.id) return false;

  if (!canAttachToPage(tab)) {
    throw new Error("Open a normal website first.");
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      document.getElementById("pinboard-extension-root")?.remove();
      document.body.classList.remove("pinboard-pin-cursor");
    }
  });
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["assets/content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["assets/content.js"]
  });

  return true;
}

function App() {
  const [status, setStatus] = useState("Opening Pinboard...");
  const [canRetry, setCanRetry] = useState(false);

  const openPinboard = async () => {
    setCanRetry(false);
    setStatus("Opening Pinboard...");

    try {
      const tab = await getActiveTab();
      if (!tab.id) throw new Error("No active tab found.");

      await chrome.storage.local.set({ [OPEN_PANEL_KEY]: Date.now() });
      await openDrawerOnPage(tab);
      await chrome.storage.local.set({ [OPEN_PANEL_KEY]: Date.now() });
      setStatus("Pinboard opened on the page.");
      window.setTimeout(() => window.close(), 900);
    } catch (error) {
      setCanRetry(true);
      setStatus(error instanceof Error ? error.message : "Could not open Pinboard.");
    }
  };

  useEffect(() => {
    void openPinboard();
  }, []);

  return (
    <main>
      <h1>Pinboard</h1>
      <p>{status}</p>
      {canRetry ? (
        <button onClick={() => void openPinboard()} type="button">
          Try again
        </button>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
