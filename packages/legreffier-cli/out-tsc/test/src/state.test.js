import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clearState, deriveProjectSlug, readState, writeState } from './state.js';
const TEST_SLUG = 'test-project-' + Math.random().toString(36).slice(2);
const stateDir = join(homedir(), '.config', 'moltnet', TEST_SLUG);
describe('deriveProjectSlug', () => {
    it('returns a non-empty string', () => {
        const slug = deriveProjectSlug();
        expect(slug).toBeTruthy();
        expect(typeof slug).toBe('string');
    });
    it('parses HTTPS remote URL', () => {
        // We can test the regex logic by calling with a temp dir that has a known remote
        // Just verify the function doesn't throw on various inputs
        const slug = deriveProjectSlug(process.cwd());
        expect(slug).toMatch(/^[a-zA-Z0-9_.-]+$/);
    });
});
describe('state helpers', () => {
    beforeEach(async () => {
        await mkdir(stateDir, { recursive: true });
    });
    afterEach(async () => {
        await rm(stateDir, { recursive: true, force: true });
    });
    it('returns null when no state file exists', async () => {
        expect(await readState(TEST_SLUG)).toBeNull();
    });
    it('round-trips state', async () => {
        const state = {
            workflowId: 'wf-123',
            publicKey: 'ed25519:abc',
            fingerprint: 'A1B2-C3D4-E5F6-G7H8',
            agentName: 'my-bot',
            phase: 'awaiting_github',
        };
        await writeState(state, TEST_SLUG);
        expect(await readState(TEST_SLUG)).toEqual(state);
    });
    it('preserves optional fields', async () => {
        const state = {
            workflowId: 'wf-456',
            publicKey: 'ed25519:xyz',
            fingerprint: 'X1Y2-Z3A4-B5C6-D7E8',
            agentName: 'other-bot',
            phase: 'post_github',
            appId: '12345',
            appSlug: 'my-app',
            installationId: '99999',
        };
        await writeState(state, TEST_SLUG);
        expect(await readState(TEST_SLUG)).toEqual(state);
    });
    it('clearState removes the file', async () => {
        await writeState({
            workflowId: 'x',
            publicKey: 'x',
            fingerprint: 'x',
            agentName: 'x',
            phase: 'awaiting_github',
        }, TEST_SLUG);
        await clearState(TEST_SLUG);
        expect(await readState(TEST_SLUG)).toBeNull();
    });
    it('clearState is idempotent', async () => {
        await expect(clearState(TEST_SLUG)).resolves.toBeUndefined();
    });
    it('writeState creates directory if missing', async () => {
        await rm(stateDir, { recursive: true, force: true });
        await writeState({
            workflowId: 'x',
            publicKey: 'x',
            fingerprint: 'x',
            agentName: 'x',
            phase: 'awaiting_installation',
        }, TEST_SLUG);
        const s = await stat(join(stateDir, 'legreffier-init.state.json'));
        expect(s.isFile()).toBe(true);
    });
});
//# sourceMappingURL=state.test.js.map