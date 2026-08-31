import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { Prisma } from "@prisma/client";
import { COOKIE_NAME, verifySession, type SessionUser } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { config } from "../config/env";

interface Participant {
  userId: string;
  userName: string;
  role: string;
  socketId: string;
}

interface RoomData {
  participants: Map<string, Participant>;
  state: Record<string, unknown>;
  hydrated: boolean;
  startedAt: number;
}

interface SocketRoomData {
  session: SessionUser;
  interviewId?: string;
  userId?: string;
  userName?: string;
  role?: string;
  isInterviewer?: boolean;
}

const rooms = new Map<string, RoomData>();
const ROOM_STATE_DEBOUNCE_MS = 3000;
const pendingWrites = new Map<string, NodeJS.Timeout>();

function getRoom(interviewId: string): RoomData {
  if (!rooms.has(interviewId)) {
    rooms.set(interviewId, {
      participants: new Map(),
      state: {},
      hydrated: false,
      startedAt: Date.now(),
    });
  }
  return rooms.get(interviewId)!;
}

async function hydrateRoomFromDb(interviewId: string, room: RoomData) {
  if (room.hydrated) return;
  room.hydrated = true;

  try {
    const savedStates = await prisma.roomState.findMany({ where: { interviewId } });
    for (const saved of savedStates) {
      if (saved.code !== null) {
        room.state[`code-${saved.questionId}`] = {
          code: saved.code,
          language: saved.language,
          updatedBy: saved.updatedBy,
          ts: saved.updatedAt.getTime(),
        };
      }
      if (saved.workspaceData !== null) {
        room.state[`wb-${saved.questionId}`] = {
          ...(saved.workspaceData as Record<string, unknown>),
          updatedBy: saved.updatedBy,
          ts: saved.updatedAt.getTime(),
        };
      }
    }
  } catch (err) {
    console.error(`Failed to hydrate room state for interview ${interviewId}:`, err);
  }
}

function scheduleRoomStateWrite(
  interviewId: string,
  questionId: string,
  updatedBy: string,
  fields: { code?: string; workspaceData?: unknown; language?: string }
) {
  const key = `${interviewId}:${questionId}`;
  const existingTimer = pendingWrites.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    pendingWrites.delete(key);
    try {
      await prisma.roomState.upsert({
        where: { interviewId_questionId: { interviewId, questionId } },
        create: {
          interviewId,
          questionId,
          code: fields.code ?? null,
          workspaceData:
            fields.workspaceData !== undefined
              ? (fields.workspaceData as Prisma.InputJsonValue)
              : undefined,
          language: fields.language ?? "javascript",
          updatedBy,
          version: 1,
        },
        update: {
          ...(fields.code !== undefined ? { code: fields.code } : {}),
          ...(fields.workspaceData !== undefined
            ? { workspaceData: fields.workspaceData as Prisma.InputJsonValue }
            : {}),
          ...(fields.language !== undefined ? { language: fields.language } : {}),
          updatedBy,
          version: { increment: 1 },
        },
      });
    } catch (err) {
      console.error(`Failed to persist room state for ${key}:`, err);
    }
  }, ROOM_STATE_DEBOUNCE_MS);

  pendingWrites.set(key, timer);
}

// timestampMs = ms ELAPSED SINCE ROOM STARTED (schema column is 32-bit Int;
// a raw Date.now() epoch value overflows it).
async function persistInterviewEvent(
  interviewId: string,
  type: string,
  timestampMs: number,
  payload: Record<string, unknown>,
  questionId?: string
) {
  try {
    await prisma.interviewEvent.create({
      data: {
        interviewId,
        questionId: questionId ?? null,
        type: type as any,
        timestampMs,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error(`Failed to persist event ${type} for interview ${interviewId}:`, err);
  }
}

function getSocketRoomData(socket: Socket): SocketRoomData {
  return socket.data as SocketRoomData;
}

function parseCookie(cookieHeader?: string, key: string = COOKIE_NAME): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

async function getSessionFromSocket(socket: Socket): Promise<SessionUser | null> {
  const token =
    parseCookie(socket.handshake.headers.cookie, COOKIE_NAME) ||
    socket.handshake.auth?.token;
  if (!token) return null;
  return verifySession(token);
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: "/api/socket",
    cors: {
      origin: config.clientUrl,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.use(async (socket, next) => {
    try {
      const session = await getSessionFromSocket(socket);
      if (!session) {
        return next(new Error("Unauthorized"));
      }
      socket.data.session = session;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const session = socket.data.session as SessionUser;

    socket.on("join-room", async (data: { interviewId: string }) => {
      const { interviewId } = data;
      if (!interviewId) {
        socket.emit("join-error", { error: "Interview ID is required" });
        return;
      }

      const interview = await prisma.interview.findUnique({
        where: { id: interviewId },
        include: {
          position: { select: { interviewerId: true } },
          candidate: { select: { userId: true } },
        },
      });

      if (!interview) {
        socket.emit("join-error", { error: "Interview not found" });
        return;
      }

      const isInterviewer = interview.position.interviewerId === session.id;
      const isCandidate = interview.candidate.userId === session.id;

      if (!isInterviewer && !isCandidate) {
        socket.emit("join-error", { error: "You do not have access to this interview" });
        return;
      }

      const userId = session.id;
      const userName = session.name;
      const role = session.role;

      socket.join(interviewId);
      Object.assign(socket.data, { interviewId, userId, userName, role, isInterviewer });

      const room = getRoom(interviewId);
      await hydrateRoomFromDb(interviewId, room);

      room.participants.set(userId, { userId, userName, role, socketId: socket.id });

      socket.emit("room-state", { ...room.state });
      const others = Array.from(room.participants.values()).filter(
        (participant) => participant.socketId !== socket.id
      );
      socket.emit("participants-list", others);

      socket.to(interviewId).emit("user-joined", { userId, userName, role, socketId: socket.id });
    });

    socket.on("layout-toggle", ({ tool }) => {
      const data = getSocketRoomData(socket);
      if (!data.interviewId || !data.isInterviewer) return;

      const room = getRoom(data.interviewId);
      room.state.activeTool = tool;
      socket.to(data.interviewId).emit("layout-toggle", { tool });
    });

    socket.on("code-update", ({ questionId, code, language }) => {
      const { interviewId, userId } = getSocketRoomData(socket);
      if (!interviewId || !questionId || !userId) return;

      const room = getRoom(interviewId);
      room.state[`code-${questionId}`] = { code, language, updatedBy: userId, ts: Date.now() };

      socket.to(interviewId).emit("code-update", { questionId, code, language, userId });
      scheduleRoomStateWrite(interviewId, questionId, userId, { code, language });
    });

    socket.on("whiteboard-update", ({ questionId, elements, notes, strokes }) => {
      const { interviewId, userId } = getSocketRoomData(socket);
      if (!interviewId || !questionId || !userId) return;

      const room = getRoom(interviewId);
      room.state[`wb-${questionId}`] = { elements, notes, strokes, updatedBy: userId, ts: Date.now() };

      socket.to(interviewId).emit("whiteboard-update", { questionId, elements, notes, strokes, userId });
      scheduleRoomStateWrite(interviewId, questionId, userId, {
        workspaceData: { elements, notes, strokes },
      });
    });

    socket.on("record-event", ({ type, questionId, payload }) => {
      const { interviewId, userId } = getSocketRoomData(socket);
      if (!interviewId || !userId || !type) return;

      const allowedTypes = ["HINT", "FLAG", "NOTE", "TRANSCRIPT", "SQL_QUERY"];
      if (!allowedTypes.includes(type)) return;

      const room = getRoom(interviewId);
      const fullPayload = { ...(payload ?? {}), userId };

      persistInterviewEvent(interviewId, type, Date.now() - room.startedAt, fullPayload, questionId);

      socket.to(interviewId).emit("event-recorded", { type, questionId, payload: fullPayload });
    });

    socket.on("question-switch", ({ questionIdx, questionId, title }) => {
      const data = getSocketRoomData(socket);
      if (!data.interviewId || !data.isInterviewer) return;

      const room = getRoom(data.interviewId);
      const previousQuestion = room.state.activeQuestion as
        | { questionIdx: number; questionId: string; title: string; ts: number }
        | undefined;

      room.state.activeQuestion = { questionIdx, questionId, title, ts: Date.now() };
      socket.to(data.interviewId).emit("question-switch", { questionIdx, questionId, title });

      persistInterviewEvent(
        data.interviewId,
        "QUESTION_STARTED",
        Date.now() - room.startedAt,
        { questionIdx, title },
        questionId
      );

      if (previousQuestion) {
        const finalCode = room.state[`code-${previousQuestion.questionId}`];
        persistInterviewEvent(
          data.interviewId,
          "QUESTION_ENDED",
          Date.now() - room.startedAt,
          { title: previousQuestion.title, finalState: finalCode ?? null },
          previousQuestion.questionId
        );
      }
    });

    socket.on("disconnect", () => {
      const { interviewId, userId, userName } = getSocketRoomData(socket);
      if (interviewId && userId) {
        const room = rooms.get(interviewId);
        if (room) {
          const existing = room.participants.get(userId);
          if (existing?.socketId === socket.id) {
            room.participants.delete(userId);
          }
          socket.to(interviewId).emit("user-left", { userId, userName, socketId: socket.id });
          if (room.participants.size === 0) {
            rooms.delete(interviewId);
          }
        }
      }
    });
  });

  return io;
}