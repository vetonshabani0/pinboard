import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

http.route({
  path: "/api/session/create",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson<{
      name?: string;
      siteOrigin?: string;
      authorName?: string;
    }>(request);

    const session = await ctx.runMutation(api.sessions.create, body);
    return jsonResponse({ session });
  })
});

http.route({
  path: "/api/session/join",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson<{ shareCode: string }>(request);
    const session = await ctx.runQuery(api.sessions.byShareCode, {
      shareCode: body.shareCode.trim().toUpperCase()
    });

    if (!session) {
      return jsonResponse({ error: "Session not found" }, 404);
    }

    return jsonResponse({
      session: {
        id: session._id,
        shareCode: session.shareCode,
        name: session.name,
        siteOrigin: session.siteOrigin,
        createdAt: session.createdAt
      }
    });
  })
});

http.route({
  path: "/api/comments/list",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson<{
      shareCode: string;
      origin?: string;
      path?: string;
    }>(request);

    const comments = await ctx.runQuery(api.comments.list, {
      shareCode: body.shareCode.trim().toUpperCase(),
      origin: body.origin,
      path: body.path
    });

    return jsonResponse({ comments });
  })
});

http.route({
  path: "/api/comments/create",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson<{
      shareCode: string;
      url: string;
      origin: string;
      path: string;
      xPercent: number;
      yPercent: number;
      viewportWidth: number;
      viewportHeight: number;
      elementLabel?: string;
      selector?: string;
      relX?: number;
      relY?: number;
      text: string;
      authorName: string;
    }>(request);

    const result = await ctx.runMutation(api.comments.create, {
      ...body,
      shareCode: body.shareCode.trim().toUpperCase()
    });

    return jsonResponse(result);
  })
});

http.route({
  path: "/api/comments/status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson<{
      shareCode: string;
      commentId: string;
      status: "open" | "resolved";
    }>(request);

    const result = await ctx.runMutation(api.comments.updateStatus, {
      ...body,
      commentId: body.commentId as Id<"comments">,
      shareCode: body.shareCode.trim().toUpperCase()
    });

    return jsonResponse(result);
  })
});

http.route({
  path: "/api/comments/reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson<{
      shareCode: string;
      commentId: string;
      text: string;
      authorName: string;
    }>(request);

    const result = await ctx.runMutation(api.comments.addReply, {
      ...body,
      commentId: body.commentId as Id<"comments">,
      shareCode: body.shareCode.trim().toUpperCase()
    });

    return jsonResponse(result);
  })
});

for (const path of [
  "/api/session/create",
  "/api/session/join",
  "/api/comments/list",
  "/api/comments/create",
  "/api/comments/reply",
  "/api/comments/status"
]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => jsonResponse({ ok: true }))
  });
}

export default http;
