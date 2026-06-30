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
  selector?: string;
  relX?: number;
  relY?: number;
};

type Anchorable = {
  selector?: string;
  relX?: number;
  relY?: number;
  xPercent: number;
  yPercent: number;
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
let pendingRender: number | undefined;
let domObserver: MutationObserver | undefined;

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

const cssEscape = (value: string) =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

// An id is only useful as an anchor if it is stable across renders/builds.
// Framework-generated ids (React's ":r1:", Radix "radix-:r3:", random hashes)
// are rejected so we fall back to a structural path instead.
function isStableId(id: string) {
  if (!id || id.length > 50 || id.includes(":")) return false;
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return false;
  return true;
}

// Build a structural CSS selector (tag + nth-of-type path, anchored at the
// nearest stable id) that points at the clicked element. Returns undefined if
// the resulting selector does not resolve back to the same element.
function cssSelector(el: Element | null): string | undefined {
  if (!(el instanceof Element)) return undefined;

  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node !== document.body && node !== document.documentElement) {
    const id = node.getAttribute("id");
    if (id && isStableId(id)) {
      parts.unshift(`#${cssEscape(id)}`);
      break;
    }

    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === node!.tagName
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }

    parts.unshift(part);
    node = parent;
  }

  if (parts.length === 0) return undefined;

  const selector = parts.join(" > ");
  try {
    if (document.querySelector(selector) === el) return selector;
  } catch {
    return undefined;
  }

  return undefined;
}

// Resolve a stored pin to absolute document coordinates (px).
//
// - Anchored pin (has a selector): position it against the live element's
//   current box. If that element isn't on the page right now (e.g. it lives
//   inside a closed dropdown/modal/tab, or was removed), return null so the
//   caller HIDES the pin instead of floating it over unrelated content. The
//   comment still shows in the side panel, and the pin reappears glued to the
//   element the moment it is visible again.
// - Legacy pin (no selector): fall back to the stored page percentage.
function anchorFor(item: Anchorable): { x: number; y: number } | null {
  if (item.selector) {
    let el: Element | null = null;
    try {
      el = document.querySelector(item.selector);
    } catch {
      el = null;
    }

    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return {
          x: rect.left + window.scrollX + (item.relX ?? 0.5) * rect.width,
          y: rect.top + window.scrollY + (item.relY ?? 0.5) * rect.height
        };
      }
    }

    // Anchored, but the target isn't currently rendered/visible → hide.
    return null;
  }

  const size = documentSize();
  return {
    x: (item.xPercent / 100) * size.width,
    y: (item.yPercent / 100) * size.height
  };
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
    const anchor = anchorFor(comment);
    if (!anchor) return; // anchored element not visible right now → hide pin

    const pin = makeButton(
      `pinboard-pin ${comment.status === "resolved" ? "is-resolved" : ""}`,
      String(index + 1),
      () => {
        selectedId = comment.id;
        render();
      }
    );
    pin.style.left = `${anchor.x}px`;
    pin.style.top = `${anchor.y}px`;
    pin.title = comment.text;

    const label = make("span", undefined, String(index + 1));
    pin.textContent = "";
    pin.append(label);
    container.append(pin);
  });
}

function renderDraft(container: HTMLElement) {
  if (!draftPin) return;

  const anchor = anchorFor(draftPin) ?? { x: draftPin.pageX, y: draftPin.pageY };
  const pin = makeButton("pinboard-pin is-draft", "", () => undefined);
  pin.style.left = `${anchor.x}px`;
  pin.style.top = `${anchor.y}px`;
  pin.title = "Unsaved comment";
  pin.append(make("span", undefined, "+"));
  container.append(pin);

  const composer = make("div", "pinboard-composer");
  composer.style.left = `${anchor.x}px`;
  composer.style.top = `${anchor.y}px`;
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
        selector: draftPin.selector,
        relX: draftPin.relX,
        relY: draftPin.relY,
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

  const anchor = anchorFor(selected);
  if (!anchor) return; // pin hidden (element not visible) → no floating popover

  const popover = make("div", "pinboard-popover");
  popover.style.left = `${anchor.x}px`;
  popover.style.top = `${anchor.y}px`;

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

    const hidden = Boolean(comment.selector) && !anchorFor(comment);
    const top = make("div", "pinboard-comment-card-top");
    top.append(
      make(
        "span",
        undefined,
        `#${index + 1} · ${comment.elementLabel || "Page"}${hidden ? " · hidden" : ""}`
      )
    );
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
  const target = event.target instanceof Element ? event.target : null;
  const selector = cssSelector(target);

  let relX: number | undefined;
  let relY: number | undefined;
  if (target) {
    const rect = target.getBoundingClientRect();
    if (rect.width > 0) relX = (event.clientX - rect.left) / rect.width;
    if (rect.height > 0) relY = (event.clientY - rect.top) / rect.height;
  }

  draftPin = {
    pageX: event.pageX,
    pageY: event.pageY,
    xPercent: (event.pageX / size.width) * 100,
    yPercent: (event.pageY / size.height) * 100,
    elementLabel: elementLabel(event.target),
    selector,
    relX,
    relY
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

// Debounced re-render used when the page mutates (dropdowns/modals/tabs
// opening or closing), so anchored pins appear/disappear in step with their
// target elements instead of waiting for the next poll.
function scheduleRender() {
  if (pendingRender) return;

  pendingRender = window.setTimeout(() => {
    pendingRender = undefined;

    // Don't rebuild mid-placement — render() would wipe the placement hint.
    if (placingPin) return;

    // Never tear down the overlay while the user is typing inside it — a full
    // re-render would drop focus and the caret in the composer/reply inputs.
    const container = root();
    const active = document.activeElement;
    if (container && active instanceof Node && container.contains(active)) return;

    render();
  }, 120);
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

  // Re-position/show/hide pins when the page's own DOM changes (e.g. a dropdown
  // or modal opens or closes). Mutations inside our own overlay are ignored so
  // render() — which rewrites the overlay — can't trigger an infinite loop.
  domObserver = new MutationObserver((mutations) => {
    const container = root();
    const fromPage = mutations.some(
      (mutation) => !(container && container.contains(mutation.target))
    );
    if (fromPage) scheduleRender();
  });
  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "open"]
  });

  await loadSettings();
  await loadComments();

  refreshTimer = window.setInterval(() => {
    void loadComments();
  }, 3000);
}

void init();

window.addEventListener("beforeunload", () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (pendingRender) window.clearTimeout(pendingRender);
  domObserver?.disconnect();
  document.removeEventListener("click", onDocumentClick, true);
  window.removeEventListener("resize", render);
  window.removeEventListener("scroll", render);
});
