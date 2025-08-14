document.addEventListener('DOMContentLoaded', () => {
  const chatWindow = document.getElementById('chat-window');
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const faqButtons = document.querySelectorAll('.faq-btn');
  const chatContainer = document.querySelector('.chatbot-container');
  const toggleBtn = document.getElementById('chat-toggle');
  const quickQuestions = document.querySelector('.quick-questions');
  const chatInputContainer = document.querySelector('.chat-input-container');
  let conversationHistory = [];

  const appendMessage = (sender, text) => {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender === 'user' ? 'user-message' : 'assistant-message');
    messageDiv.innerText = text;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    if (sender === 'assistant') {
      // Move input back down after AI responds
      chatInputContainer.style.transform = 'translateY(180px)';
      // Hide quick questions
      quickQuestions.classList.add('hidden');
    }
  };

  const sendMessage = async (message) => {
    if (!message.trim()) return;

    appendMessage('user', message);
    conversationHistory.push({ role: 'user', content: message });
    userInput.value = '';

    try {
      const response = await fetch('http://127.0.0.1:5000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: message, history: conversationHistory }),
      });

      if (!response.ok) throw new Error('Network error');

      const data = await response.json();
      const assistantResponse = data.response;
      appendMessage('assistant', assistantResponse);
      conversationHistory.push({ role: 'assistant', content: assistantResponse });
    } catch (error) {
      console.error('Error:', error);
      appendMessage('assistant', '⚠️ Sorry, I cannot connect to the server right now.');
    }
  };

  // Send message on click
  sendButton.addEventListener('click', () => sendMessage(userInput.value));

  // Send message on Enter
  userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage(userInput.value);
  });

  // Move input up on focus and show quick questions
  userInput.addEventListener('focus', () => {
    quickQuestions.classList.remove('hidden');
    chatInputContainer.style.transform = 'translateY(-10px)'; // adjust height as needed
  });

  // Quick question click sends message
  faqButtons.forEach(button => {
    button.addEventListener('click', () => sendMessage(button.innerText));
  });

  // Toggle chatbot visibility
  toggleBtn.addEventListener('click', () => {
    chatContainer.classList.toggle('hidden');
  });
});
