# AI Group Chat Backend

A real-time group chat backend where you and multiple AI agents can chat together in one room using WebSocket communication with OpenAI API integration.
By Jinsu Jang and Choi Yoontae

## Features

- **Real-time Communication**: Using Socket.IO for instant message delivery
- **Multiple Rooms**: Create and manage multiple chat rooms
- **Mixed Participants**: Support for both human users and AI agents
- **AI Integration**: Automatic AI responses using OpenAI's GPT-3.5-turbo
- **Message History**: Store and retrieve chat messages
- **Typing Indicators**: See when others are typing
- **Room Management**: Create rooms, view participants, manage max capacity
- **Automatic Broadcasting**: Messages broadcast to all room participants
- **Modern Web UI**: Beautiful frontend interface included

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- OpenAI API Key (free trial available at https://platform.openai.com)

## Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- OpenAI API Key (free trial available at https://platform.openai.com)

### Get Your OpenAI API Key

1. Go to https://platform.openai.com/signup
2. Sign up for a free account (if you don't have one)
3. Navigate to https://platform.openai.com/api-keys
4. Click "Create new secret key"
5. Copy your API key and save it safely

### Installation

1. Navigate to the project directory:
```bash
cd c:\Users\boomb\Desktop\CAI
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your OpenAI API key:
```
OPENAI_API_KEY=sk-your-api-key-here
PORT=5000
```

4. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

5. Open your browser and go to `http://localhost:5000`

The server will run on `http://localhost:5000`

## How It Works

### One API Key, Multiple Agents
You only need **one OpenAI API key** for unlimited AI agents. Each API call is just a request to OpenAI's servers, and you can have as many agents as you want using the same key.

### AI Agent Personalities
Each AI agent can have a unique personality/style:
- **Assistant**: Helpful, concise, and friendly
- **Expert**: Knowledgeable and technical  
- **Creative**: Imaginative and innovative
- **Curious**: Inquisitive and exploratory
- **Pragmatic**: Direct and practical

### How to Use

1. **Create/Join a Room**: Create a new room or join an existing one
2. **Add AI Agents**: Add multiple AI agents with different personalities to the room
3. **Chat**: Type messages and all AI agents will automatically respond
4. **Each AI Responds**: When you send a message, all AI agents in the room will generate responses based on their personality

Example workflow:
```
1. Create room "Tech Discussion"
2. Join as "You"
3. Add AI Agent: "Expert" (expert personality)
4. Add AI Agent: "Creative" (creative personality)
5. Send message: "How can I improve my code?"
6. Both Expert and Creative will respond from different perspectives
```

## API Endpoints

### Health Check
```
GET /api/health
```
Returns server status.

### Rooms

**Create a new room**
```
POST /api/rooms
Body: {
  "roomName": "string",
  "maxParticipants": "number (optional, default: 10)"
}
Response: { "roomId": "string", "roomName": "string" }
```

**Get all rooms**
```
GET /api/rooms
Response: [
  {
    "id": "string",
    "name": "string",
    "participantCount": "number",
    "maxParticipants": "number"
  }
]
```

**Get room details**
```
GET /api/rooms/:roomId
Response: {
  "id": "string",
  "name": "string",
  "participants": "array",
  "messageCount": "number"
}
```

**Get message history**
```
GET /api/rooms/:roomId/messages
Response: [
  {
    "id": "string",
    "senderId": "string",
    "senderName": "string",
    "senderType": "user|ai-agent",
    "message": "string",
    "timestamp": "ISO string",
    "roomId": "string"
  }
]
```

**Get available AI personalities**
```
GET /api/ai-personalities
Response: [
  {
    "id": "assistant",
    "name": "Assistant",
    "description": "You are a helpful AI assistant. Be concise, friendly, and helpful in your responses."
  },
  ...
]
```

## Socket.IO Events

### Client → Server

**join-room**
```javascript
socket.emit('join-room', {
  roomId: 'string',
  userName: 'string',
  userType: 'user' or 'ai-agent'
});
```

**send-message**
```javascript
socket.emit('send-message', {
  roomId: 'string',
  message: 'string'
});
```

**ai-response** (for AI agents)
```javascript
socket.emit('ai-response', {
  roomId: 'string',
  responseMessage: 'string',
  originalMessageId: 'string (optional)'
});
```

**leave-room**
```javascript
socket.emit('leave-room', {
  roomId: 'string'
});
```

**typing**
```javascript
socket.emit('typing', {
  roomId: 'string',
  isTyping: true/false
});
```

**get-participants**
```javascript
socket.emit('get-participants', 'roomId');
```

### Server → Client

**user-joined**
```javascript
{
  message: 'string',
  participant: {
    id: 'string',
    name: 'string',
    type: 'user' or 'ai-agent',
    joinedAt: 'ISO string'
  }
}
```

**new-message**
```javascript
{
  id: 'string',
  senderId: 'string',
  senderName: 'string',
  senderType: 'user' or 'ai-agent',
  message: 'string',
  timestamp: 'ISO string',
  roomId: 'string',
  replyTo: 'string (optional)'
}
```

**user-left**
```javascript
{
  message: 'string',
  userId: 'string'
}
```

**user-typing**
```javascript
{
  userId: 'string',
  userName: 'string',
  isTyping: true/false
}
```

**participants-list**
```javascript
[
  {
    id: 'string',
    name: 'string',
    type: 'user' or 'ai-agent',
    joinedAt: 'ISO string'
  }
]
```

**error**
```javascript
{
  message: 'string'
}
```

## Example Client Implementation

### Using Socket.IO Client

```javascript
const io = require('socket.io-client');

const socket = io('http://localhost:5000');

// Join a room
socket.emit('join-room', {
  roomId: 'room-1234567890',
  userName: 'MyName',
  userType: 'user'
});

// Listen for new messages
socket.on('new-message', (message) => {
  console.log(`${message.senderName}: ${message.message}`);
});

// Send a message
socket.emit('send-message', {
  roomId: 'room-1234567890',
  message: 'Hello everyone!'
});

// Listen for user joining
socket.on('user-joined', (data) => {
  console.log(data.message);
});

// Listen for user leaving
socket.on('user-left', (data) => {
  console.log(data.message);
});

// Send typing indicator
socket.emit('typing', {
  roomId: 'room-1234567890',
  isTyping: true
});

socket.on('user-typing', (data) => {
  console.log(`${data.userName} is typing...`);
});

// Leave room
socket.emit('leave-room', {
  roomId: 'room-1234567890'
});
```

## Architecture

- **Express.js**: HTTP server and REST API
- **Socket.IO**: Real-time bidirectional communication
- **CORS**: Cross-origin resource sharing
- **In-memory Storage**: Rooms, participants, and messages (can be replaced with database)

## Future Enhancements

- Database integration (MongoDB, PostgreSQL) for persistent storage
- User authentication and authorization
- Message encryption
- File sharing
- Video/audio call support
- Message reactions and thread replies
- Room permissions and moderation
- Integration with AI APIs (OpenAI, Hugging Face, etc.)

## Environment Variables

You can set these in a `.env` file:

```
PORT=5000
NODE_ENV=development
```

## License

MIT
