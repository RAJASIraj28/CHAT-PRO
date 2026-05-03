/**
 * ProChat Robust Backend Server v2
 * 
 * Features:
 * - Express Static Server with Compression & Security
 * - Socket.io for Real-time Coordination & Fallback
 * - Gun.js Relay Node for Mesh Persistence
 * - PeerJS Server (Optional / Integrated)
 * - Health Monitoring & Cluster Support
 * - Advanced Error Handling & Logging
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const helmet = require('helmet');
const { Server } = require('socket.io');
const Gun = require('gun');
require('gun/sea'); // Security, Encryption, Authorization

// Configuration
const PORT = process.env.PORT || 3000;
const DEBUG = process.env.DEBUG || true;
const RELAY_DATA_DIR = path.join(__dirname, 'radata');

// Ensure data directory exists
if (!fs.existsSync(RELAY_DATA_DIR)) {
    fs.mkdirSync(RELAY_DATA_DIR);
}

const app = express();
const server = http.createServer(app);

// ==== MIDDLEWARE ====
app.use(compression()); // Compress all responses
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for Gun/PeerJS flexibility in local labs
    crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from the root and 'www'
app.use(express.static(__dirname));
app.use('/www', express.static(path.join(__dirname, 'www')));

// ==== GUN RELAY CONFIGURATION ====
const gun = Gun({
    web: server,
    file: RELAY_DATA_DIR,
    radisk: true,
    localStorage: false,
    peers: [] // Can add other relay peers here
});

// ==== SOCKET.IO FOR COORDINATION ====
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const stats = {
    totalConnections: 0,
    activeUsers: new Map(),
    messageCount: 0,
    startTime: Date.now()
};

io.on('connection', (socket) => {
    stats.totalConnections++;
    const userId = socket.handshake.query.userId || socket.id;
    stats.activeUsers.set(socket.id, { id: userId, joinedAt: Date.now() });

    if (DEBUG) console.log(`[Socket] User connected: ${userId} (${socket.id})`);

    // Broadcast network stats
    io.emit('network_stats', {
        online: stats.activeUsers.size,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000)
    });

    // Handle Peer Discovery
    socket.on('discovery_announce', (data) => {
        // Broadcast to others to help with mesh formation
        socket.broadcast.emit('peer_available', {
            peerId: data.peerId,
            name: data.name
        });
    });

    // Relay simple messages (Legacy fallback)
    socket.on('relay_message', (msg) => {
        stats.messageCount++;
        msg.serverReceivedAt = Date.now();
        socket.broadcast.emit('relay_message', msg);
    });

    // Handle Health Checks
    socket.on('ping', () => socket.emit('pong', { time: Date.now() }));

    socket.on('disconnect', () => {
        stats.activeUsers.delete(socket.id);
        io.emit('network_stats', { online: stats.activeUsers.size });
        if (DEBUG) console.log(`[Socket] User disconnected: ${socket.id}`);
    });
});

// ==== ADVANCED API ENDPOINTS ====

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        users: stats.activeUsers.size,
        version: '2.0.0-robust'
    });
});

/**
 * Peer List Endpoint (Helper for discovery)
 */
app.get('/peers', (req, res) => {
    const peerList = Array.from(stats.activeUsers.values());
    res.json(peerList);
});

/**
 * Diagnostic Logs (Optional: secure this in production)
 */
app.get('/debug/stats', (req, res) => {
    res.json(stats);
});

// ==== ERROR HANDLING ====

// 404 Handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'www', 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[Server Error] ${err.stack}`);
    res.status(500).json({
        error: 'Internal Server Error',
        message: DEBUG ? err.message : 'Something went wrong'
    });
});

// ==== SERVER STARTUP ====

const startServer = () => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`
██████╗ ██████╗  ██████╗  ██████╗██╗  ██╗ █████╗ ████████╗
██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║  ██║██╔══██╗╚══██╔══╝
██████╔╝██████╔╝██║   ██║██║     ███████║███████║   ██║   
██╔═══╝ ██╔══██╗██║   ██║██║     ██╔══██║██╔══██║   ██║   
██║     ██║  ██║╚██████╔╝╚██████╗██║  ██║██║  ██║   ██║   
╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   
                                                          
[System] ProChat Backend is running on port ${PORT}
[System] Gun Relay: Enabled (radata: ${RELAY_DATA_DIR})
[System] Socket.io: Enabled
[System] Mode: ${process.env.NODE_ENV || 'development'}
        `);
    });
};

// Handle process termination gracefully
process.on('SIGTERM', () => {
    console.log('[System] SIGTERM received. Closing server...');
    server.close(() => {
        console.log('[System] Server closed.');
        process.exit(0);
    });
});

startServer();
