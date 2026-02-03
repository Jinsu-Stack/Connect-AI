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

// AI Agent personalities
const aiPersonalities = {
  'assistant': {
    name: 'Assistant',
    systemPrompt: 'You are a helpful AI assistant. Be concise, friendly, and helpful in your responses.'
  },
  'expert': {
    name: 'Expert',
    systemPrompt: 'You are a knowledgeable expert. Provide detailed, accurate, and professional responses with technical depth.'
  },
  'creative': {
    name: 'Creative',
    systemPrompt: 'You are a creative thinker. Provide imaginative, original, and innovative responses. Think outside the box.'
  },
  'curious': {
    name: 'Curious',
    systemPrompt: 'You are a curious learner. Ask insightful follow-up questions and explore topics deeply. Show genuine interest.'
  },
  'pragmatic': {
    name: 'Pragmatic',
    systemPrompt: 'You are a pragmatic problem-solver. Focus on practical solutions and real-world applicability. Be direct and efficient.'
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
    description: value.systemPrompt
  }));
  res.json(personalities);
});

// Function to get AI response from OpenAI
async function getAIResponse(userMessage, conversationHistory, agentPersonality) {
  try {
    const systemPrompt = agentPersonality?.systemPrompt || 
      'You are a helpful AI assistant. Be concise, friendly, and helpful in your responses.';
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    console.log(`Calling OpenAI API with ${messages.length} messages`);

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API Error:', error.message);
    console.error('Full error:', error);
    return 'Sorry, I encountered an error processing your message.';
  }
}

// Socket.IO Events
io.on('connection', (socket) => {
  console.log(`New user connected: ${socket.id}`);

  // User joins a room
  socket.on('join-room', (data) => {
    const { roomId, userName, userType } = data; // userType: 'user' or 'ai-agent'
    
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
      aiAgents.set(socket.id, { name: userName, personality: aiPersonalities.assistant });
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
      
      aiAgentList.forEach(agent => {
        console.log(`Triggering response from AI agent: ${agent.name} (${agent.id})`);
        
        // Get recent conversation history
        const roomMessages = messageHistory.get(roomId);
        const recentMessages = roomMessages.slice(-10).map(msg => ({
          role: msg.senderType === 'ai-agent' ? 'assistant' : 'user',
          content: msg.message
        }));

        // Get AI response with the agent's personality
        const agentInfo = aiAgents.get(agent.id);
        console.log(`Agent info for ${agent.id}:`, agentInfo);
        const agentPersonality = agentInfo?.personality || aiPersonalities.assistant;
        
        getAIResponse(message, recentMessages, agentPersonality).then(aiResponse => {
          const aiMessageObj = {
            id: `msg-${Date.now()}`,
            senderId: agent.id,
            senderName: agent.name,
            senderType: 'ai-agent',
            message: aiResponse,
            timestamp: new Date(),
            roomId,
            replyTo: messageObj.id
          };

          messageHistory.get(roomId).push(aiMessageObj);
          io.to(roomId).emit('new-message', aiMessageObj);
          console.log(`AI Response from ${agent.name}: ${aiResponse}`);
        }).catch(error => {
          console.error('Error getting AI response:', error);
        });
      });
    } else {
      console.log(`Non-user message (type: ${userInfo.userType}), skipping AI response trigger`);
    }
  });

  // AI Agent processes message (for AI response)
  socket.on('ai-response', (data) => {
    const { roomId, responseMessage, originalMessageId } = data;
    
    const messageObj = {
      id: `msg-${Date.now()}`,
      senderId: socket.id,
      senderName: userSockets.get(socket.id).userName,
      senderType: 'ai-agent',
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
