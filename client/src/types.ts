export type User = {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  accentHue: number;
  bio: string;
  customStatus: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  /** present on `/api/me` and auth responses for the signed-in user */
  email?: string;
  emailVerified?: boolean;
};

export type LiteUser = Pick<
  User,
  "id" | "username" | "displayName" | "avatarHue" | "accentHue" | "avatarUrl" | "bannerUrl"
>;

export type Presence = {
  userId: string;
  isOnline: boolean;
  lastSeenAt: string;
};

export type FriendWithPresence = {
  user: LiteUser;
  presence: Presence;
};

export type SocialRequestRow = {
  id: string;
  status: string;
  createdAt: string;
  user: LiteUser;
};

export type ChannelKind = "text" | "voice";

export type Channel = {
  id: string;
  serverId: string;
  name: string;
  /** from api; older servers default to text */
  kind: ChannelKind;
  position: number;
};

export type Server = {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  iconUrl: string | null;
  channels: Channel[];
  memberships: { id: string; role: string; user: User }[];
};

export type Reaction = { id: string; emoji: string; userId: string };

export type Message = {
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
  author: Pick<User, "id" | "username" | "displayName" | "avatarHue" | "accentHue" | "avatarUrl" | "bannerUrl">;
  reactions: Reaction[];
};

export type DmSummary = {
  id: string;
  other: LiteUser | null;
  lastMessage: DmMessage | null;
};

export type DmMessage = {
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
  author: Pick<User, "id" | "username" | "displayName" | "avatarHue" | "accentHue" | "avatarUrl" | "bannerUrl">;
};
