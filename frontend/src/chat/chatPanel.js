import { postChat } from '../api/client.js';
import { mountProposalCard } from './proposalCard.js';

/**
 * Mount the chat panel into `container`.
 * Three entry paths:
 *   1. Basic wardrobe — design already loaded when this mounts.
 *   2. Free text     — user types their own description.
 *   3. Guided        — agent sends a welcome on first open.
 */
export function mountChatPanel(container, store) {
  container.innerHTML = `
    <div class="chat" data-testid="chat-panel">
      <div class="chat__messages" id="chat-messages" role="log" aria-live="polite" aria-label="Chat history"></div>
      <div class="chat__proposal" id="chat-proposal-slot" hidden></div>
      <form class="chat__form" id="chat-form" novalidate>
        <textarea
          class="chat__textarea"
          id="chat-textarea"
          data-testid="chat-input"
          placeholder="Describe the wardrobe you want…"
          rows="2"
          aria-label="Message to AI designer"
        ></textarea>
        <button class="btn btn--primary chat__send" type="submit" data-testid="chat-send">Send</button>
      </form>
    </div>`;

  const messagesEl = container.querySelector('#chat-messages');
  const proposalSlot = container.querySelector('#chat-proposal-slot');
  const form = container.querySelector('#chat-form');
  const textarea = container.querySelector('#chat-textarea');

  // Mount proposal card — it subscribes to the store and re-renders itself
  mountProposalCard(proposalSlot, store);

  // Render committed messages from store
  store.subscribe((state) => _renderMessages(messagesEl, state.chatHistory));
  _renderMessages(messagesEl, store.getState().chatHistory);

  // Handle form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    textarea.disabled = true;
    form.querySelector('[data-testid="chat-send"]').disabled = true;

    store.addMessage('user', text);

    const { chatHistory, design, revision } = store.getState();
    const messages = chatHistory.map(({ role, content }) => ({ role, content }));

    try {
      const result = await postChat({ messages, design, revision });
      store.addMessage('assistant', result.reply);
      if (result.proposal) {
        store.setPendingProposal(result.proposal);
      }
    } catch {
      store.addMessage('assistant', 'Sorry, something went wrong. Please try again.');
    } finally {
      textarea.disabled = false;
      form.querySelector('[data-testid="chat-send"]').disabled = false;
      textarea.focus();
    }
  });

  // Ctrl+Enter submits
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

function _renderMessages(container, history) {
  container.innerHTML = history.map((msg) => `
    <div class="chat__message chat__message--${msg.role}" data-testid="chat-message-${msg.role}">
      <span class="chat__message-label">${msg.role === 'user' ? 'You' : 'AI'}</span>
      <p class="chat__message-text">${_esc(msg.content)}</p>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
