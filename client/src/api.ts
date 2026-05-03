const base = "";

function getToken(): string | null {
  return localStorage.getItem("dusk_token");
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem("dusk_token", token);
  else localStorage.removeItem("dusk_token");
}

function authHeader(): HeadersInit {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
    ...authHeader(),
  };
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let msg = res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.length > 0) msg = j.error;
    } catch {
      const t = text.trim().slice(0, 200);
      if (t.length > 0) msg = t;
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  register: (body: { email: string; username: string; password: string; displayName?: string }) =>
    req<{ token: string; user: import("./types").User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  requestPasswordReset: (email: string) =>
    req<{ ok: boolean }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  confirmPasswordReset: (email: string, code: string, newPassword: string) =>
    req<{ token: string; user: import("./types").User }>("/api/auth/reset-password/confirm", {
      method: "POST",
      body: JSON.stringify({ email, code, newPassword }),
    }),
  login: (body: { email: string; password: string }) =>
    req<{ token: string; user: import("./types").User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: () => req<import("./types").User>("/api/me"),
  patchMe: (body: Partial<Pick<import("./types").User, "displayName" | "avatarHue" | "accentHue" | "bio" | "customStatus" | "username">>) =>
    req<{ token: string; user: import("./types").User }>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  dms: () => req<import("./types").DmSummary[]>("/api/dms"),
  openDm: (userId: string) => req<{ conversationId: string }>("/api/dms/open", { method: "POST", body: JSON.stringify({ userId }) }),
  userSearch: (q: string) =>
    req<import("./types").LiteUser[]>(`/api/users/search?q=${encodeURIComponent(q.trim())}`),
  presenceBulk: (userIds: string[]) => {
    const ids = userIds.filter(Boolean).slice(0, 50);
    if (ids.length === 0) return Promise.resolve([] as import("./types").Presence[]);
    return req<import("./types").Presence[]>(`/api/presence/bulk?ids=${encodeURIComponent(ids.join(","))}`);
  },
  friends: () => req<import("./types").FriendWithPresence[]>("/api/friends"),
  friendRequests: (box: "incoming" | "outgoing") =>
    req<import("./types").SocialRequestRow[]>(`/api/friends/requests?box=${box}`),
  sendFriendRequest: (toUserId: string) =>
    req<import("./types").SocialRequestRow>("/api/friends/requests", {
      method: "POST",
      body: JSON.stringify({ toUserId }),
    }),
  acceptFriendRequest: (requestId: string) =>
    req<{ ok: boolean }>(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`, { method: "POST", body: "{}" }),
  declineFriendRequest: (requestId: string) =>
    req<{ ok: boolean }>(`/api/friends/requests/${encodeURIComponent(requestId)}/decline`, { method: "POST", body: "{}" }),
  cancelFriendRequest: (requestId: string) =>
    req<{ ok: boolean }>(`/api/friends/requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", body: "{}" }),
  removeFriend: (userId: string) =>
    req<{ ok: boolean }>(`/api/friends/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  dmRequests: (box: "incoming" | "outgoing") =>
    req<import("./types").SocialRequestRow[]>(`/api/dm-requests?box=${box}`),
  createDmRequest: (toUserId: string) =>
    req<import("./types").SocialRequestRow>("/api/dm-requests", {
      method: "POST",
      body: JSON.stringify({ toUserId }),
    }),
  acceptDmRequest: (requestId: string) =>
    req<{ ok: boolean; conversationId: string }>(`/api/dm-requests/${encodeURIComponent(requestId)}/accept`, {
      method: "POST",
      body: "{}",
    }),
  declineDmRequest: (requestId: string) =>
    req<{ ok: boolean }>(`/api/dm-requests/${encodeURIComponent(requestId)}/decline`, { method: "POST", body: "{}" }),
  dmMessages: (conversationId: string) => req<import("./types").DmMessage[]>(`/api/dms/${conversationId}/messages`),
  dmPeer: (conversationId: string) =>
    req<{
      other: Pick<
        import("./types").User,
        "id" | "username" | "displayName" | "avatarHue" | "accentHue" | "avatarUrl" | "bannerUrl"
      > | null;
    }>(`/api/dms/${conversationId}/peer`),
  servers: () => req<import("./types").Server[]>("/api/servers"),
  createServer: (name: string) =>
    req<import("./types").Server>("/api/servers", { method: "POST", body: JSON.stringify({ name }) }),
  invitePreview: (inviteCode: string) => {
    const c = inviteCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return req<{ name: string; memberCount: number; channelCount: number; iconUrl: string | null }>(
      `/api/invites/${encodeURIComponent(c)}`,
    );
  },
  joinServer: (inviteCode: string) =>
    req<import("./types").Server>("/api/servers/join", { method: "POST", body: JSON.stringify({ inviteCode }) }),
  createChannel: (serverId: string, body: { name: string; kind?: import("./types").ChannelKind }) =>
    req<import("./types").Server>(`/api/servers/${serverId}/channels`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteChannel: (channelId: string) =>
    req<import("./types").Server>(`/api/channels/${channelId}`, { method: "DELETE" }),
  messages: (channelId: string) => req<import("./types").Message[]>(`/api/channels/${channelId}/messages`),
  toggleReaction: (messageId: string, emoji: string) =>
    req<import("./types").Message>(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),
  patchMessage: (messageId: string, content: string) =>
    req<import("./types").Message>(`/api/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  deleteMessage: (messageId: string) => req<{ ok: boolean }>(`/api/messages/${messageId}`, { method: "DELETE" }),
  patchDmMessage: (messageId: string, content: string) =>
    req<import("./types").DmMessage>(`/api/dm-messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  deleteDmMessage: (messageId: string) => req<{ ok: boolean }>(`/api/dm-messages/${messageId}`, { method: "DELETE" }),
  patchChannel: (channelId: string, name: string) =>
    req<import("./types").Server>(`/api/channels/${channelId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  patchServer: (serverId: string, name: string) =>
    req<import("./types").Server>(`/api/servers/${serverId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  leaveServer: (serverId: string) =>
    req<{ ok: boolean }>(`/api/servers/${serverId}/leave`, { method: "POST", body: "{}" }),
  kickMember: (serverId: string, userId: string) =>
    req<{ ok: boolean }>(`/api/servers/${serverId}/members/${userId}`, { method: "DELETE" }),
  patchMemberRole: (serverId: string, userId: string, role: "member" | "admin") =>
    req<import("./types").Server>(`/api/servers/${serverId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  uploadChannelVoice: async (channelId: string, blob: Blob, caption?: string) => {
    const fd = new FormData();
    fd.append("audio", blob, "voice.webm");
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/channels/${channelId}/messages/voice`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").Message>;
  },
  uploadChannelImage: async (channelId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append("image", file);
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/channels/${channelId}/messages/image`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").Message>;
  },
  uploadChannelVideo: async (channelId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append("video", file);
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/channels/${channelId}/messages/video`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").Message>;
  },
  uploadChannelAudio: async (channelId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append("audio", file);
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/channels/${channelId}/messages/audio`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").Message>;
  },
  uploadDmVoice: async (conversationId: string, blob: Blob, caption?: string) => {
    const fd = new FormData();
    fd.append("audio", blob, "voice.webm");
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/dms/${conversationId}/messages/voice`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").DmMessage>;
  },
  uploadAvatar: async (file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch(`${base}/api/me/avatar`, { method: "POST", headers: authHeader(), body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<{ token: string; user: import("./types").User }>;
  },
  removeAvatar: async () => {
    const res = await fetch(`${base}/api/me/avatar`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<{ token: string; user: import("./types").User }>;
  },
  uploadBanner: async (file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch(`${base}/api/me/banner`, { method: "POST", headers: authHeader(), body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<{ token: string; user: import("./types").User }>;
  },
  removeBanner: async () => {
    const res = await fetch(`${base}/api/me/banner`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<{ token: string; user: import("./types").User }>;
  },
  uploadServerIcon: async (serverId: string, file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch(`${base}/api/servers/${serverId}/icon`, { method: "POST", headers: authHeader(), body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").Server>;
  },
  uploadDmImage: async (conversationId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append("image", file);
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/dms/${conversationId}/messages/image`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").DmMessage>;
  },
  uploadDmVideo: async (conversationId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append("video", file);
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/dms/${conversationId}/messages/video`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").DmMessage>;
  },
  uploadDmAudio: async (conversationId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append("audio", file);
    if (caption?.trim()) fd.append("caption", caption.trim());
    const res = await fetch(`${base}/api/dms/${conversationId}/messages/audio`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<import("./types").DmMessage>;
  },
};

/** Voice memo, uploaded audio file, etc. — anything served as a blob behind auth. */
export async function fetchAuthedMediaBlob(url: string): Promise<string> {
  const res = await fetch(`${base}${url}`, { headers: authHeader() });
  if (!res.ok) throw new Error("media load failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function fetchVoiceBlob(url: string): Promise<string> {
  return fetchAuthedMediaBlob(url);
}

export async function fetchImageBlob(url: string): Promise<string> {
  const res = await fetch(`${base}${url}`, { headers: authHeader() });
  if (!res.ok) throw new Error("image load failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function fetchVideoBlob(url: string): Promise<string> {
  const res = await fetch(`${base}${url}`, { headers: authHeader() });
  if (!res.ok) throw new Error("video load failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export { getToken };
