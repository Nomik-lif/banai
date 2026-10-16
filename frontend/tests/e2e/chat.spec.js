import { expect, openDesigner, test } from './fixtures.js';

// Helpers to mock the backend chat/apply endpoints with a mocked LLM.

async function mockChatReply(page, reply) {
  await page.route('**/api/chat', (route) =>
    route.fulfill({ json: { success: true, data: { reply } } }),
  );
}

async function mockChatProposal(page, { reply, proposal }) {
  await page.route('**/api/chat', (route) =>
    route.fulfill({ json: { success: true, data: { reply, proposal } } }),
  );
}

async function mockApplySuccess(page, newDesign, newRevision) {
  await page.route('**/api/proposals/apply', (route) =>
    route.fulfill({ json: { success: true, data: { design: newDesign, revision: newRevision } } }),
  );
}

async function mockApplyStale(page) {
  await page.route('**/api/proposals/apply', (route) =>
    route.fulfill({ status: 409, json: { success: false, error: { code: 'STALE', message: 'Stale' } } }),
  );
}

function storeState(page) {
  return page.evaluate(() => {
    const { design, revision, pendingProposal, chatHistory } = window.__banai.store.getState();
    return { design, revision, pendingProposal, chatHistory };
  });
}

function makeFakeProposal(design, revision) {
  return {
    proposalId: 'test-proposal-1',
    baseRevision: revision,
    baseHash: 'fakehash',
    ops: [{ op: 'update_dimensions', width: 2400, height: null, depth: null }],
    summary: 'Widen the wardrobe to 240 cm',
    signature: 'fakesignature',
  };
}

// --- Tests ---

test.describe('Phase 6: chat UI', () => {
  test.beforeEach(async ({ page }) => openDesigner(page));

  test('chat panel is visible with input and send button', async ({ page }) => {
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-input')).toBeVisible();
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  test('user message appears in history after send', async ({ page }) => {
    await mockChatReply(page, 'I can help with that!');
    await page.getByTestId('chat-input').fill('Make it wider');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-message-user').last()).toContainText('Make it wider');
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText('I can help with that!');
  });

  test('agent reply without proposal shows no proposal card', async ({ page }) => {
    await mockChatReply(page, 'Sure, how wide?');
    await page.getByTestId('chat-input').fill('Something');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText('Sure, how wide?');
    await expect(page.getByTestId('proposal-card')).not.toBeVisible();
  });

  test('proposal card appears with confirm and cancel when agent returns a proposal', async ({ page }) => {
    const { revision } = await storeState(page);
    const design = await page.evaluate(() => window.__banai.store.getState().design);
    const proposal = makeFakeProposal(design, revision);
    await mockChatProposal(page, { reply: 'Widen the wardrobe to 240 cm', proposal });
    await page.getByTestId('chat-input').fill('Make it wider');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-card')).toBeVisible();
    await expect(page.getByTestId('proposal-confirm')).toBeVisible();
    await expect(page.getByTestId('proposal-cancel')).toBeVisible();
  });

  test('confirming a proposal commits the new design and removes the card', async ({ page }) => {
    const { revision, design } = await storeState(page);
    const proposal = makeFakeProposal(design, revision);
    const newDesign = { ...design, dimensions: { ...design.dimensions, width: 2400 } };
    await mockChatProposal(page, { reply: proposal.summary, proposal });
    await mockApplySuccess(page, newDesign, revision + 1);
    await page.getByTestId('chat-input').fill('Wider please');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-confirm')).toBeVisible();
    await page.getByTestId('proposal-confirm').click();
    await expect(page.getByTestId('proposal-card')).not.toBeVisible();
    await expect.poll(() => storeState(page).then((s) => s.revision)).toBe(revision + 1);
  });

  test('cancelling a proposal removes the card without changing the design', async ({ page }) => {
    const { revision, design } = await storeState(page);
    const proposal = makeFakeProposal(design, revision);
    await mockChatProposal(page, { reply: proposal.summary, proposal });
    await page.getByTestId('chat-input').fill('Wider please');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-confirm')).toBeVisible();
    await page.getByTestId('proposal-cancel').click();
    await expect(page.getByTestId('proposal-card')).not.toBeVisible();
    expect((await storeState(page)).revision).toBe(revision);
    expect((await storeState(page)).design.dimensions.width).toBe(design.dimensions.width);
  });

  test('manual edit while proposal is pending shows stale warning and disables confirm', async ({ page }) => {
    const { revision, design } = await storeState(page);
    const proposal = makeFakeProposal(design, revision);
    await mockChatProposal(page, { reply: proposal.summary, proposal });
    await page.getByTestId('chat-input').fill('Wider please');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-confirm')).toBeEnabled();
    // Trigger a manual edit to bump revision
    await page.evaluate(() => window.__banai.store.dispatch([{ op: 'update_dimensions', width: 1800, height: null, depth: null }]));
    await expect(page.getByTestId('proposal-stale')).toBeVisible();
    await expect(page.getByTestId('proposal-confirm')).toBeDisabled();
  });

  test('stale 409 from server shows stale warning', async ({ page }) => {
    const { revision, design } = await storeState(page);
    const proposal = makeFakeProposal(design, revision);
    await mockChatProposal(page, { reply: proposal.summary, proposal });
    await mockApplyStale(page);
    await page.getByTestId('chat-input').fill('Wider please');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-confirm')).toBeVisible();
    await page.getByTestId('proposal-confirm').click();
    await expect(page.getByTestId('proposal-stale')).toBeVisible();
    await expect(page.getByTestId('proposal-confirm')).toBeDisabled();
  });

  test('no commit to design before confirm', async ({ page }) => {
    const { revision, design } = await storeState(page);
    const proposal = makeFakeProposal(design, revision);
    await mockChatProposal(page, { reply: proposal.summary, proposal });
    await page.getByTestId('chat-input').fill('Wider please');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-confirm')).toBeVisible();
    // Design must not have changed yet
    expect((await storeState(page)).design.dimensions.width).toBe(design.dimensions.width);
    expect((await storeState(page)).revision).toBe(revision);
  });
});
