import { applyProposal } from '../api/client.js';

/**
 * Render (or update) a proposal card inside `container`.
 * Subscribes to the store so it detects staleness automatically.
 */
export function mountProposalCard(container, store) {
  let unsubscribe = null;

  function render() {
    const { pendingProposal, revision } = store.getState();

    if (!pendingProposal) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }

    const isStale = revision !== pendingProposal.baseRevision;
    container.hidden = false;
    container.innerHTML = `
      <div class="proposal-card" role="region" aria-label="AI proposal" data-testid="proposal-card">
        <p class="proposal-card__summary">${_esc(pendingProposal.summary)}</p>
        ${isStale ? '<p class="proposal-card__stale" data-testid="proposal-stale">Design changed — ask the agent to re-propose.</p>' : ''}
        <div class="proposal-card__actions">
          <button class="btn btn--primary" data-testid="proposal-confirm" ${isStale ? 'disabled' : ''}>Confirm</button>
          <button class="btn btn--ghost" data-testid="proposal-cancel">Cancel</button>
          <span class="proposal-card__status" aria-live="polite"></span>
        </div>
      </div>`;

    if (!isStale) {
      container.querySelector('[data-testid="proposal-confirm"]').addEventListener('click', async () => {
        await _confirm(container, store, pendingProposal);
      });
    }
    container.querySelector('[data-testid="proposal-cancel"]').addEventListener('click', () => {
      store.clearPendingProposal();
      store.addMessage('assistant', '_(Proposal cancelled)_');
    });
  }

  unsubscribe = store.subscribe(render);
  render();
  return () => unsubscribe?.();
}

async function _confirm(container, store, proposal) {
  const statusEl = container.querySelector('.proposal-card__status');
  const confirmBtn = container.querySelector('[data-testid="proposal-confirm"]');
  confirmBtn.disabled = true;
  statusEl.textContent = 'Applying…';

  const { design, revision } = store.getState();
  try {
    const result = await applyProposal({ design, revision, proposal });
    store.commitProposal(result.design, result.revision);
  } catch (err) {
    if (err.code === 'STALE' || err.status === 409) {
      statusEl.textContent = '';
      store.setPendingProposal({ ...proposal, _forceStale: true });
    } else {
      statusEl.textContent = 'Failed to apply. Please try again.';
      confirmBtn.disabled = false;
    }
  }
}

function _esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
