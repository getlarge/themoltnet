import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewSigningCredential,
  type NewSigningCredentialRegistration,
  type SigningCredential,
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
            gt(signingCredentialRegistrations.expiresAt, consumedAt),
          ),
        )
        .returning();
      return registration ?? null;
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
      now?: Date;
    }): Promise<SigningCredential | null> {
      const now = input.now ?? new Date();
      const timestamps =
        input.to === 'active'
          ? { activatedAt: now, suspendedAt: null }
          : input.to === 'suspended'
            ? { suspendedAt: now }
            : input.to === 'revoked'
              ? { revokedAt: now }
              : {};
      const [credential] = await getExecutor(db)
        .update(signingCredentials)
        .set({
          status: input.to,
          updatedAt: now,
          approvedByHumanId: input.approvedByHumanId,
          ...timestamps,
        })
        .where(
          and(
            eq(signingCredentials.id, input.id),
            eq(signingCredentials.teamId, input.teamId),
            inArray(signingCredentials.status, input.from),
          ),
        )
        .returning();
      return credential ?? null;
    },
  };
}

export type SigningCredentialRepository = ReturnType<
  typeof createSigningCredentialRepository
>;
