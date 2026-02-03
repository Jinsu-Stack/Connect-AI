const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Store active rooms and participants
const rooms = new Map();
const userSockets = new Map();

// Message history (in-memory; use database for persistence)
const messageHistory = new Map();

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
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
    userSockets.set(socket.id, { roomId, userName, userType });

    const participant = { id: socket.id, name: userName, type: userType, joinedAt: new Date() };
    room.participants.push(participant);

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
    
    if (!userInfo) {
      socket.emit('error', { message: 'User not properly connected' });
      return;
    }

    const { roomId, message } = data;
    const room = rooms.get(roomId);

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
