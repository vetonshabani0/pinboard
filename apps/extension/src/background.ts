type ApiMessage = {
  type: "pinboard:api";
  endpoint: string;
  payload?: unknown;
};

const PINBOARD_API_URL =
  (import.meta.env.VITE_PINBOARD_API_URL as string | undefined) ||
  "https://prestigious-jay-126.eu-west-1.convex.site";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
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
