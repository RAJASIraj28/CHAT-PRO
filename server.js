const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    // Broadcast online status
    io.emit('status update', { online: onlineUsers > 1 ? 'Online' : 'Waiting for others...' });

    socket.on('chat message', (msg) => {
        // Attach a unique ID for read receipts
        msg.id = Date.now().toString();
        socket.broadcast.emit('chat message', msg);
        // Simulate 'Delivered' immediately to the sender
        socket.emit('message status', { id: msg.id, status: 'delivered' });
    });

    // Handle read receipts
    socket.on('mark read', (msgId) => {
        socket.broadcast.emit('message status', { id: msgId, status: 'read' });
    });
    
    // Handle typing indicators
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('typing', isTyping);
    });

    socket.on('disconnect', () => {
        onlineUsers--;
        io.emit('status update', { online: onlineUsers > 1 ? 'Online' : 'Waiting for others...' });
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
