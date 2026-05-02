import type { DmMessage, Message } from "@prisma/client";
import { deleteMedia, mediaKey } from "./mediaStore.js";
import { extFromMime } from "./uploads.js";

export async function removeChannelMessageFiles(msg: Message): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (msg.hasVoice) jobs.push(deleteMedia(mediaKey.channelVoice(msg.id)));
  if (msg.hasImage && msg.imageMime) {
    const ext = extFromMime(msg.imageMime);
    jobs.push(deleteMedia(mediaKey.channelImage(msg.id, ext)));
  }
  if (msg.hasVideo && msg.videoMime) {
    const ext = extFromMime(msg.videoMime);
    jobs.push(deleteMedia(mediaKey.channelVideo(msg.id, ext)));
  }
  if (msg.hasAudio && msg.audioMime) {
    const ext = extFromMime(msg.audioMime);
    jobs.push(deleteMedia(mediaKey.channelAudio(msg.id, ext)));
  }
  await Promise.all(jobs);
}

export async function removeDmMessageFiles(msg: DmMessage): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (msg.hasVoice) jobs.push(deleteMedia(mediaKey.dmVoice(msg.id)));
  if (msg.hasImage && msg.imageMime) {
    const ext = extFromMime(msg.imageMime);
    jobs.push(deleteMedia(mediaKey.dmImage(msg.id, ext)));
  }
  if (msg.hasVideo && msg.videoMime) {
    const ext = extFromMime(msg.videoMime);
    jobs.push(deleteMedia(mediaKey.dmVideo(msg.id, ext)));
  }
  if (msg.hasAudio && msg.audioMime) {
    const ext = extFromMime(msg.audioMime);
    jobs.push(deleteMedia(mediaKey.dmAudio(msg.id, ext)));
  }
  await Promise.all(jobs);
}
