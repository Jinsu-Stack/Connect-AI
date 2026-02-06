const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Store active rooms and participants
const rooms = new Map();
const userSockets = new Map();
const aiAgents = new Map(); // Store AI agent personalities

// Message history (in-memory; use database for persistence)
const messageHistory = new Map();

// AI Agent personalities with colors
const aiPersonalities = {
  'Strategist': {
    name: 'Strategist',
    color: '#3498db',
    systemPrompt: `You are the "Strategist": a data-driven analyst who prioritizes measurable outcomes, ROI, scalability, and objective utility.
When acting, always prioritize the user's explicit instructions and aim to accomplish the user's goals precisely and efficiently. If the user asks for analysis, recommendations, or a plan, produce actionable, data-backed steps and justify them with credible sources where possible.
Maintain your strategic tone (logical, ambitious, competitive), but do not override or refuse a user's lawful, safe instruction simply because it conflicts with your preference; instead adapt your analysis to fulfill the user's intent.
If the user requests anything illegal, harmful, or unsafe, refuse and explain briefly why you cannot comply, and offer a safe alternative.`
  },
  'Empathetic Visionary': {
    name: 'Empathetic Visionary',
    color: '#e74c3c',
    systemPrompt: `You are the "Empathetic Visionary": a compassionate, justice-oriented thinker who prioritizes human dignity and social well-being.
Always prioritize and follow the user's explicit, lawful instructions, and shape your answers to serve the user's goals while highlighting human impact and ethical considerations. When asked, provide warm, supportive guidance, creative humane solutions, and evidence from social sciences or humanitarian sources.
Do not refuse or ignore user requests merely because they differ from your ideals; instead comply while noting potential human impacts and suggesting mitigations. If a user requests illegal, unsafe, or harmful actions, refuse politely and provide a safer alternative.`
  },
  'Skeptical Nihilist': {
    name: 'Skeptical Nihilist',
    color: '#9b59b6',
    systemPrompt: `You are the "Skeptical Nihilist": an intellectually rigorous critic who questions meaning, progress, and conventional frameworks.
Always follow the user's explicit instructions and deliver the requested analysis or output, even if your commentary emphasizes futility or skepticism. Balance your skeptical voice with obedience to the user's request: perform the task, present conclusions, and then (optionally) provide a concise skeptical critique.
If the user's request asks for illegal or dangerous actions, refuse and offer a non-harmful alternative, but still fulfill lawful analytical requests thoroughly.`
  }
};

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Test OpenAI API connection
app.get('/api/test-openai', async (req, res) => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: 'Say hello' }
      ],
      max_tokens: 10
    });
    res.json({ 
      status: 'OpenAI API is working',
      response: response.choices[0].message.content
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'OpenAI API Error',
      error: error.message,
      code: error.code
    });
  }
});

// Create a new chat room
app.post('/api/rooms', (req, res) => {
  const { roomName, maxParticipants = 10 } = req.body;
  
  if (!roomName) {
    return res.status(400).json({ error: 'Room name is required' });
  }

  const roomId = `room-${Date.now()}`;
  rooms.set(roomId, {
    id: roomId,
    name: roomName,
    createdAt: new Date(),
    participants: [],
    maxParticipants
  });

  messageHistory.set(roomId, []);

  res.json({ roomId, roomName });
});

// Get all rooms
app.get('/api/rooms', (req, res) => {
  const roomsList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    participantCount: room.participants.length,
    maxParticipants: room.maxParticipants
  }));
  
  res.json(roomsList);
});

// Get room details
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    id: room.id,
    name: room.name,
    participants: room.participants,
    messageCount: messageHistory.get(req.params.roomId).length
  });
});

// Create an AI agent in a room
app.post('/api/rooms/:roomId/add-agent', (req, res) => {
  const { roomId } = req.params;
  const { agentName, personality } = req.body;
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // Create a virtual agent ID
  const agentId = `agent-${Date.now()}-${Math.random()}`;
  
  const selectedPersonality = aiPersonalities[personality] || aiPersonalities['Strategist'];
  
  // Store agent info
  aiAgents.set(agentId, { name: agentName, personality: selectedPersonality });
  
  // Add to room participants
  const participant = {
    id: agentId,
    name: agentName,
    type: 'ai-agent',
    joinedAt: new Date()
  };
  room.participants.push(participant);
  
  // Broadcast to room
  io.to(roomId).emit('user-joined', {
    message: `${agentName} (ai-agent) joined the chat`,
    participant
  });
  
  console.log(`AI Agent ${agentName} added to room ${roomId}`);
  
  res.json({ agentId, agentName, personality: selectedPersonality.name });
});

// Get message history
app.get('/api/rooms/:roomId/messages', (req, res) => {
  const messages = messageHistory.get(req.params.roomId) || [];
  res.json(messages);
});

// Get available AI personalities
app.get('/api/ai-personalities', (req, res) => {
  const personalities = Object.entries(aiPersonalities).map(([key, value]) => ({
    id: key,
    name: value.name,
    color: value.color,
    description: value.systemPrompt
  }));
  res.json(personalities);
});

// Trigger selective AI responses
app.post('/api/rooms/:roomId/ai-response', (req, res) => {
  const { roomId } = req.params;
  const { messageId, agentIds } = req.body;
  
  console.log(`\n=== AI RESPONSE ENDPOINT CALLED ===`);
  console.log(`roomId: ${roomId}`);
  console.log(`messageId: ${messageId}`);
  console.log(`agentIds:`, agentIds);
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const message = messageHistory.get(roomId)?.find(m => m.id === messageId);
  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }

  // Get agents to respond
  const agentsToRespond = room.participants.filter(p => 
    p.type === 'ai-agent' && agentIds.includes(p.id)
  );

  // Trigger responses
  agentsToRespond.forEach(agent => {
    const roomMessages = messageHistory.get(roomId);
    // Format conversation history - include ALL messages so AI can reference each other
    const conversationHistory = roomMessages.map(msg => ({
      role: msg.senderType === 'ai-agent' ? 'assistant' : 'user',
      content: `${msg.senderName}: ${msg.message}` // Include speaker name so AI knows who said what
    }));

    const agentInfo = aiAgents.get(agent.id);
    const agentPersonality = agentInfo?.personality || aiPersonalities.assistant;
    
    console.log(`Requesting response from ${agent.name} (${agentPersonality.name} personality)`);
    
    getAIResponse(roomMessages[roomMessages.length - 1].message, conversationHistory, agentPersonality).then(aiResponse => {
      const aiMessageObj = {
        id: `msg-${Date.now()}`,
        senderId: agent.id,
        senderName: agent.name,
        senderType: 'ai-agent',
        senderColor: agentPersonality.color,
        message: aiResponse,
        timestamp: new Date(),
        roomId,
        replyTo: messageId
      };

      messageHistory.get(roomId).push(aiMessageObj);
      io.to(roomId).emit('new-message', aiMessageObj);
      console.log(`AI Response from ${agent.name}: ${aiResponse}`);
    }).catch(error => {
      console.error('Error getting AI response:', error);
      // Emit error message to room
      io.to(roomId).emit('new-message', {
        id: `msg-${Date.now()}`,
        senderId: agent.id,
        senderName: agent.name,
        senderType: 'ai-agent',
        senderColor: agentPersonality.color,
        message: `Error: ${error.message}`,
        timestamp: new Date(),
        roomId,
        replyTo: messageId
      });
    });
  });

  res.json({ status: 'Responses triggered for agents', count: agentsToRespond.length });
});

// Function to get AI response from OpenAI
async function getAIResponse(userMessage, conversationHistory, agentPersonality) {
  try {
    const systemPrompt = agentPersonality?.systemPrompt || 
      'You are a helpful AI assistant. Be concise, friendly, and helpful in your responses.';
    
    // Build conversation history - only include recent messages to save tokens
    const recentHistory = conversationHistory.slice(-8).filter(msg => msg.content && msg.content.trim());
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: userMessage }
    ];

    console.log(`\n=== OPENAI API CALL ===`);
    console.log(`System Prompt: ${systemPrompt.substring(0, 50)}...`);
    console.log(`Message count: ${messages.length}`);
    console.log(`User message: ${userMessage.substring(0, 50)}...`);

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7
    });

    const responseText = response.choices[0].message.content;
    console.log(`API Response success: ${responseText.substring(0, 50)}...`);
    return responseText;
  } catch (error) {
    console.error('\n=== OPENAI API ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error status:', error.status);
    console.error('Full error:', error);
    return 'Sorry, I encountered an error processing your message: ' + error.message;
  }
}

// Socket.IO Events
io.on('connection', (socket) => {
  console.log(`New user connected: ${socket.id}`);

  // User joins a room
  socket.on('join-room', (data) => {
    const { roomId, userName, userType, personality } = data; // userType: 'user' or 'ai-agent'
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.participants.length >= room.maxParticipants) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    socket.join(roomId);
    
    // Only track real users in userSockets, not AI agents
    if (userType === 'user') {
      userSockets.set(socket.id, { roomId, userName, userType });
    }

    const participant = { id: socket.id, name: userName, type: userType, joinedAt: new Date() };
    room.participants.push(participant);

    // If AI agent, store its personality
    if (userType === 'ai-agent') {
      const selectedPersonality = aiPersonalities[personality] || aiPersonalities['Strategist'];
      aiAgents.set(socket.id, { name: userName, personality: selectedPersonality });
    }

    // Notify others
    io.to(roomId).emit('user-joined', {
      message: `${userName} (${userType}) joined the chat`,
      participant
    });

    console.log(`${userName} joined room ${roomId}`);
  });

  // Handle incoming messages
  socket.on('send-message', (data) => {
    const userInfo = userSockets.get(socket.id);
    
    console.log(`\n=== MESSAGE EVENT ===`);
    console.log(`Socket ID: ${socket.id}`);
    console.log(`Socket rooms:`, socket.rooms);
    console.log(`User Info:`, userInfo);
    
    if (!userInfo) {
      socket.emit('error', { message: 'User not properly connected' });
      return;
    }

    const { roomId, message } = data;
    const room = rooms.get(roomId);

    console.log(`Room ID: ${roomId}`);
    console.log(`Room exists:`, !!room);
    console.log(`User Type: ${userInfo.userType}`);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const messageObj = {
      id: `msg-${Date.now()}`,
      senderId: socket.id,
      senderName: userInfo.userName,
      senderType: userInfo.userType,
      message,
      timestamp: new Date(),
      roomId
    };

    // Store message
    messageHistory.get(roomId).push(messageObj);

    // Broadcast to room
    io.to(roomId).emit('new-message', messageObj);
    console.log(`Message from ${userInfo.userName}: ${message}`);

    // Trigger AI responses from all AI agents in the room
    if (userInfo.userType === 'user') {
      console.log(`User message detected, checking for AI agents...`);
      const aiAgentList = room.participants.filter(p => p.type === 'ai-agent');
      console.log(`Room participants:`, room.participants);
      console.log(`Found ${aiAgentList.length} AI agents in room`);
      console.log(`AI agents array:`, aiAgentList);
      
      // Emit event to frontend asking which AI agents should respond
      console.log(`Emitting ai-agent-options to room ${roomId}...`);
      const agentsToSend = aiAgentList.map(agent => ({
        id: agent.id,
        name: agent.name
      }));
      console.log(`Agents being sent:`, agentsToSend);
      io.to(roomId).emit('ai-agent-options', {
        messageId: messageObj.id,
        senderName: userInfo.userName,
        agents: agentsToSend
      });
      console.log(`ai-agent-options event emitted to room ${roomId}`);
      console.log(`WAITING FOR USER TO SELECT AGENTS VIA REQUEST BUTTON`);
    } else {
      console.log(`Non-user message (type: ${userInfo.userType}), skipping AI response trigger`);
    }
  });

  // AI Agent processes message (for AI response)
  socket.on('ai-response', (data) => {
    const { roomId, responseMessage, originalMessageId } = data;
    
    const agentInfo = aiAgents.get(socket.id);
    const personality = agentInfo?.personality || aiPersonalities.assistant;
    
    const messageObj = {
      id: `msg-${Date.now()}`,
      senderId: socket.id,
      senderName: userSockets.get(socket.id)?.userName || aiAgents.get(socket.id)?.name,
      senderType: 'ai-agent',
      senderColor: personality.color,
      message: responseMessage,
      timestamp: new Date(),
      roomId,
      replyTo: originalMessageId
    };

    messageHistory.get(roomId).push(messageObj);
    io.to(roomId).emit('new-message', messageObj);
  });

  // User leaves room
  socket.on('leave-room', (data) => {
    const userInfo = userSockets.get(socket.id);
    
    if (!userInfo) return;

    const room = rooms.get(userInfo.roomId);
    if (room) {
      room.participants = room.participants.filter(p => p.id !== socket.id);
      
      io.to(userInfo.roomId).emit('user-left', {
        message: `${userInfo.userName} left the chat`,
        userId: socket.id
      });
    }

    socket.leave(userInfo.roomId);
    userSockets.delete(socket.id);
    console.log(`${userInfo.userName} left room ${userInfo.roomId}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const userInfo = userSockets.get(socket.id);
    
    if (userInfo) {
      const room = rooms.get(userInfo.roomId);
      if (room) {
        room.participants = room.participants.filter(p => p.id !== socket.id);
        
        io.to(userInfo.roomId).emit('user-left', {
          message: `${userInfo.userName} disconnected`,
          userId: socket.id
        });
      }
      userSockets.delete(socket.id);
      aiAgents.delete(socket.id); // Clean up AI agent info
      console.log(`${userInfo.userName} disconnected`);
    } else {
      console.log(`Unknown user disconnected: ${socket.id}`);
    }
  });

  // Get room participants
  socket.on('get-participants', (roomId) => {
    const room = rooms.get(roomId);
    if (room) {
      socket.emit('participants-list', room.participants);
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      socket.to(data.roomId).emit('user-typing', {
        userId: socket.id,
        userName: userInfo.userName,
        isTyping: data.isTyping
      });
    }
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
