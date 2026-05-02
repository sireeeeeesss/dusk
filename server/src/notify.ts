import type { Server as IOServer } from "socket.io";

export type ChannelNotifyPayload = { serverId: string; channelId: string; authorId: string };
export type DmNotifyPayload = { conversationId: string; authorId: string };

export function notifyChannelMessage(
  io: IOServer,
  opts: { memberUserIds: string[]; authorId: string; serverId: string; channelId: string },
): void {
  const payload: ChannelNotifyPayload = {
    serverId: opts.serverId,
    channelId: opts.channelId,
    authorId: opts.authorId,
  };
  for (const uid of opts.memberUserIds) {
    if (uid === opts.authorId) continue;
    io.to(`user:${uid}`).emit("notify:channel-message", payload);
  }
}

export function notifyDmMessage(
  io: IOServer,
  opts: { participantUserIds: string[]; authorId: string; conversationId: string },
): void {
  const payload: DmNotifyPayload = {
    conversationId: opts.conversationId,
    authorId: opts.authorId,
  };
  for (const uid of opts.participantUserIds) {
    if (uid === opts.authorId) continue;
    io.to(`user:${uid}`).emit("notify:dm-message", payload);
  }
}
