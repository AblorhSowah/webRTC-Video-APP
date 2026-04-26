const express = require('express');
const socket  = require('socket.io');

const app    = express();
const server = app.listen(9000, () => console.log('Listening on port 9000'));
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

app.use(express.static('public'));

const io    = socket(server);
const users = {};   // name → socket
const statuses = {}; // name -> status items
const demoState = {
    active: false,
    presenter: null,
    title: '',
    startedAt: null,
    raisedHands: []
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function broadcastUserList() {
    const list = Object.keys(users);
    io.emit('userList', list);
}

function pruneExpiredStatuses() {
    const cutoff = Date.now() - STATUS_TTL_MS;

    Object.keys(statuses).forEach(function(name) {
        statuses[name] = (statuses[name] || []).filter(function(item) {
            return (item.time || 0) >= cutoff;
        });

        if (!statuses[name].length) {
            delete statuses[name];
        }
    });
}

function getStatusList() {
    pruneExpiredStatuses();

    return Object.keys(statuses).map(function(name) {
        const items = (statuses[name] || []).slice().sort(function(left, right) {
            return (left.time || 0) - (right.time || 0);
        });
        const latest = items[items.length - 1] || null;

        return {
            from: name,
            online: !!users[name],
            latestTime: latest ? latest.time : 0,
            items: items
        };
    }).sort(function(left, right) {
        return (right.latestTime || 0) - (left.latestTime || 0);
    });
}

function broadcastStatusList() {
    io.emit('status:list', getStatusList());
}

function resetDemoState() {
    demoState.active = false;
    demoState.presenter = null;
    demoState.title = '';
    demoState.startedAt = null;
    demoState.raisedHands = [];
}

function getDemoPayload() {
    return {
        active: demoState.active,
        presenter: demoState.presenter,
        title: demoState.title,
        startedAt: demoState.startedAt,
        raisedHands: demoState.raisedHands.slice()
    };
}

// ─── Connection ───────────────────────────────────────────────────────────────

io.on('connection', function(socket) {
    console.log('Connected:', socket.id);

    // ── Login ──────────────────────────────────────────────────────────────
    socket.on('UserStart', function(data) {
        switch (data.type) {

            case 'login':
                if (users[data.name]) {
                    socket.emit('message', { type: 'login', success: false });
                } else {
                    users[data.name] = socket;
                    socket.name = data.name;
                    socket.emit('message', { type: 'login', success: true });
                    socket.emit('demo:state', getDemoPayload());
                    socket.emit('status:list', getStatusList());
                    broadcastUserList();
                    console.log('Login:', data.name);
                }
                break;

            case 'offer': {
                const conn = users[data.name];
                if (conn) {
                    socket.callTarget = data.name;
                    conn.caller       = socket.name;
                    conn.emit('message', { type: 'offer', from: socket.name });
                    console.log('Offer:', socket.name, '→', data.name);
                } else {
                    socket.emit('message', { type: 'invalid' });
                }
                break;
            }

            case 'leave': {
                const conn = users[data.name];
                if (conn) {
                    conn.emit('message', { type: 'leave' });
                    conn.caller     = null;
                    conn.callTarget = null;
                }
                socket.callTarget = null;
                socket.caller     = null;
                console.log('Leave:', socket.name, '→', data.name);
                break;
            }

            default:
                socket.emit('message', { type: 'errr', message: 'Unknown command: ' + data.type });
        }
    });

    // ── SDP offer → callee ────────────────────────────────────────────────
    socket.on('msg', function(sdp) {
        const target = socket.callTarget;
        if (target && users[target]) {
            users[target].emit('offer', sdp);
        }
    });

    // ── SDP answer → caller ───────────────────────────────────────────────
    socket.on('answer', function(sdp) {
        // Fix: set callTarget on callee side so ICE flows both ways
        const callerName = socket.caller;
        if (callerName && users[callerName]) {
            socket.callTarget = callerName;   // ← KEY FIX for remote video
            users[callerName].emit('Reanswer', sdp);
        }
    });

    // ── ICE candidates → other peer ───────────────────────────────────────
    socket.on('candidate', function(candidate) {
        const target = socket.callTarget || socket.caller;
        if (target && users[target]) {
            users[target].emit('candidate', candidate);
        }
    });

    // ── Chat message ──────────────────────────────────────────────────────
    socket.on('chatMessage', function(data) {
        // DM to a specific user
        const dest = users[data.to];
        if (dest) {
            dest.emit('chatMessage', {
                from: socket.name,
                text: data.text,
                time: Date.now()
            });
        }
        // Echo back to sender
        socket.emit('chatMessage', {
            from: socket.name,
            text: data.text,
            time: Date.now(),
            self: true
        });
    });

    // ── Typing indicator ──────────────────────────────────────────────────
    socket.on('typing', function(data) {
        const dest = users[data.to];
        if (dest) dest.emit('typing', { from: socket.name, typing: data.typing });
    });

    // ── File transfer ─────────────────────────────────────────────────────
    socket.on('fileTransfer', function(data) {
        const dest = users[data.to];
        if (dest) {
            dest.emit('fileTransfer', {
                from:     socket.name,
                fileName: data.fileName,
                fileType: data.fileType,
                fileData: data.fileData,   // base64
                time:     Date.now()
            });
        }
    });

    socket.on('status:update', function(data) {
        if (!socket.name || !data) return;

        const kind = data.kind === 'video' ? 'video' : 'image';
        const statusItem = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            kind: kind,
            fileName: data.fileName,
            fileType: data.fileType,
            fileData: data.fileData,
            durationSec: kind === 'video' ? Number(data.durationSec) || 0 : 0,
            time: Date.now()
        };

        pruneExpiredStatuses();

        if (!statuses[socket.name]) {
            statuses[socket.name] = [];
        }

        statuses[socket.name].push(statusItem);

        broadcastStatusList();
    });

    socket.on('status:clear', function() {
        if (!socket.name) return;
        delete statuses[socket.name];
        broadcastStatusList();
    });

    // ── Demo mode ─────────────────────────────────────────────────────────
    socket.on('demo:start', function(data) {
        if (!socket.name) return;

        if (demoState.active && demoState.presenter !== socket.name) {
            socket.emit('demo:error', { message: 'Another demo is already live.' });
            return;
        }

        demoState.active = true;
        demoState.presenter = socket.name;
        demoState.title = data && data.title
            ? String(data.title).trim().slice(0, 80)
            : socket.name + "'s Demo";
        demoState.startedAt = Date.now();

        io.emit('demo:started', getDemoPayload());
        console.log('Demo started:', socket.name);
    });

    socket.on('demo:frame', function(data) {
        if (!demoState.active || socket.name !== demoState.presenter) return;
        if (!data || !data.frame) return;

        socket.broadcast.emit('demo:frame', {
            presenter: socket.name,
            frame: data.frame,
            time: Date.now()
        });
    });

    socket.on('demo:question', function(data) {
        if (!demoState.active || !socket.name) return;

        const text = data && data.text ? String(data.text).trim().slice(0, 500) : '';
        if (!text) return;

        io.emit('demo:question', {
            from: socket.name,
            text: text,
            time: Date.now()
        });
    });

    socket.on('demo:raise-hand', function(data) {
        if (!demoState.active || !socket.name) return;

        const raised = !!(data && data.raised);
        const currentIndex = demoState.raisedHands.indexOf(socket.name);

        if (raised && currentIndex === -1) {
            demoState.raisedHands.push(socket.name);
        }

        if (!raised && currentIndex !== -1) {
            demoState.raisedHands.splice(currentIndex, 1);
        }

        io.emit('demo:hands', {
            raisedHands: demoState.raisedHands.slice(),
            from: socket.name,
            raised: raised
        });
    });

    socket.on('demo:stop', function() {
        if (!demoState.active || socket.name !== demoState.presenter) return;

        const presenter = socket.name;
        resetDemoState();
        io.emit('demo:stopped', { presenter: presenter });
        io.emit('demo:state', getDemoPayload());
        console.log('Demo stopped:', presenter);
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', function() {
        if (!socket.name) return;
        console.log('Disconnected:', socket.name);

        // Notify call partner
        const target = socket.callTarget || socket.caller;
        if (target && users[target]) {
            users[target].emit('message', { type: 'leave' });
            users[target].caller     = null;
            users[target].callTarget = null;
        }

        if (demoState.active && demoState.presenter === socket.name) {
            resetDemoState();
            io.emit('demo:stopped', { presenter: socket.name });
            io.emit('demo:state', getDemoPayload());
        } else if (demoState.raisedHands.includes(socket.name)) {
            demoState.raisedHands = demoState.raisedHands.filter(function(name) {
                return name !== socket.name;
            });
            io.emit('demo:hands', {
                raisedHands: demoState.raisedHands.slice(),
                from: socket.name,
                raised: false
            });
        }

        delete users[socket.name];
        broadcastUserList();
        broadcastStatusList();
    });
});
