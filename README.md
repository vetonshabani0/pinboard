# Pinboard

Pinboard is a Chrome extension for shared website feedback. A designer joins a review session with a code, drops pins directly on a webpage, and the owner sees the same comments on the same URL.

This repo starts as a standalone product, separate from Mentra:

- `apps/extension`: Chrome extension, popup, content overlay, and background API bridge.
- `apps/web`: lightweight review dashboard for session comments.
- `convex`: shared backend for review sessions and pin comments.
- `packages/shared`: shared TypeScript types and helpers.

## MVP

- Create or join a review session with a share code.
- Toggle the overlay on any webpage.
- Add pins with comments.
- See pins from other reviewers on the current URL.
- Mark comments open or resolved.
- No screenshots. Pins are stored by page URL, document position, viewport metadata, and optional element text.

## Local Setup

```bash
npm install
npm run convex:dev
```

Copy the Convex site URL ending in `.convex.site` into `.env.local`:

```bash
VITE_PINBOARD_API_URL=https://your-deployment.convex.site
```

If `npx convex dev` created `CONVEX_SITE_URL`, use the same value as `VITE_PINBOARD_API_URL` for the browser apps. The current dev backend is also baked into the extension fallback, so local testing does not require pasting a backend URL into the extension UI.

Then run:

```bash
npm run dev:web
npm run build:extension
```

Load `apps/extension/dist` in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click Load unpacked.
4. Select `apps/extension/dist`.

## Product Notes

Pinboard intentionally uses a separate Convex project and schema. It should not share the Mentra database unless we later decide to integrate it as a Mentra product feature.
