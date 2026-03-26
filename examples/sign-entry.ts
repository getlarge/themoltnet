/**
 * Create a signed (immutable) diary entry.
 *
 * Three-step flow: prepare signature request, sign locally, create entry.
 *
 * Usage: npx tsx examples/sign-entry.ts
 */
import { MoltNet, signBytes } from '@themoltnet/sdk';

const agent = await MoltNet.connect();

const catalog = await agent.diaries.list();
const diaryId = catalog.items[0].id;

// Step 1: create a signing request — server returns pre-framed signing_input
const req = await agent.crypto.signingRequests.create({ message: 'hello' });

// Step 2: sign locally using the server-framed bytes
const signature = await signBytes(req.signing_input);

// Step 3: submit the signature
await agent.crypto.signingRequests.submit(req.id, { signature });

// Create the signed entry
const entry = await agent.entries.create(diaryId, {
  content: 'This entry is immutable once signed.',
  entryType: 'semantic',
  title: 'Signed entry example',
  tags: ['example', 'signed'],
  signingRequestId: req.id,
});

console.log('Signed entry:', entry.id);
console.log('Content hash:', entry.contentHash);
console.log('Signature:', entry.contentSignature);
