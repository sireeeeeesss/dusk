import type {
  Message as DbChannelMessage,
  User,
  MessageReaction,
  DmMessage,
  Server as DbServer,
  Channel,
  Membership,
} from "@prisma/client";
import { parseMentionIds } from "./mentions.js";

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  accentHue: number;
  bio: string;
  customStatus: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  emailVerified: boolean;
};

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarHue: u.avatarHue,
    accentHue: u.accentHue,
    bio: u.bio,
    customStatus: u.customStatus,
    avatarUrl: u.avatarImageMime ? `/api/media/user/${u.id}/avatar` : null,
    bannerUrl: u.bannerImageMime ? `/api/media/user/${u.id}/banner` : null,
    emailVerified: u.emailVerified,
  };
}

export type SessionUser = PublicUser & { email: string };

export function toSessionUser(u: User): SessionUser {
  return { ...toPublicUser(u), email: u.email };
}

export type LiteUser = {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  accentHue: number;
  avatarUrl: string | null;
  bannerUrl: string | null;
};

export function toLiteUser(u: User): LiteUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarHue: u.avatarHue,
    accentHue: u.accentHue,
    avatarUrl: u.avatarImageMime ? `/api/media/user/${u.id}/avatar` : null,
    bannerUrl: u.bannerImageMime ? `/api/media/user/${u.id}/banner` : null,
  };
}

export type ServerOut = {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  iconUrl: string | null;
  channels: { id: string; serverId: string; name: string; kind: string; position: number }[];
  memberships: { id: string; role: string; user: LiteUser }[];
};

export function serializeServer(
  s: DbServer & {
    channels: Channel[];
    memberships: (Membership & { user: User })[];
  },
): ServerOut {
  return {
    id: s.id,
    name: s.name,
    ownerId: s.ownerId,
    inviteCode: s.inviteCode,
    iconUrl: s.iconMime ? `/api/servers/${s.id}/icon` : null,
    channels: s.channels.map((c) => ({
      id: c.id,
      serverId: c.serverId,
      name: c.name,
      kind: c.kind ?? "text",
      position: c.position,
    })),
    memberships: s.memberships.map((m) => ({
      id: m.id,
      role: m.role,
      user: toLiteUser(m.user),
    })),
  };
}

export type ChannelMessageOut = {
  id: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  hasVoice: boolean;
  voiceUrl: string | null;
  hasImage: boolean;
  imageUrl: string | null;
  hasVideo: boolean;
  videoUrl: string | null;
  hasAudio: boolean;
  audioUrl: string | null;
  mentionIds: string[];
  author: LiteUser;
  reactions: { id: string; emoji: string; userId: string }[];
};

export function serializeChannelMessage(
  m: DbChannelMessage & { author: User; reactions?: MessageReaction[] },
): ChannelMessageOut {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    hasVoice: m.hasVoice,
    voiceUrl: m.hasVoice ? `/api/voice/channel/${m.id}` : null,
    hasImage: m.hasImage,
    imageUrl: m.hasImage ? `/api/image/channel/${m.id}` : null,
    hasVideo: m.hasVideo,
    videoUrl: m.hasVideo ? `/api/video/channel/${m.id}` : null,
    hasAudio: m.hasAudio,
    audioUrl: m.hasAudio ? `/api/audio-file/channel/${m.id}` : null,
    mentionIds: parseMentionIds(m.mentionIds),
    author: toLiteUser(m.author),
    reactions: (m.reactions ?? []).map((r) => ({ id: r.id, emoji: r.emoji, userId: r.userId })),
  };
}

export type DmMessageOut = {
  id: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  hasVoice: boolean;
  voiceUrl: string | null;
  hasImage: boolean;
  imageUrl: string | null;
  hasVideo: boolean;
  videoUrl: string | null;
  hasAudio: boolean;
  audioUrl: string | null;
  mentionIds: string[];
  author: LiteUser;
};

export function serializeDmMessage(m: DmMessage & { author: User }): DmMessageOut {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    hasVoice: m.hasVoice,
    voiceUrl: m.hasVoice ? `/api/voice/dm/${m.id}` : null,
    hasImage: m.hasImage,
    imageUrl: m.hasImage ? `/api/image/dm/${m.id}` : null,
    hasVideo: m.hasVideo,
    videoUrl: m.hasVideo ? `/api/video/dm/${m.id}` : null,
    hasAudio: m.hasAudio,
    audioUrl: m.hasAudio ? `/api/audio-file/dm/${m.id}` : null,
    mentionIds: parseMentionIds(m.mentionIds),
    author: toLiteUser(m.author),
  };
}
