type ApiMessage = {
  type?: "pinboard:api";
  endpoint: string;
  payload?: unknown;
};

const PINBOARD_API_URL =
  (import.meta.env.VITE_PINBOARD_API_URL as string | undefined) ||
  "https://prestigious-jay-126.eu-west-1.convex.site";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;

  void togglePinboard(tab.id);
});

chrome.runtime.onMessage.addListener((message: ApiMessage, _sender, sendResponse) => {
  if (message?.type !== "pinboard:api") {
    return false;
  }

  void callApi(message.endpoint, message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Request failed" }));

  return true;
});

async function callApi(endpoint: string, payload: unknown) {
  const apiUrl = PINBOARD_API_URL.replace(/\/$/, "");

  const response = await fetch(`${apiUrl}${endpoint}`, {
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

  return body;
}

async function togglePinboard(tabId: number) {
  const attached = await ensureContentScript(tabId);
  if (!attached) return;

  await chrome.tabs.sendMessage(tabId, { type: "pinboard:togglePanel" });
}

async function ensureContentScript(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "pinboard:ping" });
    return true;
  } catch {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["assets/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["assets/content.js"]
      });
      return true;
    } catch {
      return false;
    }
  }
}
