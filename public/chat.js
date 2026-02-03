// Socket.IO connection
const socket = io();
let currentRoom = null;
let userName = 'You';
const addedAgents = []; // Track added AI agents

// Socket connection events
socket.on('connect', () => {
    console.log('Connected to server');
    updateStatus('Connected', true);
    loadRooms();
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateStatus('Disconnected', false);
});

socket.on('error', (error) => {
    console.error('Socket error:', error.message);
    showSystemMessage(`Error: ${error.message}`);
});

// Message events
socket.on('new-message', (message) => {
    displayMessage(message);
});

socket.on('ai-agent-options', (data) => {
    console.log('Received ai-agent-options:', data);
    showAIAgentOptions(data);
});

socket.on('user-joined', (data) => {
    showSystemMessage(data.message);
    updateParticipantCount();
});

socket.on('user-left', (data) => {
    showSystemMessage(data.message);
    updateParticipantCount();
});

socket.on('user-typing', (data) => {
    // You can implement typing indicator here
});

socket.on('participants-list', (participants) => {
    console.log('Participants:', participants);
    updateParticipantCount();
});

// Update status indicator
function updateStatus(text, isConnected) {
    const status = document.getElementById('status');
    status.textContent = text;
    status.className = 'status ' + (isConnected ? 'connected' : 'disconnected');
}

// Load and display rooms
async function loadRooms() {
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();
        
        const roomsList = document.getElementById('roomsList');
        roomsList.innerHTML = '';
        
        if (rooms.length === 0) {
            roomsList.innerHTML = '<p style="color: #999; font-size: 12px;">No rooms yet. Create one!</p>';
            return;
        }

        rooms.forEach(room => {
            const roomEl = document.createElement('div');
            roomEl.className = 'room-item' + (currentRoom === room.id ? ' active' : '');
            roomEl.innerHTML = `<strong>${room.name}</strong><br><small>${room.participantCount}/${room.maxParticipants}</small>`;
            roomEl.onclick = () => joinRoom(room.id);
            roomsList.appendChild(roomEl);
        });
    } catch (error) {
        console.error('Error loading rooms:', error);
    }
}

// Create a new room
async function createRoom() {
    const roomName = document.getElementById('roomNameInput').value.trim();
    const maxParticipants = parseInt(document.getElementById('maxParticipants').value) || 10;

    if (!roomName) {
        alert('Please enter a room name');
        return;
    }

    try {
        const response = await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomName, maxParticipants })
        });

        if (!response.ok) throw new Error('Failed to create room');

        const data = await response.json();
        document.getElementById('roomNameInput').value = '';
        
        loadRooms();
        setTimeout(() => joinRoom(data.roomId), 500);
    } catch (error) {
        alert('Error creating room: ' + error.message);
    }
}

// Join a room
function joinRoom(roomId) {
    if (currentRoom) {
        socket.emit('leave-room', { roomId: currentRoom });
    }

    userName = document.getElementById('userNameInput').value.trim() || 'You';
    currentRoom = roomId;

    socket.emit('join-room', {
        roomId: roomId,
        userName: userName,
        userType: 'user'
    });

    // Clear messages and load history
    document.getElementById('messagesContainer').innerHTML = '';
    document.getElementById('inputArea').style.display = 'block';
    
    loadRoomMessages();
    updateRoomTitle();
    updateParticipantCount();
    loadRooms();

    console.log(`Joined room ${roomId} as ${userName}`);
}

// Load room messages
async function loadRoomMessages() {
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/messages`);
        const messages = await response.json();
        
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        
        messages.forEach(msg => displayMessage(msg));
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

// Update room title
async function updateRoomTitle() {
    try {
        const response = await fetch(`/api/rooms/${currentRoom}`);
        const room = await response.json();
        document.getElementById('roomTitle').textContent = room.name;
    } catch (error) {
        console.error('Error updating room title:', error);
    }
}

// Update participant count
function updateParticipantCount() {
    socket.emit('get-participants', currentRoom);
}

// Send message
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message || !currentRoom) {
        return;
    }

    socket.emit('send-message', {
        roomId: currentRoom,
        message: message
    });

    input.value = '';
    input.focus();
}

// Add AI agent to room
async function addAIAgent() {
    if (!currentRoom) {
        alert('Please join or create a room first');
        return;
    }

    const agentName = document.getElementById('aiNameInput').value.trim() || 'Assistant';
    const personality = document.getElementById('aiPersonalitySelect').value || 'assistant';
    
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/add-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentName, personality })
        });
        
        if (!response.ok) throw new Error('Failed to add agent');
        
        const data = await response.json();
        addedAgents.push({ name: agentName, personality: personality, id: data.agentId });
        updateAIAgentsList();
        
        document.getElementById('aiNameInput').value = 'Assistant';
        console.log(`AI Agent "${agentName}" (${personality}) added to room`);
    } catch (error) {
        alert('Error adding AI agent: ' + error.message);
    }
}

// Update the list of added AI agents
function updateAIAgentsList() {
    const agentsList = document.getElementById('aiAgentsList');
    if (addedAgents.length === 0) {
        agentsList.innerHTML = '';
        return;
    }
    
    agentsList.innerHTML = '<strong>Added Agents:</strong><br>' + 
        addedAgents.map((agent, i) => 
            `${i + 1}. ${agent.name} (${agent.personality})`
        ).join('<br>');
}

// Display message
function displayMessage(message) {
    const container = document.getElementById('messagesContainer');
    const messageEl = document.createElement('div');
    
    const isUser = message.senderType === 'user';
    const isAI = message.senderType === 'ai-agent';
    
    messageEl.className = 'message ' + (isUser ? 'user' : isAI ? 'ai' : 'system');
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    let content = `<div class="message-sender">${message.senderName} <small>${timestamp}</small></div>
            <div>${escapeHtml(message.message)}</div>`;
    
    messageEl.innerHTML = `<div class="message-content" ${isAI && message.senderColor ? `style="border-left: 4px solid ${message.senderColor};"` : ''}>${content}</div>`;
    
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

// Show system message
function showSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    const messageEl = document.createElement('div');
    messageEl.className = 'message system';
    messageEl.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show AI agent selection options
function showAIAgentOptions(data) {
    console.log('=== showAIAgentOptions CALLED ===');
    console.log('Data received:', data);
    
    const prompt = document.getElementById('aiResponsePrompt');
    const checkboxes = document.getElementById('aiAgentCheckboxes');
    const inputArea = document.getElementById('inputArea');
    
    console.log('DOM Elements:', {
        prompt: prompt ? 'FOUND' : 'NOT FOUND',
        checkboxes: checkboxes ? 'FOUND' : 'NOT FOUND',
        inputArea: inputArea ? 'FOUND' : 'NOT FOUND'
    });
    
    if (!prompt || !checkboxes || !inputArea) {
        console.error('ERROR: One or more required DOM elements not found!');
        return;
    }
    
    checkboxes.innerHTML = '';
    console.log('Agents to display:', data.agents);
    
    data.agents.forEach(agent => {
        console.log('Creating checkbox for agent:', agent.name, agent.id);
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        label.style.padding = '8px 12px';
        label.style.background = '#fff';
        label.style.borderRadius = '6px';
        label.style.cursor = 'pointer';
        label.style.border = '2px solid #ddd';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = agent.id;
        checkbox.className = 'ai-agent-checkbox';
        checkbox.checked = true;
        
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(agent.name));
        checkboxes.appendChild(label);
    });
    
    console.log('Checkboxes created, now showing prompt...');
    
    // Show the prompt
    prompt.style.display = 'block';
    console.log('Prompt display set to:', prompt.style.display);
    
    // Show input area too
    inputArea.style.display = 'block';
    console.log('InputArea display set to:', inputArea.style.display);
    
    // Store current message ID for later use
    window.currentResponseMessageId = data.messageId;
    console.log('=== showAIAgentOptions COMPLETE ===');
}

// Request responses from selected AI agents
async function requestAIResponses() {
    if (!window.currentResponseMessageId || !currentRoom) return;
    
    const checkboxes = document.querySelectorAll('.ai-agent-checkbox:checked');
    const agentIds = Array.from(checkboxes).map(cb => cb.value);
    
    if (agentIds.length === 0) {
        alert('Please select at least one AI agent');
        return;
    }
    
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/ai-response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messageId: window.currentResponseMessageId,
                agentIds: agentIds
            })
        });
        
        if (response.ok) {
            // Keep the prompt visible so user can request responses again!
            document.getElementById('aiResponsePrompt').style.display = 'block';
            document.getElementById('inputArea').style.display = 'block';
        }
    } catch (error) {
        console.error('Error requesting AI responses:', error);
    }
}

// Continue asking more questions
function askMoreQuestions() {
    document.getElementById('aiResponsePrompt').style.display = 'none';
    document.getElementById('inputArea').style.display = 'block';
    document.getElementById('messageInput').value = '';
    document.getElementById('messageInput').focus();
    window.currentResponseMessageId = null;
}

// Handle Enter key in message input
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('messageInput');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
});
