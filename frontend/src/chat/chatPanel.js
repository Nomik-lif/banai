import { fetchTTS, postChat, transcribeAudio } from '../api/client.js';
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
        <div class="chat__actions">
          <button
            class="btn btn--ghost chat__mic"
            type="button"
            id="chat-mic"
            data-testid="chat-mic"
            aria-label="Record voice message"
            title="Click to start recording"
          >🎤</button>
          <button class="btn btn--primary chat__send" type="submit" data-testid="chat-send">Send</button>
        </div>
      </form>
    </div>`;

  const messagesEl = container.querySelector('#chat-messages');
  const proposalSlot = container.querySelector('#chat-proposal-slot');
  const form = container.querySelector('#chat-form');
  const textarea = container.querySelector('#chat-textarea');
  const micBtn = container.querySelector('#chat-mic');

  mountProposalCard(proposalSlot, store);

  store.subscribe((state) => _renderMessages(messagesEl, state.chatHistory));
  _renderMessages(messagesEl, store.getState().chatHistory);

  async function _submitText(text) {
    _setDisabled(form, true);
    store.addMessage('user', text);

    const { chatHistory, design, revision } = store.getState();
    const messages = chatHistory.map(({ role, content }) => ({ role, content }));

    try {
      const result = await postChat({ messages, design, revision });
      store.addMessage('assistant', result.reply);
      if (result.proposal) store.setPendingProposal(result.proposal);
      _playTTS(result.reply);
    } catch {
      store.addMessage('assistant', 'Sorry, something went wrong. Please try again.');
    } finally {
      _setDisabled(form, false);
      textarea.focus();
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    await _submitText(text);
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // --- voice recording ---
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  micBtn.addEventListener('click', async () => {
    if (isRecording) {
      mediaRecorder?.stop();
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      store.addMessage('assistant', 'Microphone access was denied. Please allow it in your browser settings.');
      return;
    }

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    isRecording = true;
    micBtn.classList.add('chat__mic--recording');
    micBtn.setAttribute('aria-label', 'Stop recording');
    micBtn.title = 'Click to stop';

    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    });

    mediaRecorder.addEventListener('stop', async () => {
      isRecording = false;
      micBtn.classList.remove('chat__mic--recording');
      micBtn.setAttribute('aria-label', 'Record voice message');
      micBtn.title = 'Click to start recording';
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      audioChunks = [];

      micBtn.disabled = true;
      try {
        const { text } = await transcribeAudio(blob);
        if (text.trim()) await _submitText(text.trim());
      } catch {
        store.addMessage('assistant', 'Could not transcribe the recording. Please try again.');
      } finally {
        micBtn.disabled = false;
      }
    });

    mediaRecorder.start();
  });
}

// Play TTS for assistant replies — non-critical, errors are silently swallowed
async function _playTTS(text) {
  try {
    const blob = await fetchTTS(text);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    await audio.play();
  } catch {
    // TTS failure is non-critical
  }
}

function _setDisabled(form, disabled) {
  form.querySelector('[data-testid="chat-send"]').disabled = disabled;
  form.querySelector('[data-testid="chat-mic"]').disabled = disabled;
  form.querySelector('[data-testid="chat-input"]').disabled = disabled;
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
