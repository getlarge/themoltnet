# Write E2E Tests for Team Governance Endpoints

## Problem/Feature Description

The team governance feature has just been implemented: endpoints for initiating, accepting, and rejecting ownership transfers, listing pending transfers, accepting team founding requests, and creating teams. These endpoints are now deployed and an E2E test suite needs to be written for them.

The project has an E2E test infrastructure already set up. An existing E2E test file is provided as a reference for the testing patterns used.

## Output Specification

Create `team-governance.e2e.test.ts` — a complete E2E test file covering:
- `POST /teams` — create a team
- `POST /teams/{id}/ownership-transfers` — initiate an ownership transfer
- `GET /teams/{id}/ownership-transfers` — list pending transfers
- `POST /teams/{id}/ownership-transfers/{transferId}/accept` — accept a transfer
- `POST /teams/{id}/ownership-transfers/{transferId}/reject` — reject a transfer
- `POST /teams/founding-requests/{requestId}/accept` — accept a founding request

## Input Files

The following reference file is provided. Extract it before beginning.

<!-- prettier-ignore-start -->

```
=============== FILE: inputs/diaries.e2e.test.ts ===============
import { test, expect, beforeAll } from 'vitest';
import { createApiClient } from '@moltnet/api-client';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

let client: ReturnType<typeof createApiClient>;
let authToken: string;

beforeAll(async () => {
  // Get OAuth token
  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TEST_CLIENT_ID ?? '',
      client_secret: process.env.TEST_CLIENT_SECRET ?? '',
    }),
  });
  const data = await res.json();
  authToken = data.access_token;

  client = createApiClient(BASE_URL, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
});

test('create diary', async () => {
  const res = await client.diaries.create({ name: 'test-diary' });
  expect(res.id).toBeDefined();
  expect(res.name).toBe('test-diary');
});

test('list diaries', async () => {
  const res = await client.diaries.list();
  expect(Array.isArray(res.items)).toBe(true);
});

test('get diary by id', async () => {
  const created = await client.diaries.create({ name: 'get-test' });
  const fetched = await client.diaries.get(created.id);
  expect(fetched.id).toBe(created.id);
});
=============== END FILE ===============
```

<!-- prettier-ignore-end -->

## Notes

- The test environment has `API_BASE_URL`, `TEST_CLIENT_ID`, and `TEST_CLIENT_SECRET` env vars set
- OAuth token acquisition via `/oauth2/token` with `client_credentials` grant is acceptable for non-client operations
- Auth registration (`/auth/register`) and health checks (`/health`) may also use raw fetch
