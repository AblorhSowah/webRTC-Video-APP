'use strict';

const express = require('express');
const socket  = require('socket.io');

const app    = express();
const server = app.listen(9000, function() {
    console.log('P2P FileShare server listening on http://localhost:9000');
});

app.use(express.static('public'));

const io    = socket(server);
const users = {}; // name → socket

// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcastUserList() {
    io.emit('userList', Object.keys(users));
}

// ─── Connection ───────────────────────────────────────────────────────────────

io.on('connection', function(socket) {
    console.log('Socket connected:', socket.id);

    // ── Login ──────────────────────────────────────────────────────────────
    socket.on('login', function(name) {
        const trimmed = String(name || '').trim().slice(0, 30);

        if (!trimmed || /[<>"&]/.test(trimmed)) {
            socket.emit('loginResult', { success: false, error: 'Invalid username.' });
            return;
        }

        if (users[trimmed]) {
            socket.emit('loginResult', { success: false, error: 'Name already taken.' });
            return;
        }

        users[trimmed] = socket;
        socket.name    = trimmed;
        socket.emit('loginResult', { success: true, name: trimmed });
        broadcastUserList();
        console.log('Login:', trimmed);
    });

    // ── WebRTC signal relay ────────────────────────────────────────────────
    // Relays offer/answer/ICE between peers for WebRTC handshake only.
    // Actual file data flows peer-to-peer via RTCDataChannel.
    socket.on('signal', function(data) {
        if (!socket.name || !data || !data.to || !data.type) return;

        const dest = users[data.to];
        if (!dest) return;

        dest.emit('signal', {
            from:    socket.name,
            type:    data.type,
            payload: data.payload
        });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', function() {
        if (!socket.name) return;
        console.log('Disconnected:', socket.name);
        delete users[socket.name];
        broadcastUserList();
    });
});

