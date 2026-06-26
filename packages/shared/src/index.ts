export type PinboardStatus = "open" | "resolved";

export type PinboardSession = {
  id: string;
  shareCode: string;
  name: string;
  siteOrigin?: string;
  createdAt: number;
};

export type PinboardComment = {
  id: string;
  sessionId: string;
  url: string;
  origin: string;
  path: string;
  xPercent: number;
  yPercent: number;
  viewportWidth: number;
  viewportHeight: number;
  elementLabel?: string;
  text: string;
  authorName: string;
  status: PinboardStatus;
  createdAt: number;
  updatedAt: number;
};

export type CreateSessionRequest = {
  name?: string;
  siteOrigin?: string;
  authorName?: string;
};

export type CreateSessionResponse = {
  session: PinboardSession;
};

export type JoinSessionRequest = {
  shareCode: string;
};

export type ListCommentsRequest = {
  shareCode: string;
  url?: string;
  origin?: string;
  path?: string;
};

export type CreateCommentRequest = {
  shareCode: string;
  url: string;
  origin: string;
  path: string;
  xPercent: number;
  yPercent: number;
  viewportWidth: number;
  viewportHeight: number;
  elementLabel?: string;
  text: string;
  authorName: string;
};

export type UpdateCommentStatusRequest = {
  shareCode: string;
  commentId: string;
  status: PinboardStatus;
};

export function normalizeShareCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

