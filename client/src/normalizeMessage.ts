import type { DmMessage, Message } from "./types";

export function normalizeChannelMessage(m: Message): Message {
  return {
    ...m,
    editedAt: m.editedAt ?? null,
    mentionIds: m.mentionIds ?? [],
    hasVoice: m.hasVoice ?? false,
    voiceUrl: m.voiceUrl ?? null,
    hasImage: m.hasImage ?? false,
    imageUrl: m.imageUrl ?? null,
    hasVideo: m.hasVideo ?? false,
    videoUrl: m.videoUrl ?? null,
    hasAudio: m.hasAudio ?? false,
    audioUrl: m.audioUrl ?? null,
    reactions: m.reactions ?? [],
  };
}

export function normalizeDmMessage(m: DmMessage): DmMessage {
  return {
    ...m,
    editedAt: m.editedAt ?? null,
    mentionIds: m.mentionIds ?? [],
    hasVoice: m.hasVoice ?? false,
    voiceUrl: m.voiceUrl ?? null,
    hasImage: m.hasImage ?? false,
    imageUrl: m.imageUrl ?? null,
    hasVideo: m.hasVideo ?? false,
    videoUrl: m.videoUrl ?? null,
    hasAudio: m.hasAudio ?? false,
    audioUrl: m.audioUrl ?? null,
  };
}
