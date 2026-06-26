export async function pinboardApi<T>(endpoint: string, payload?: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage({
    type: "pinboard:api",
    endpoint,
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Pinboard request failed");
  }

  return response.data as T;
}

