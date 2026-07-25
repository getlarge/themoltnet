import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewSigningCredential,
  type NewSigningCredentialRegistration,
  type SigningCredential,
  signingCredentialEvents,
  type SigningCredentialRegistration,
  signingCredentialRegistrations,
  signingCredentials,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type SigningCredentialStatus = SigningCredential['status'];

export interface SigningCredentialOwner {
  kind: 'agent' | 'human';
  id: string;
}

export type CreateSigningCredentialInput = Omit<
  NewSigningCredential,
  'id' | 'createdAt' | 'updatedAt' | 'ownerAgentId' | 'ownerHumanId'
> & {
  owner: SigningCredentialOwner;
};

export function createSigningCredentialRepository(db: Database) {
  return {
    async createRegistration(
      input: Omit<NewSigningCredentialRegistration, 'createdAt'>,
    ): Promise<SigningCredentialRegistration> {
      const [registration] = await getExecutor(db)
        .insert(signingCredentialRegistrations)
        .values(input)
        .returning();
      return registration;
    },

    async findRegistrationById(
      id: string,
    ): Promise<SigningCredentialRegistration | null> {
      const [registration] = await getExecutor(db)
        .select()
        .from(signingCredentialRegistrations)
        .where(eq(signingCredentialRegistrations.id, id))
        .limit(1);
      return registration ?? null;
    },

    async consumeRegistration(
      id: string,
      ownerHumanId: string,
      consumedAt = new Date(),
    ): Promise<SigningCredentialRegistration | null> {
      const [registration] = await getExecutor(db)
        .update(signingCredentialRegistrations)
        .set({ consumedAt })
        .where(
          and(
            eq(signingCredentialRegistrations.id, id),
            eq(signingCredentialRegistrations.ownerHumanId, ownerHumanId),
            isNull(signingCredentialRegistrations.consumedAt),
            gt(signingCredentialRegistrations.expiresAt, sql`now()`),
          ),
        )
        .returning();
      return registration ?? null;
    },

    async lockRegistrationForCompletion(
      id: string,
      ownerHumanId: string,
      teamId: string,
    ): Promise<SigningCredentialRegistration | null> {
      const [registration] = await getExecutor(db)
        .select()
        .from(signingCredentialRegistrations)
        .where(
          and(
            eq(signingCredentialRegistrations.id, id),
            eq(signingCredentialRegistrations.ownerHumanId, ownerHumanId),
            eq(signingCredentialRegistrations.teamId, teamId),
            isNull(signingCredentialRegistrations.consumedAt),
            gt(signingCredentialRegistrations.expiresAt, sql`now()`),
          ),
        )
        .limit(1)
        .for('update');
      return registration ?? null;
    },

    async cleanupRegistrations(now = new Date(), limit = 100): Promise<number> {
      const candidates = await getExecutor(db)
        .select({ id: signingCredentialRegistrations.id })
        .from(signingCredentialRegistrations)
        .where(
          or(
            lte(signingCredentialRegistrations.expiresAt, now),
            isNotNull(signingCredentialRegistrations.consumedAt),
          ),
        )
        .limit(limit);
      if (candidates.length === 0) return 0;
      const deleted = await getExecutor(db)
        .delete(signingCredentialRegistrations)
        .where(
          inArray(
            signingCredentialRegistrations.id,
            candidates.map(({ id }) => id),
          ),
        )
        .returning({ id: signingCredentialRegistrations.id });
      return deleted.length;
    },

    async create(
      input: CreateSigningCredentialInput,
    ): Promise<SigningCredential> {
      const { owner, ...values } = input;
      const [credential] = await getExecutor(db)
        .insert(signingCredentials)
        .values({
          ...values,
          ownerAgentId: owner.kind === 'agent' ? owner.id : null,
          ownerHumanId: owner.kind === 'human' ? owner.id : null,
        })
        .returning();
      return credential;
    },

    async findById(id: string): Promise<SigningCredential | null> {
      const [credential] = await getExecutor(db)
        .select()
        .from(signingCredentials)
        .where(eq(signingCredentials.id, id))
        .limit(1);
      return credential ?? null;
    },

    async list(options: {
      ownerHumanId?: string;
      teamId?: string;
      status?: SigningCredentialStatus[];
      limit?: number;
      offset?: number;
    }): Promise<{ items: SigningCredential[]; total: number }> {
      const { ownerHumanId, teamId, status, limit = 20, offset = 0 } = options;
      const conditions = [];
      if (ownerHumanId) {
        conditions.push(eq(signingCredentials.ownerHumanId, ownerHumanId));
      }
      if (teamId) {
        conditions.push(eq(signingCredentials.teamId, teamId));
      }
      if (status?.length) {
        conditions.push(inArray(signingCredentials.status, status));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const executor = getExecutor(db);
      const [items, [{ value: total }]] = await Promise.all([
        executor
          .select()
          .from(signingCredentials)
          .where(where)
          .orderBy(desc(signingCredentials.createdAt))
          .limit(limit)
          .offset(offset),
        executor
          .select({ value: count() })
          .from(signingCredentials)
          .where(where),
      ]);
      return { items, total };
    },

    async findActiveCompatible(input: {
      id: string;
      ownerHumanId: string;
      teamId: string;
      verificationMethod: SigningCredential['verificationMethod'];
    }): Promise<SigningCredential | null> {
      const [credential] = await getExecutor(db)
        .select()
        .from(signingCredentials)
        .where(
          and(
            eq(signingCredentials.id, input.id),
            eq(signingCredentials.ownerHumanId, input.ownerHumanId),
            eq(signingCredentials.teamId, input.teamId),
            eq(signingCredentials.verificationMethod, input.verificationMethod),
            eq(signingCredentials.status, 'active'),
          ),
        )
        .limit(1);
      return credential ?? null;
    },

    async transition(input: {
      id: string;
      teamId: string;
      from: SigningCredentialStatus[];
      to: SigningCredentialStatus;
      approvedByHumanId?: string;
      actor: SigningCredentialOwner;
      reason?: string;
      now?: Date;
    }): Promise<{
      credential: SigningCredential;
      fromStatus: SigningCredentialStatus;
    } | null> {
      const now = input.now ?? new Date();
      const timestamps =
        input.to === 'active'
          ? { activatedAt: now, suspendedAt: null }
          : input.to === 'suspended'
            ? { suspendedAt: now }
            : input.to === 'revoked'
              ? { revokedAt: now }
              : {};
      const executor = getExecutor(db);
      const approvalSeparation =
        input.to === 'active' && input.actor.kind === 'human'
          ? or(
              isNull(signingCredentials.ownerHumanId),
              ne(signingCredentials.ownerHumanId, input.actor.id),
            )
          : undefined;
      const [before] = await executor
        .select({ status: signingCredentials.status })
        .from(signingCredentials)
        .where(
          and(
            eq(signingCredentials.id, input.id),
            eq(signingCredentials.teamId, input.teamId),
            inArray(signingCredentials.status, input.from),
            approvalSeparation,
          ),
        )
        .limit(1)
        .for('update');
      if (!before) return null;
      const [credential] = await executor
        .update(signingCredentials)
        .set({
          status: input.to,
          updatedAt: now,
          ...(input.approvedByHumanId !== undefined
            ? { approvedByHumanId: input.approvedByHumanId }
            : {}),
          ...timestamps,
        })
        .where(
          and(
            eq(signingCredentials.id, input.id),
            eq(signingCredentials.teamId, input.teamId),
            eq(signingCredentials.status, before.status),
            approvalSeparation,
          ),
        )
        .returning();
      if (!credential) return null;
      await executor.insert(signingCredentialEvents).values({
        credentialId: credential.id,
        teamId: credential.teamId,
        actorAgentId: input.actor.kind === 'agent' ? input.actor.id : null,
        actorHumanId: input.actor.kind === 'human' ? input.actor.id : null,
        fromStatus: before.status,
        toStatus: input.to,
        reason: input.reason,
        createdAt: now,
      });
      return { credential, fromStatus: before.status };
    },
  };
}

export type SigningCredentialRepository = ReturnType<
  typeof createSigningCredentialRepository
>;
