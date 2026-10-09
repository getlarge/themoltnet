import { type Static, Type } from 'typebox';

const id = Type.String({ pattern: '^[1-9][0-9]*$' });
const json = Type.Record(Type.String(), Type.Unknown());
export const ConversationMessage = Type.Object({
  id: Type.String(),
  entryId: Type.Union([id, Type.Null()]),
  entryKind: Type.String(),
  inherited: Type.Boolean(),
  status: Type.Union([
    Type.Literal('completed'),
    Type.Literal('streaming'),
    Type.Literal('interrupted'),
    Type.Literal('failed'),
  ]),
  /** Pi's already assembled user/assistant/toolResult message; never storage operations. */
  message: json,
});
export type ConversationMessage = Static<typeof ConversationMessage>;
export const ConversationSummary = Type.Object({
  conversationId: id,
  parentConversationId: Type.Union([id, Type.Null()]),
  kind: Type.Union([Type.Literal('main'), Type.Literal('subagent')]),
});
export const ConversationList = Type.Object({
  items: Type.Array(ConversationSummary),
});
export type ConversationList = Static<typeof ConversationList>;
export const ConversationSnapshot = Type.Object({
  conversationId: id,
  cursor: Type.String(),
  attemptStatus: Type.String(),
  messages: Type.Array(ConversationMessage),
  nextBeforeEntryId: Type.Union([id, Type.Null()]),
  /** Persisted tool progress, retry/deferred state and compaction status from pi.live. */
  live: json,
});
export type ConversationSnapshot = Static<typeof ConversationSnapshot>;
export const ConversationParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
  n: Type.Integer({ minimum: 1 }),
  conversationId: id,
});
export const ConversationReadQuery = Type.Object({
  beforeEntryId: Type.Optional(id),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
