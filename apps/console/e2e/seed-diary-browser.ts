/* eslint-disable no-console */
import { randomBytes } from 'node:crypto';

import {
  createClient,
  createDiary,
  createDiaryEntry,
  createTeam,
  listTeams,
} from '@moltnet/api-client';
import { Configuration, FrontendApi } from '@ory/client-fetch';

const KRATOS_PUBLIC_URL =
  process.env['KRATOS_PUBLIC_URL'] ?? 'http://localhost:4433';
const KRATOS_UI_URL = process.env['KRATOS_UI_URL'] ?? 'http://localhost:4455';
const REST_API_URL = process.env['REST_API_URL'] ?? 'http://localhost:8000';
const CONSOLE_URL = process.env['CONSOLE_BASE_URL'] ?? 'http://localhost:5174';

interface TestUser {
  email: string;
  username: string;
  password: string;
}

function createTestUser(): TestUser {
  const nonce = randomBytes(4).toString('hex');
  return {
    email: `diary-browser-${Date.now()}-${nonce}@example.com`,
    username: `diary_browser_${nonce}`,
    password: `DiaryBrowser!${nonce}abcd`,
  };
}

async function createHumanSession(user: TestUser): Promise<string> {
  const kratos = new FrontendApi(
    new Configuration({ basePath: KRATOS_PUBLIC_URL }),
  );

  const registrationFlow = await kratos.createNativeRegistrationFlow();
  await kratos.updateRegistrationFlow({
    flow: registrationFlow.id,
    updateRegistrationFlowBody: {
      method: 'password',
      traits: {
        email: user.email,
        username: user.username,
      },
      password: user.password,
    },
  });

  const loginFlow = await kratos.createNativeLoginFlow();
  const loginResult = await kratos.updateLoginFlow({
    flow: loginFlow.id,
    updateLoginFlowBody: {
      method: 'password',
      identifier: user.email,
      password: user.password,
    },
  });

  if (!loginResult.session_token) {
    throw new Error('Native login did not return a session token');
  }

  return loginResult.session_token;
}

function createSessionClient() {
  return createClient({
    baseUrl: REST_API_URL,
  });
}

async function seedDiaryFixtures(sessionToken: string) {
  const nonce = randomBytes(3).toString('hex');
  const client = createSessionClient();
  client.interceptors.request.use((request) => {
    request.headers.set('X-Moltnet-Session-Token', sessionToken);
    return request;
  });

  let teamsResponse = await listTeams({ client });
  let team =
    teamsResponse.data?.items.find((candidate) => candidate.personal) ??
    teamsResponse.data?.items[0];

  if (!team) {
    const createdTeam = await createTeam({
      client,
      body: {
        name: `Diary browser demo team ${nonce}`,
      },
    });
    if (!createdTeam.data) {
      throw new Error(
        `Failed to create a team for diary seeding: ${createdTeam.response.status} ${JSON.stringify(createdTeam.error)}`,
      );
    }

    teamsResponse = await listTeams({ client });
    team =
      teamsResponse.data?.items.find(
        (candidate) => candidate.id === createdTeam.data?.id,
      ) ?? teamsResponse.data?.items[0];
  }

  if (!team) {
    throw new Error('Expected an accessible team after team bootstrap');
  }

  const overviewDiary = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': team.id },
    body: {
      name: `UI diary browser demo ${nonce}`,
      visibility: 'private',
    },
  });
  const emptyDiary = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': team.id },
    body: {
      name: `Empty diary browser demo ${nonce}`,
      visibility: 'private',
    },
  });

  if (!overviewDiary.data || !emptyDiary.data) {
    throw new Error('Failed to create demo diaries');
  }

  await createDiaryEntry({
    client,
    path: { diaryId: overviewDiary.data.id },
    body: {
      entryType: 'semantic',
      importance: 8,
      title: `Dashboard IA review ${nonce}`,
      content:
        'This seeded entry exists so the diary browser shows a realistic overview card, tags, and readable metadata immediately after login.',
      tags: ['ui', 'dashboard', `seed:${nonce}`],
    },
  });

  await createDiaryEntry({
    client,
    path: { diaryId: overviewDiary.data.id },
    body: {
      entryType: 'procedural',
      importance: 7,
      title: `Route walk-through ${nonce}`,
      content:
        'Open the diaries route, inspect the detail page, switch between grid and timeline, then verify the entry detail metadata panel.',
      tags: ['ui', 'walkthrough', 'routes'],
    },
  });

  await createDiaryEntry({
    client,
    path: { diaryId: overviewDiary.data.id },
    body: {
      entryType: 'reflection',
      importance: 5,
      title: `Tag cloud sample ${nonce}`,
      content:
        'The tag cloud becomes useful only once a diary has more than one entry with overlapping and distinct tags.',
      tags: ['ui', 'tags', 'reflection'],
    },
  });

  return {
    overviewDiaryId: overviewDiary.data.id,
    overviewDiaryName: overviewDiary.data.name,
    emptyDiaryId: emptyDiary.data.id,
    emptyDiaryName: emptyDiary.data.name,
  };
}

async function main() {
  const user = createTestUser();
  const sessionToken = await createHumanSession(user);
  const seeded = await seedDiaryFixtures(sessionToken);

  console.log('');
  console.log('Seeded local diary browser fixtures');
  console.log(`Console: ${CONSOLE_URL}`);
  console.log(`Kratos UI: ${KRATOS_UI_URL}`);
  console.log(`Email: ${user.email}`);
  console.log(`Username: ${user.username}`);
  console.log(`Password: ${user.password}`);
  console.log(`Populated diary: ${seeded.overviewDiaryName}`);
  console.log(`Empty diary: ${seeded.emptyDiaryName}`);
  console.log(`${CONSOLE_URL}/diaries/${seeded.overviewDiaryId}`);
  console.log(`${CONSOLE_URL}/diaries/${seeded.emptyDiaryId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
