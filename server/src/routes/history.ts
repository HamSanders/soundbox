/**
 * Conversation and history routes.
 *
 * A conversation is a durable thread with a URL you can come back to, and its
 * entries are what happened in it — see `history.ts` for why that is one list
 * rather than three.
 *
 * Appending is deliberately a route of its own rather than a side effect of
 * `/api/assistant/chat`. Plenty of what belongs in a studio's history never
 * goes near the assistant: a render started from the Prompt panel, an edit
 * applied from the chat that the studio planner handled locally. Those all
 * have to land in the same list, so the list takes writes from anyone.
 */

import type { FastifyInstance } from "fastify";

import { conversationAppendSchema, conversationCreateSchema, conversationPatchSchema } from "../schemas.js";
import type { KonchiService } from "../service.js";
import { HttpError, intQuery } from "./helpers.js";

type ConversationParams = { Params: { conversation_id: string } };

export function registerHistory(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/conversations", async (request) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    // `story_id` asks the other question: not "what have I talked about" but
    // "what happened in this studio", which is what the History panel opens
    // with when a timeline is reopened.
    const storyId = typeof query.story_id === "string" ? query.story_id : null;
    if (storyId) {
      const found = svc.conversationForStory(storyId);
      return found ? [found] : [];
    }
    return svc.listConversations(intQuery(query.limit, "limit", 50, 1, 200));
  });

  app.post("/api/conversations", async (request, reply) => {
    const body = conversationCreateSchema.parse(request.body ?? {});
    const created = svc.createConversation(body.title ?? null, body.story_id ?? null);
    return reply.code(201).send(created);
  });

  app.get<ConversationParams>("/api/conversations/:conversation_id", async (request) => {
    const found = svc.getConversation(request.params.conversation_id);
    if (found === null) throw new HttpError(404, "Conversation not found");
    return found;
  });

  /** The conversation and everything that happened in it, in order. */
  app.get<ConversationParams>("/api/conversations/:conversation_id/entries", async (request) => {
    const found = svc.getConversation(request.params.conversation_id);
    if (found === null) throw new HttpError(404, "Conversation not found");
    return svc.conversationEntries(request.params.conversation_id);
  });

  app.post<ConversationParams>(
    "/api/conversations/:conversation_id/entries",
    async (request, reply) => {
      const found = svc.getConversation(request.params.conversation_id);
      if (found === null) throw new HttpError(404, "Conversation not found");
      const body = conversationAppendSchema.parse(request.body ?? {});
      const entries = svc.appendConversationEntries(request.params.conversation_id, body.entries);
      return reply.code(201).send(entries);
    },
  );

  app.patch<ConversationParams>("/api/conversations/:conversation_id", async (request) => {
    const body = conversationPatchSchema.parse(request.body ?? {});
    const renamed = svc.renameConversation(request.params.conversation_id, body.title);
    if (renamed === null) throw new HttpError(404, "Conversation not found");
    return renamed;
  });

  app.delete<ConversationParams>("/api/conversations/:conversation_id", async (request, reply) => {
    if (!svc.deleteConversation(request.params.conversation_id)) {
      throw new HttpError(404, "Conversation not found");
    }
    return reply.code(204).send();
  });
}
