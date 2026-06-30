import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function getSessionByShareCode(ctx: any, shareCode: string) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_share_code", (q: any) => q.eq("shareCode", shareCode))
    .unique();

  if (!session) {
    throw new Error("Session not found");
  }

  return session;
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

export const list = query({
  args: {
    shareCode: v.string(),
    origin: v.optional(v.string()),
    path: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const session = await getSessionByShareCode(ctx, args.shareCode);

    if (args.origin && args.path) {
      const origin = normalizeOrigin(args.origin);
      const path = normalizePath(args.path);
      const sessionComments = await ctx.db
        .query("comments")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();

      return sessionComments.filter(
        (comment) => normalizeOrigin(comment.origin) === origin && normalizePath(comment.path) === path
      );
    }

    return await ctx.db
      .query("comments")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
  }
});

export const create = mutation({
  args: {
    shareCode: v.string(),
    url: v.string(),
    origin: v.string(),
    path: v.string(),
    xPercent: v.number(),
    yPercent: v.number(),
    viewportWidth: v.number(),
    viewportHeight: v.number(),
    elementLabel: v.optional(v.string()),
    selector: v.optional(v.string()),
    relX: v.optional(v.number()),
    relY: v.optional(v.number()),
    text: v.string(),
    authorName: v.string()
  },
  handler: async (ctx, args) => {
    const session = await getSessionByShareCode(ctx, args.shareCode);
    const now = Date.now();

    const id = await ctx.db.insert("comments", {
      sessionId: session._id,
      url: args.url,
      origin: normalizeOrigin(args.origin),
      path: normalizePath(args.path),
      xPercent: Math.max(0, Math.min(100, args.xPercent)),
      yPercent: Math.max(0, Math.min(100, args.yPercent)),
      viewportWidth: args.viewportWidth,
      viewportHeight: args.viewportHeight,
      elementLabel: args.elementLabel,
      selector: args.selector,
      relX: args.relX,
      relY: args.relY,
      text: args.text.trim(),
      replies: [],
      authorName: args.authorName.trim() || "Anonymous",
      status: "open",
      createdAt: now,
      updatedAt: now
    });

    return { id };
  }
});

export const updateStatus = mutation({
  args: {
    shareCode: v.string(),
    commentId: v.id("comments"),
    status: v.union(v.literal("open"), v.literal("resolved"))
  },
  handler: async (ctx, args) => {
    const session = await getSessionByShareCode(ctx, args.shareCode);
    const comment = await ctx.db.get(args.commentId);

    if (!comment || comment.sessionId !== session._id) {
      throw new Error("Comment not found");
    }

    await ctx.db.patch(args.commentId, {
      status: args.status,
      updatedAt: Date.now()
    });

    return { ok: true };
  }
});

export const addReply = mutation({
  args: {
    shareCode: v.string(),
    commentId: v.id("comments"),
    text: v.string(),
    authorName: v.string()
  },
  handler: async (ctx, args) => {
    const session = await getSessionByShareCode(ctx, args.shareCode);
    const comment = await ctx.db.get(args.commentId);

    if (!comment || comment.sessionId !== session._id) {
      throw new Error("Comment not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.commentId, {
      replies: [
        ...(comment.replies || []),
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          text: args.text.trim(),
          authorName: args.authorName.trim() || "Anonymous",
          createdAt: now
        }
      ],
      updatedAt: now
    });

    return { ok: true };
  }
});
