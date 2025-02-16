const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"]
	}
});

const rooms = new Map();

// Utility functions
function generateCode(length = 6) {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function generateRoomId(length = 8) {
	const chars = 'abcdef0123456789';
	return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

// Clean up expired rooms every minute
setInterval(() => {
	const now = Date.now();
	for (const [roomId, room] of rooms.entries()) {
		// Expire rooms after 6 hours
		if (now - room.createdAt > 6 * 60 * 60 * 1000) {
			io.to(roomId).emit('roomExpired', 'Room has expired');
			io.in(roomId).socketsLeave(roomId);
			rooms.delete(roomId);
		}
	}
}, 60000);

io.on('connection', (socket) => {
	let currentRoom = null;
	let currentUsername = null;

	socket.on('createRoom', ({ roomName, username }) => {
		const roomId = generateRoomId();
		const roomCode = generateCode();

		rooms.set(roomId, {
			name: roomName,
			code: roomCode,
			users: [{ username, socketId: socket.id, isTyping: false }],
			createdAt: Date.now(),
			messages: []
		});

		currentRoom = roomId;
		currentUsername = username;

		socket.join(roomId);
		socket.emit('roomCreated', {
			roomId,
			roomCode,
			roomName,
			users: [username]
		});
	});

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
		if (room.users.some(user => user.username === username)) {
			socket.emit('error', 'Username already taken in this room');
			return;
		}

		currentRoom = roomId;
		currentUsername = username;

		room.users.push({ username, socketId: socket.id, isTyping: false });
		socket.join(roomId);

		socket.emit('joinedRoom', {
			roomId,
			roomCode,
			roomName: room.name,
			users: room.users.map(user => ({
				username: user.username,
				isTyping: user.isTyping
			}))
		});

		// Send message history
		room.messages.forEach(msg => {
			socket.emit('message', msg);
		});

		socket.to(roomId).emit('userJoined', {
			username,
			users: room.users.map(user => ({
				username: user.username,
				isTyping: user.isTyping
			}))
		});
	});

	socket.on('message', ({ roomId, message }) => {
		const room = rooms.get(roomId);
		if (!room) return;

		const messageData = {
			username: currentUsername,
			message,
			timestamp: Date.now()
		};

		room.messages.push(messageData);
		io.to(roomId).emit('message', messageData);

		// Reset typing status
		const user = room.users.find(u => u.socketId === socket.id);
		if (user) {
			user.isTyping = false;
			io.to(roomId).emit('userTyping', {
				username: currentUsername,
				isTyping: false
			});
		}
	});

	socket.on('typing', ({ roomId, isTyping }) => {
		const room = rooms.get(roomId);
		if (!room) return;

		const user = room.users.find(u => u.socketId === socket.id);
		if (user) {
			user.isTyping = isTyping;
			socket.to(roomId).emit('userTyping', {
				username: currentUsername,
				isTyping
			});
		}
	});

	socket.on('leaveRoom', ({ roomId, username }) => {
		const room = rooms.get(roomId);
		if (!room) return;

		room.users = room.users.filter(user => user.username !== username);
		socket.leave(roomId);

		if (room.users.length === 0) {
			rooms.delete(roomId);
		} else {
			io.to(roomId).emit('userLeft', {
				username,
				users: room.users.map(user => ({
					username: user.username,
					isTyping: user.isTyping
				}))
			});
		}

		currentRoom = null;
		currentUsername = null;
	});

	socket.on('disconnect', () => {
		if (currentRoom) {
			const room = rooms.get(currentRoom);
			if (room) {
				room.users = room.users.filter(user => user.socketId !== socket.id);

				if (room.users.length === 0) {
					rooms.delete(currentRoom);
				} else {
					io.to(currentRoom).emit('userLeft', {
						username: currentUsername,
						users: room.users.map(user => ({
							username: user.username,
							isTyping: user.isTyping
						}))
					});
				}
			}
		}
	});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});