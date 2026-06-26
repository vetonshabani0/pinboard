type ApiMessage = {
  type: "pinboard:api";
  endpoint: string;
  payload?: unknown;
};

type StoredSettings = {
  apiUrl?: string;
};

const DEFAULT_API_URL = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;

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
  const settings = (await chrome.storage.local.get(["apiUrl"])) as StoredSettings;
  const apiUrl = (settings.apiUrl || DEFAULT_API_URL || "").replace(/\/$/, "");

  if (!apiUrl) {
    throw new Error("Set your Convex site URL in the Pinboard popup.");
  }

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

