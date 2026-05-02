import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";
import type { Message } from "./types";

export type DuskSocket = Socket;

export function connectSocket(): DuskSocket {
  const token = getToken();
  return io({
    auth: { token },
    transports: ["websocket", "polling"],
  });
}

export type MessageNewHandler = (msg: Message) => void;
