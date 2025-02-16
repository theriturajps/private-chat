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

function generateCode(length = 6) {
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let code = '';
	for (let i = 0; i < length; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

function generateRoomId(length = 8) {
	let chars = 'abcdef0123456789';
	let roomId = '';
	for (let i = 0; i < length; i++) {
		roomId += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return roomId;
}

setInterval(() => {
	const now = Date.now();
	for (const [roomId, room] of rooms.entries()) {
		if (now - room.createdAt > 6 * 60 * 60 * 1000) {
			io.to(roomId).emit('error', 'Room has expired');
			io.in(roomId).socketsLeave(roomId);
			rooms.delete(roomId);
		}
	}
}, 60000);

io.on('connection', (socket) => {
	socket.on('createRoom', ({ roomName, username }) => {
		const roomId = generateRoomId();
		const roomCode = generateCode();

		rooms.set(roomId, {
			name: roomName,
			code: roomCode,
			users: [{ username, socketId: socket.id }],
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

		room.users.push({ username, socketId: socket.id });
		socket.join(roomId);

		socket.emit('joinedRoom', {
			roomId,
			roomCode,
			roomName: room.name,
			users: room.users.map(user => user.username)
		});

		room.messages.forEach(msg => {
			socket.emit('message', msg);
		});

		socket.to(roomId).emit('userJoined', {
			username,
			users: room.users.map(user => user.username)
		});
	});

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
				users: room.users.map(user => user.username)
			});
		}
	});

	socket.on('disconnect', () => {
		let roomIdToRemove;
		let disconnectedUsername;

		rooms.forEach((room, roomId) => {
			const userIndex = room.users.findIndex(user => user.socketId === socket.id);
			if (userIndex !== -1) {
				disconnectedUsername = room.users[userIndex].username;
				room.users.splice(userIndex, 1);
				roomIdToRemove = roomId;
			}
		});

		if (roomIdToRemove) {
			const room = rooms.get(roomIdToRemove);
			if (room.users.length === 0) {
				rooms.delete(roomIdToRemove);
			} else {
				io.to(roomIdToRemove).emit('userLeft', {
					username: disconnectedUsername,
					users: room.users.map(user => user.username)
				});
			}
		}
	});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
