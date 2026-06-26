import type { PinboardComment } from "@pinboard/shared";
import "./content.css";

type Settings = {
  authorName?: string;
  enabled?: boolean;
  shareCode?: string;
};

type ApiComment = PinboardComment & { _id?: string };

type DraftPin = {
  pageX: number;
  pageY: number;
  xPercent: number;
  yPercent: number;
  elementLabel?: string;
};

const rootId = "pinboard-extension-root";
const pinCursorClass = "pinboard-pin-cursor";

let settings: Settings = {};
let comments: PinboardComment[] = [];
let selectedId: string | null = null;
let placingPin = false;
let draftPin: DraftPin | null = null;
let draftText = "";
let otherPageCount = 0;
let refreshTimer: number | undefined;

function pageMeta() {
  return {
    url: window.location.href,
    origin: window.location.origin,
    path: `${window.location.pathname}${window.location.search}`,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };
}

function documentSize() {
  const doc = document.documentElement;

  return {
    width: Math.max(doc.scrollWidth, document.body.scrollWidth, window.innerWidth),
    height: Math.max(doc.scrollHeight, document.body.scrollHeight, window.innerHeight)
  };
}

function elementLabel(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return undefined;

  const aria = target.getAttribute("aria-label");
  const text = target.innerText?.trim().replace(/\s+/g, " ");
  const label = aria || text || target.id || target.tagName.toLowerCase();

  return label.slice(0, 120);
}

function normalizeOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const host = url.hostname.replace(/^www\./, "");

    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return origin.replace(/^https?:\/\/www\./, (match) => match.replace("www.", ""));
  }
}

function normalizePath(path: string) {
  const withoutQuery = path.split("?")[0] || "/";
  const withoutTrailingSlash =
    withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;

  return withoutTrailingSlash || "/";
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

function age(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

function api<T>(endpoint: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "pinboard:api",
        endpoint,
        payload
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Pinboard request failed"));
          return;
        }

        resolve(response.data as T);
      }
    );
  });
}

async function loadSettings() {
  settings = (await chrome.storage.local.get(["authorName", "enabled", "shareCode"])) as Settings;
}

async function saveSettings(next: Settings) {
  settings = { ...settings, ...next };
  await chrome.storage.local.set(settings);
}

async function loadComments() {
  if (!settings.shareCode) {
    comments = [];
    render();
    return;
  }

  const page = pageMeta();
  const response = await api<{ comments: ApiComment[] }>("/api/comments/list", {
    shareCode: settings.shareCode,
    origin: page.origin,
    path: page.path
  });

  comments = response.comments.map(toComment).sort((a, b) => a.createdAt - b.createdAt);
  otherPageCount = 0;

  if (comments.length === 0) {
    const all = await api<{ comments: ApiComment[] }>("/api/comments/list", {
      shareCode: settings.shareCode
    });
    const currentOrigin = normalizeOrigin(page.origin);
    const currentPath = normalizePath(page.path);
    otherPageCount = all.comments.filter((comment) => {
      return (
        normalizeOrigin(comment.origin) === currentOrigin &&
        normalizePath(comment.path) !== currentPath
      );
    }).length;
  }

  render();
}

function root() {
  return document.getElementById(rootId);
}

function setStatus(message: string) {
  const status = root()?.querySelector<HTMLElement>("[data-pinboard-status]");
  if (status) status.textContent = message;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function makeButton(className: string, text: string, onClick: () => void | Promise<void>) {
  const button = make("button", className, text);
  button.type = "button";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void onClick();
  });
  return button;
}

function makeInput(value: string, placeholder: string, onInput: (value: string) => void) {
  const input = make("input");
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function renderPins(container: HTMLElement) {
  comments.forEach((comment, index) => {
    const pin = makeButton(
      `pinboard-pin ${comment.status === "resolved" ? "is-resolved" : ""}`,
      String(index + 1),
      () => {
        selectedId = comment.id;
        render();
      }
    );
    pin.style.left = `${comment.xPercent}%`;
    pin.style.top = `${comment.yPercent}%`;
    pin.title = comment.text;

    const label = make("span", undefined, String(index + 1));
    pin.textContent = "";
    pin.append(label);
    container.append(pin);
  });
}

function renderDraft(container: HTMLElement) {
  if (!draftPin) return;

  const pin = makeButton("pinboard-pin is-draft", "", () => undefined);
  pin.style.left = `${draftPin.xPercent}%`;
  pin.style.top = `${draftPin.yPercent}%`;
  pin.title = "Unsaved comment";
  pin.append(make("span", undefined, "+"));
  container.append(pin);

  const composer = make("div", "pinboard-composer");
  composer.style.left = `${draftPin.pageX}px`;
  composer.style.top = `${draftPin.pageY}px`;
  composer.append(make("div", "pinboard-composer-title", "Add comment"));

  const textarea = make("textarea");
  textarea.placeholder = "What should change here?";
  textarea.value = draftText;
  textarea.addEventListener("input", () => {
    draftText = textarea.value;
  });
  composer.append(textarea);

  const actions = make("div", "pinboard-actions");
  actions.append(
    makeButton("pinboard-button", "Cancel", () => {
      draftPin = null;
      draftText = "";
      render();
    })
  );
  actions.append(
    makeButton("pinboard-button is-active", "Save", async () => {
      if (!settings.shareCode || !draftPin || !draftText.trim()) return;

      await api("/api/comments/create", {
        shareCode: settings.shareCode,
        ...pageMeta(),
        xPercent: draftPin.xPercent,
        yPercent: draftPin.yPercent,
        elementLabel: draftPin.elementLabel,
        text: draftText,
        authorName: settings.authorName || "Anonymous"
      });

      draftPin = null;
      draftText = "";
      await loadComments();
    })
  );
  composer.append(actions);
  container.append(composer);
  window.setTimeout(() => textarea.focus(), 0);
}

function renderSelected(container: HTMLElement) {
  const selected = comments.find((comment) => comment.id === selectedId);
  if (!selected) return;

  const popover = make("div", "pinboard-popover");
  popover.style.left = `${selected.xPercent}%`;
  popover.style.top = `${selected.yPercent}%`;

  const meta = make("div", "pinboard-meta");
  meta.append(make("span", undefined, selected.authorName));
  meta.append(make("span", undefined, selected.status));
  popover.append(meta);
  popover.append(make("p", undefined, selected.text));

  (selected.replies || []).forEach((reply) => {
    const replyNode = make("div", "pinboard-reply");
    replyNode.append(make("p", undefined, reply.text));
    replyNode.append(make("span", undefined, reply.authorName));
    popover.append(replyNode);
  });

  const actions = make("div", "pinboard-actions");
  actions.append(makeButton("pinboard-button", "Close", () => {
    selectedId = null;
    render();
  }));
  actions.append(makeButton("pinboard-button is-active", selected.status === "resolved" ? "Reopen" : "Resolve", async () => {
    if (!settings.shareCode) return;

    await api("/api/comments/status", {
      shareCode: settings.shareCode,
      commentId: selected.id,
      status: selected.status === "resolved" ? "open" : "resolved"
    });
    selectedId = null;
    await loadComments();
  }));
  popover.append(actions);
  container.append(popover);
}

function renderPanel(container: HTMLElement) {
  const panel = make("aside", "pinboard-panel");

  const header = make("header");
  const titleWrap = make("div");
  titleWrap.append(make("h2", undefined, "Pinboard"));
  titleWrap.append(make("p", undefined, pageMeta().origin.replace(/^https?:\/\//, "")));
  header.append(titleWrap);
  header.append(makeButton("pinboard-icon-button", "×", () => {
    panel.remove();
  }));
  panel.append(header);

  const nameLabel = make("label", "pinboard-field", "Your name");
  nameLabel.append(makeInput(settings.authorName || "", "Your name", (value) => {
    void saveSettings({ authorName: value });
  }));
  panel.append(nameLabel);

  if (!settings.shareCode) {
    renderSetup(panel);
  } else {
    renderSession(panel);
  }

  const status = make("p", "pinboard-status");
  status.dataset.pinboardStatus = "true";
  panel.append(status);
  container.append(panel);
}

function renderSetup(panel: HTMLElement) {
  const setup = make("section", "pinboard-setup");
  const newLabel = make("label", "pinboard-field", "New review");
  const reviewInput = makeInput("", "Homepage pass", () => undefined);
  newLabel.append(reviewInput);
  setup.append(newLabel);
  setup.append(makeButton("pinboard-primary-button", "Create session", async () => {
    setStatus("Creating review...");
    const response = await api<{ session: { shareCode: string } }>("/api/session/create", {
      name: reviewInput.value,
      siteOrigin: pageMeta().origin,
      authorName: settings.authorName
    });
    await saveSettings({ enabled: true, shareCode: response.session.shareCode });
    await loadComments();
  }));

  const joinLabel = make("label", "pinboard-field", "Connect to session");
  const joinInput = makeInput("", "ABC123", (value) => {
    joinInput.value = value.toUpperCase();
  });
  joinLabel.append(joinInput);
  setup.append(joinLabel);
  setup.append(makeButton("pinboard-secondary-button", "Connect", async () => {
    const shareCode = joinInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!shareCode) return;

    await api("/api/session/join", { shareCode });
    await saveSettings({ enabled: true, shareCode });
    await loadComments();
  }));
  panel.append(setup);
}

function renderSession(panel: HTMLElement) {
  const active = make("section", "pinboard-active-session");
  const top = make("div");
  top.append(make("span", undefined, "Active session"));
  top.append(make("strong", undefined, settings.shareCode || ""));
  active.append(top);

  const row = make("div", "pinboard-button-row");
  row.append(makeButton("pinboard-secondary-button", "Copy code", async () => {
    await navigator.clipboard.writeText(settings.shareCode || "");
    setStatus("Copied code");
  }));
  row.append(makeButton("pinboard-secondary-button", "Copy link", async () => {
    const url = new URL(window.location.href);
    url.hash = `pinboard=${settings.shareCode}`;
    await navigator.clipboard.writeText(url.toString());
    setStatus("Copied link");
  }));
  active.append(row);
  panel.append(active);

  const toolbar = make("section", "pinboard-comment-toolbar");
  const copy = make("div");
  copy.append(make("strong", undefined, "Comments"));
  copy.append(
    make(
      "span",
      undefined,
      `${comments.filter((comment) => comment.status === "open").length} open on this page`
    )
  );
  toolbar.append(copy);
  toolbar.append(makeButton("pinboard-primary-button", "Add pin", startPinPlacement));
  panel.append(toolbar);

  const list = make("section", "pinboard-comment-list");
  if (comments.length === 0) {
    const empty = make("div", "pinboard-empty-state");
    empty.append(make("strong", undefined, "No pins on this page yet"));
    empty.append(
      make(
        "span",
        undefined,
        otherPageCount > 0
          ? `${otherPageCount} pin${otherPageCount === 1 ? "" : "s"} exist on another page in this same session.`
          : "Add a pin here, or go to another page in this same session."
      )
    );
    list.append(empty);
  }

  comments.forEach((comment, index) => {
    const card = make("article", comment.id === selectedId ? "is-selected" : "");
    card.addEventListener("click", () => {
      selectedId = comment.id;
      render();
    });

    const top = make("div", "pinboard-comment-card-top");
    top.append(make("span", undefined, `#${index + 1} · ${comment.elementLabel || "Page"}`));
    top.append(makeButton("pinboard-text-button", comment.status === "resolved" ? "Reopen" : "Resolve", async () => {
      if (!settings.shareCode) return;
      await api("/api/comments/status", {
        shareCode: settings.shareCode,
        commentId: comment.id,
        status: comment.status === "resolved" ? "open" : "resolved"
      });
      await loadComments();
    }));
    card.append(top);
    card.append(make("p", undefined, comment.text));

    const meta = make("div", "pinboard-comment-meta");
    meta.append(make("span", undefined, comment.authorName));
    meta.append(make("span", undefined, age(comment.createdAt)));
    card.append(meta);

    (comment.replies || []).forEach((reply) => {
      const replyNode = make("div", "pinboard-panel-reply");
      replyNode.append(make("p", undefined, reply.text));
      replyNode.append(make("span", undefined, `${reply.authorName} · ${age(reply.createdAt)}`));
      card.append(replyNode);
    });

    const replyBox = make("div", "pinboard-reply-box");
    replyBox.addEventListener("click", (event) => event.stopPropagation());
    const replyInput = makeInput("", "Reply", () => undefined);
    replyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void addReply(comment, replyInput.value);
      }
    });
    replyBox.append(replyInput);
    replyBox.append(makeButton("pinboard-icon-button is-send", "↑", () => addReply(comment, replyInput.value)));
    card.append(replyBox);
    list.append(card);
  });
  panel.append(list);
}

async function addReply(comment: PinboardComment, text: string) {
  if (!settings.shareCode || !text.trim()) return;

  await api("/api/comments/reply", {
    shareCode: settings.shareCode,
    commentId: comment.id,
    text,
    authorName: settings.authorName || "Anonymous"
  });
  await loadComments();
}

function startPinPlacement() {
  if (!settings.shareCode) return;

  placingPin = true;
  document.body.classList.add(pinCursorClass);
  root()?.querySelector(".pinboard-panel")?.remove();

  const hint = make("div", "pinboard-placement-hint");
  hint.append(make("strong", undefined, "Place a pin"));
  hint.append(make("span", undefined, "Click anywhere on this page."));
  hint.append(makeButton("pinboard-button", "Cancel", stopPinPlacement));
  root()?.append(hint);
}

function stopPinPlacement() {
  placingPin = false;
  document.body.classList.remove(pinCursorClass);
  root()?.querySelector(".pinboard-placement-hint")?.remove();
  render();
}

function onDocumentClick(event: MouseEvent) {
  if (!placingPin || isPinboardTarget(event.target)) return;

  event.preventDefault();
  event.stopPropagation();

  placingPin = false;
  document.body.classList.remove(pinCursorClass);

  const size = documentSize();
  draftPin = {
    pageX: event.pageX,
    pageY: event.pageY,
    xPercent: (event.pageX / size.width) * 100,
    yPercent: (event.pageY / size.height) * 100,
    elementLabel: elementLabel(event.target)
  };
  draftText = "";
  render();
}

function render() {
  const container = root();
  if (!container) return;

  container.innerHTML = "";
  const size = documentSize();
  container.style.height = `${size.height}px`;
  container.style.width = `${size.width}px`;

  if (settings.shareCode) {
    renderPins(container);
    renderDraft(container);
    renderSelected(container);
  }

  if (!placingPin && !draftPin) {
    renderPanel(container);
  }
}

async function init() {
  document.getElementById(rootId)?.remove();
  document.body.classList.remove(pinCursorClass);

  const container = document.createElement("div");
  container.id = rootId;
  container.className = "pinboard-root";
  container.dataset.pinboardUi = "true";
  document.body.append(container);

  document.addEventListener("click", onDocumentClick, true);
  window.addEventListener("resize", render);
  window.addEventListener("scroll", render, { passive: true });

  await loadSettings();
  await loadComments();

  refreshTimer = window.setInterval(() => {
    void loadComments();
  }, 3000);
}

void init();

window.addEventListener("beforeunload", () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  document.removeEventListener("click", onDocumentClick, true);
  window.removeEventListener("resize", render);
  window.removeEventListener("scroll", render);
});
