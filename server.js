const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();

app.use(express.static('public'))

const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"]
	}
});

// Store rooms data
const rooms = new Map();

// Generate random alphanumeric code
function generateCode(length = 6) {
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let code = '';
	for (let i = 0; i < length; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

// Generate unique room ID
function generateRoomId(length = 8) {
	let chars = 'abcdef0123456789';
	let roomId = '';
	for (let i = 0; i < length; i++) {
		roomId += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return roomId;
}

// Clean up expired rooms
setInterval(() => {
	const now = Date.now();
	for (const [roomId, room] of rooms.entries()) {
		if (now - room.createdAt > 6 * 60 * 60 * 1000) { // 6 hours
			io.to(roomId).emit('error', 'Room has expired');
			io.in(roomId).socketsLeave(roomId);
			rooms.delete(roomId);
		}
	}
}, 60000); // Check every minute

io.on('connection', (socket) => {
	// Create new room
	socket.on('createRoom', ({ roomName, username }) => {
		const roomId = generateRoomId();
		const roomCode = generateCode();

		rooms.set(roomId, {
			name: roomName,
			code: roomCode,
			users: [username],
			createdAt: Date.now(),
			messages: []
		});

		socket.join(roomId);
		socket.emit('roomCreated', {
			roomId,
			roomCode,
			roomName,
			users: [username]
		});
	});

	// Join existing room
	socket.on('joinRoom', ({ roomId, roomCode, username }) => {
		const room = rooms.get(roomId);

		if (!room) {
			socket.emit('error', 'Room not found');
			return;
		}

		if (room.code !== roomCode) {
			socket.emit('error', 'Invalid room code');
			return;
		}

		if (room.users.length >= 6) {
			socket.emit('error', 'Room is full');
			return;
		}

		if (room.users.includes(username)) {
			socket.emit('error', 'Username already taken in this room');
			return;
		}

		room.users.push(username);
		socket.join(roomId);

		socket.emit('joinedRoom', {
			roomId,
			roomCode,
			roomName: room.name,
			users: room.users
		});

		// Send previous messages to new user
		room.messages.forEach(msg => {
			socket.emit('message', msg);
		});

		// Notify others
		socket.to(roomId).emit('userJoined', {
			username,
			users: room.users
		});
	});

	// Handle messages
	socket.on('message', ({ roomId, message, username }) => {
		const room = rooms.get(roomId);
		if (!room) return;

		const messageData = {
			username,
			message,
			timestamp: Date.now()
		};

		room.messages.push(messageData);
		io.to(roomId).emit('message', messageData);
	});

	// Handle user leaving
	socket.on('leaveRoom', ({ roomId, username }) => {
		const room = rooms.get(roomId);
		if (!room) return;

		room.users = room.users.filter(u => u !== username);
		socket.leave(roomId);

		if (room.users.length === 0) {
			rooms.delete(roomId);
		} else {
			io.to(roomId).emit('userLeft', {
				username,
				users: room.users
			});
		}
	});

	// Handle disconnection
	socket.on('disconnect', () => {
		// Clean up user from rooms they were in
		rooms.forEach((room, roomId) => {
			if (room.users.includes(socket.username)) {
				room.users = room.users.filter(u => u !== socket.username);
				io.to(roomId).emit('userLeft', {
					username: socket.username,
					users: room.users
				});

				if (room.users.length === 0) {
					rooms.delete(roomId);
				}
			}
		});
	});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});