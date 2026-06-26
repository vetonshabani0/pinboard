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

export const list = query({
  args: {
    shareCode: v.string(),
    origin: v.optional(v.string()),
    path: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const session = await getSessionByShareCode(ctx, args.shareCode);

    if (args.origin && args.path) {
      return await ctx.db
        .query("comments")
        .withIndex("by_session_and_path", (q) =>
          q.eq("sessionId", session._id).eq("origin", args.origin!).eq("path", args.path!)
        )
        .collect();
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
    text: v.string(),
    authorName: v.string()
  },
  handler: async (ctx, args) => {
    const session = await getSessionByShareCode(ctx, args.shareCode);
    const now = Date.now();

    const id = await ctx.db.insert("comments", {
      sessionId: session._id,
      url: args.url,
      origin: args.origin,
      path: args.path,
      xPercent: Math.max(0, Math.min(100, args.xPercent)),
      yPercent: Math.max(0, Math.min(100, args.yPercent)),
      viewportWidth: args.viewportWidth,
      viewportHeight: args.viewportHeight,
      elementLabel: args.elementLabel,
      text: args.text.trim(),
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

