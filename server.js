const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

const errorPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Server Error</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css">
</head>
<body class="bg-gray-900 text-white flex items-center justify-center h-screen">
    <div class="bg-gray-800 text-center p-4 rounded-lg shadow-lg border border-gray-700 w-72">
        <h1 class="text-xl font-bold text-red-500">Error 404</h1>
        <p class="text-sm text-gray-300 mt-1">This is a server, not a webpage.</p>
        <p class="text-xs text-gray-500 mt-1">Invalid request received.</p>
        <a href="https://github.com/theriturajps" class="mt-3 bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-md text-xs transition inline-block">Github</a>
    </div>
</body>
</html>
`;

app.use((req, res, next) => {
	const invalidPaths = ["/"];
	if (invalidPaths.includes(req.path)) {
		return res.status(400).send(errorPage);
	}
	next();
});

app.use((req, res) => {
	res.status(404).send(errorPage);
});

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

		// Basic HTML content check (optional)
		if (/<script.*?>.*?<\/script>/gi.test(message)) {
			return socket.emit('error', 'script content not allowed');
		}

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