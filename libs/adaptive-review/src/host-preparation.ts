import type { StandaloneReviewServices } from './standalone.js';

const CURRENCY_CACHE_MS = 30_000;

/** Volatile per-host reuse; a replacement host always reconstructs and revalidates. */
export function reuseHostPreparation(
  services: StandaloneReviewServices,
): StandaloneReviewServices {
  const prepared = new Map<string, Promise<void>>();
  const connections = new Map<
    string,
    ReturnType<StandaloneReviewServices['connect']>
  >();
  let revisions:
    | {
        key: string;
        expires: number;
        value: ReturnType<StandaloneReviewServices['github']['revisions']>;
      }
    | undefined;
  return {
    ...services,
    ensureGit(input) {
      const key = `${input.base}:${input.head}`;
      let value = prepared.get(key);
      if (!value) {
        value = services.ensureGit(input).catch((error: unknown) => {
          prepared.delete(key);
          throw error;
        });
        prepared.set(key, value);
      }
      return value;
    },
    github: {
      ...services.github,
      revisions(repo, pr) {
        const key = `${repo}:${pr}`;
        if (
          !revisions ||
          revisions.key !== key ||
          Date.now() >= revisions.expires
        ) {
          const value = services.github
            .revisions(repo, pr)
            .catch((error: unknown) => {
              revisions = undefined;
              throw error;
            });
          revisions = { key, expires: Date.now() + CURRENCY_CACHE_MS, value };
        }
        return revisions.value;
      },
    },
    connect(teamId, signal) {
      let connected = connections.get(teamId);
      if (!connected) {
        connected = services
          .connect(teamId, signal)
          .then((client) => {
            let profiles:
              | { expires: number; value: ReturnType<typeof client.profiles> }
              | undefined;
            return {
              ...client,
              profiles(team: string) {
                if (!profiles || Date.now() >= profiles.expires) {
                  const value = client
                    .profiles(team)
                    .catch((error: unknown) => {
                      profiles = undefined;
                      throw error;
                    });
                  profiles = { expires: Date.now() + CURRENCY_CACHE_MS, value };
                }
                return profiles.value;
              },
            };
          })
          .catch((error: unknown) => {
            connections.delete(teamId);
            throw error;
          });
        connections.set(teamId, connected);
      }
      return connected;
    },
  };
}
