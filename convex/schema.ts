import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    shareCode: v.string(),
    name: v.string(),
    siteOrigin: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.number()
  }).index("by_share_code", ["shareCode"]),

  comments: defineTable({
    sessionId: v.id("sessions"),
    url: v.string(),
    origin: v.string(),
    path: v.string(),
    xPercent: v.number(),
    yPercent: v.number(),
    viewportWidth: v.number(),
    viewportHeight: v.number(),
    elementLabel: v.optional(v.string()),
    text: v.string(),
    authorName: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_path", ["sessionId", "origin", "path"])
});

