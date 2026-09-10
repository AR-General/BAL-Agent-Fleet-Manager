/**
 * Durable chat composer state: draft, undo stack, and outbox until server ACK.
 * Session-scoped keys survive refresh; undo survives submit.
 */

const DRAFT_PREFIX = "oc-chat-draft:";
const UNDO_PREFIX = "oc-chat-undo:";
const OUTBOX_KEY = "oc-chat-outbox";
const MAX_UNDO = 10;

export type OutboxItem = {
  id: string;
  sessionId: string;
  text: string;
  createdAt: string;
  status: "queued" | "sending" | "failed";
  error?: string;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function loadDraft(sessionId: string | undefined): string {
  if (!sessionId) return "";
  return readJson<string>(`${DRAFT_PREFIX}${sessionId}`, "");
}

export function saveDraft(sessionId: string | undefined, text: string): void {
  if (!sessionId) return;
  if (!text) {
    localStorage.removeItem(`${DRAFT_PREFIX}${sessionId}`);
    return;
  }
  writeJson(`${DRAFT_PREFIX}${sessionId}`, text);
}

export function loadUndoStack(sessionId: string | undefined): string[] {
  if (!sessionId) return [];
  const stack = readJson<string[]>(`${UNDO_PREFIX}${sessionId}`, []);
  return Array.isArray(stack) ? stack.slice(-MAX_UNDO) : [];
}

export function pushUndo(sessionId: string | undefined, text: string): string[] {
  if (!sessionId) return [];
  const trimmed = text;
  const stack = loadUndoStack(sessionId);
  if (stack[stack.length - 1] === trimmed) return stack;
  const next = [...stack, trimmed].slice(-MAX_UNDO);
  writeJson(`${UNDO_PREFIX}${sessionId}`, next);
  return next;
}

export function popUndo(sessionId: string | undefined): { text: string | null; stack: string[] } {
  if (!sessionId) return { text: null, stack: [] };
  const stack = loadUndoStack(sessionId);
  if (!stack.length) return { text: null, stack };
  const text = stack[stack.length - 1] ?? null;
  const next = stack.slice(0, -1);
  writeJson(`${UNDO_PREFIX}${sessionId}`, next);
  return { text, stack: next };
}

export function loadOutbox(): OutboxItem[] {
  const items = readJson<OutboxItem[]>(OUTBOX_KEY, []);
  return Array.isArray(items) ? items : [];
}

export function saveOutbox(items: OutboxItem[]): void {
  writeJson(OUTBOX_KEY, items);
}

export function enqueueOutbox(sessionId: string, text: string): OutboxItem {
  const item: OutboxItem = {
    id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    text,
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  const items = loadOutbox();
  items.push(item);
  saveOutbox(items);
  return item;
}

export function updateOutboxItem(
  id: string,
  patch: Partial<Pick<OutboxItem, "status" | "error">>,
): OutboxItem[] {
  const items = loadOutbox().map((item) => (item.id === id ? { ...item, ...patch } : item));
  saveOutbox(items);
  return items;
}

export function removeOutboxItem(id: string): OutboxItem[] {
  const items = loadOutbox().filter((item) => item.id !== id);
  saveOutbox(items);
  return items;
}

export function sessionOutbox(sessionId: string | undefined): OutboxItem[] {
  if (!sessionId) return [];
  return loadOutbox().filter((item) => item.sessionId === sessionId);
}
