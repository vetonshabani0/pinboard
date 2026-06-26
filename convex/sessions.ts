import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function makeShareCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

export const create = mutation({
  args: {
    name: v.optional(v.string()),
    siteOrigin: v.optional(v.string()),
    authorName: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    let shareCode = makeShareCode();

    for (let i = 0; i < 5; i += 1) {
      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_share_code", (q) => q.eq("shareCode", shareCode))
        .unique();

      if (!existing) break;
      shareCode = makeShareCode();
    }

    const now = Date.now();
    const id = await ctx.db.insert("sessions", {
      shareCode,
      name: args.name?.trim() || "Untitled review",
      siteOrigin: args.siteOrigin,
      createdBy: args.authorName?.trim() || undefined,
      createdAt: now
    });

    return {
      id,
      shareCode,
      name: args.name?.trim() || "Untitled review",
      siteOrigin: args.siteOrigin,
      createdAt: now
    };
  }
});

export const byShareCode = query({
  args: {
    shareCode: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_share_code", (q) => q.eq("shareCode", args.shareCode))
      .unique();
  }
});

