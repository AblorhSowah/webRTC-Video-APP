'use strict';

document.addEventListener('DOMContentLoaded', function () {

    // ── Constants ──────────────────────────────────────────────────────────
    var CHUNK_SIZE  = 65536;        // 64 KB per chunk
    var MAX_BUFFER  = CHUNK_SIZE * 8; // pause sending if buffered > 512 KB

    // ── Socket ─────────────────────────────────────────────────────────────
    if (typeof io === 'undefined') {
        document.getElementById('loginBtn').textContent = 'Reload page';
        document.getElementById('loginBtn').addEventListener('click', function() { location.reload(); });
        return;
    }

    var socket = io.connect(window.location.origin);

    var rtcConfig = {
        iceCandidatePoolSize: 10,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    };

    // ── State ──────────────────────────────────────────────────────────────
    var myName     = '';
    var activePeer = '';
    var knownUsers = [];

    var peers      = {};  // peerName → { pc, dc, state }
    var sendQueues = {};  // peerName → [{ file, id }]
    var activeSend = {};  // peerName → { file, id, offset, startTime, lastSampleTime, lastSampleBytes }
    var pendingIce = {};  // peerName → RTCIceCandidate[]
    var incoming   = {};  // transferId → { peerName, name, size, mime, chunks[], received, startTime }
    var recvCursor = {};  // peerName → transferId currently receiving

    var transfers  = [];  // all transfer records

    // ── DOM ────────────────────────────────────────────────────────────────
    var loginPage        = document.getElementById('loginPage');
    var appPage          = document.getElementById('appPage');
    var usernameInput    = document.getElementById('usernameInput');
    var loginBtn         = document.getElementById('loginBtn');
    var myNameLabel      = document.getElementById('myNameLabel');
    var userListEl       = document.getElementById('userList');
    var onlineBadge      = document.getElementById('onlineBadge');
    var statusBadge      = document.getElementById('statusBadge');
    var sidebarToggle    = document.getElementById('sidebarToggle');
    var sidebarClose     = document.getElementById('sidebarClose');
    var sidebar          = document.getElementById('sidebar');
    var welcomePane      = document.getElementById('welcomePane');
    var sharePanel       = document.getElementById('sharePanel');
    var peerAvatarEl     = document.getElementById('peerAvatarEl');
    var peerNameEl       = document.getElementById('peerNameEl');
    var connIndicator    = document.getElementById('connIndicator');
    var connLabel        = document.getElementById('connLabel');
    var dropZone         = document.getElementById('dropZone');
    var filePickerInput  = document.getElementById('filePickerInput');
    var browseFilesBtn   = document.getElementById('browseFilesBtn');
    var transferList     = document.getElementById('transferList');
    var transferEmptyState = document.getElementById('transferEmptyState');
    var transferEmptyName  = document.getElementById('transferEmptyName');
    var transferBadge    = document.getElementById('transferBadge');
    var clearDoneBtn     = document.getElementById('clearDoneBtn');
    var navMainEl        = document.getElementById('navMainEl');
    var toastStack       = document.getElementById('toastStack');

    // ── Utilities ──────────────────────────────────────────────────────────
    function esc(str) {
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(String(str || '')));
        return d.innerHTML;
    }

    function formatBytes(b) {
        if (b === 0) return '0 B';
        var k = 1024;
        var u = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.min(Math.floor(Math.log(b) / Math.log(k)), u.length - 1);
        return parseFloat((b / Math.pow(k, i)).toFixed(i ? 1 : 0)) + '\u00a0' + u[i];
    }

    function formatSpeed(bps) {
        return formatBytes(bps) + '/s';
    }

    function initials(name) {
        return String(name || '').trim().slice(0, 2).toUpperCase() || '??';
    }

    function fileIcon(mime) {
        mime = mime || '';
        if (/^image\//i.test(mime))                    return 'fa-file-image-o';
        if (/^video\//i.test(mime))                    return 'fa-file-video-o';
        if (/^audio\//i.test(mime))                    return 'fa-file-audio-o';
        if (/pdf/i.test(mime))                         return 'fa-file-pdf-o';
        if (/zip|rar|7z|tar|gz|bzip/i.test(mime))     return 'fa-file-archive-o';
        if (/msword|wordprocessing/i.test(mime))       return 'fa-file-word-o';
        if (/spreadsheetml|excel/i.test(mime))         return 'fa-file-excel-o';
        if (/powerpoint|presentation/i.test(mime))     return 'fa-file-powerpoint-o';
        if (/^text\//i.test(mime))                     return 'fa-file-text-o';
        if (/javascript|json|html|css|xml/i.test(mime)) return 'fa-file-code-o';
        return 'fa-file-o';
    }

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    }

    function getTransfer(id) {
        for (var i = 0; i < transfers.length; i++) {
            if (transfers[i].id === id) return transfers[i];
        }
        return null;
    }

    function showToast(title, body, type) {
        var el = document.createElement('div');
        el.className = 'app-toast' + (type ? ' toast-' + type : '');
        el.innerHTML =
            '<div class="app-toast-title">' + esc(title) + '</div>' +
            (body ? '<div class="app-toast-body">' + esc(body) + '</div>' : '');
        toastStack.appendChild(el);
        setTimeout(function() {
            el.style.opacity = '0';
            el.style.transform = 'translateX(16px)';
            setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
        }, 4200);
    }

    function setStatus(text, cls) {
        statusBadge.textContent = text;
        statusBadge.className = 'status-badge' + (cls ? ' ' + cls : '');
    }

    function setConnState(state) {
        connIndicator.className = 'conn-indicator conn-' + state;
        var labels = {
            idle:         'Not connected',
            connecting:   'Connecting\u2026',
            connected:    'Connected \u2014 ready to share',
            disconnected: 'Disconnected'
        };
        connLabel.textContent = labels[state] || state;
    }

    function tryNotify(title, body) {
        if (!('Notification' in window)) return;
        if (document.visibilityState === 'visible') return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body: body });
        }
    }

    // ── Login ──────────────────────────────────────────────────────────────
    loginBtn.addEventListener('click', doLogin);
    usernameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });

    function doLogin() {
        var name = usernameInput.value.trim();
        if (!name) return;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>\u00a0Connecting\u2026';
        socket.emit('login', name);
    }

    socket.on('loginResult', function(data) {
        if (data.success) {
            myName = data.name;
            loginPage.classList.add('hidden');
            appPage.classList.remove('hidden');
            appPage.classList.add('active');
            myNameLabel.textContent = myName;
            setStatus('Online', 'online');
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        } else {
            loginBtn.disabled = false;
            loginBtn.innerHTML = 'Get Started &nbsp;<i class="fa fa-arrow-right"></i>';
            showToast('Login failed', data.error || 'Try a different username.', 'error');
        }
    });

    // ── User list ──────────────────────────────────────────────────────────
    socket.on('userList', function(list) {
        knownUsers = (list || []).filter(function(n) { return n !== myName; });
        onlineBadge.textContent = knownUsers.length;
        renderUserList();
    });

    function renderUserList() {
        userListEl.innerHTML = '';

        if (!knownUsers.length) {
            var empty = document.createElement('li');
            empty.className = 'user-empty';
            empty.textContent = 'No other users online yet';
            userListEl.appendChild(empty);
            return;
        }

        knownUsers.forEach(function(name) {
            var p        = peers[name];
            var state    = p ? p.state : 'idle';
            var isActive = (name === activePeer);

            var stateLabels = {
                idle:         'Click to connect',
                connecting:   'Connecting\u2026',
                connected:    'Connected',
                disconnected: 'Disconnected'
            };
            var stateClasses = {
                idle:         '',
                connecting:   'us-connecting',
                connected:    'us-connected',
                disconnected: 'us-disconnected'
            };

            var li = document.createElement('li');
            li.className = 'user-item' + (isActive ? ' active' : '');
            li.innerHTML =
                '<div class="user-avatar">' + esc(initials(name)) + '</div>' +
                '<div class="user-copy">' +
                  '<div class="user-name">' + esc(name) + '</div>' +
                  '<div class="user-state ' + (stateClasses[state] || '') + '">' + (stateLabels[state] || state) + '</div>' +
                '</div>' +
                '<div class="user-action-icon"><i class="fa fa-' + (state === 'connected' ? 'exchange' : 'share') + '"></i></div>';

            li.addEventListener('click', function() { selectPeer(name); });
            userListEl.appendChild(li);
        });
    }

    // ── Peer selection ─────────────────────────────────────────────────────
    function selectPeer(name) {
        activePeer = name;
        peerAvatarEl.textContent = initials(name);
        peerNameEl.textContent   = name;
        transferEmptyName.textContent = name;
        navMainEl.innerHTML = '<i class="fa fa-share-alt"></i><span>' + esc(name) + '</span>';

        welcomePane.classList.add('hidden');
        sharePanel.classList.remove('hidden');

        if (window.innerWidth < 768) sidebar.classList.remove('open');

        renderUserList();

        var p = peers[name];
        if (!p || p.state === 'idle' || p.state === 'disconnected') {
            connectToPeer(name);
        } else {
            setConnState(p.state);
        }

        renderTransfers();
    }

    // ── RTCPeerConnection factory ──────────────────────────────────────────
    function makePeerConnection(name) {
        var pc = new RTCPeerConnection(rtcConfig);

        pc.onicecandidate = function(e) {
            if (e.candidate) {
                socket.emit('signal', { to: name, type: 'ice', payload: e.candidate });
            }
        };

        pc.onconnectionstatechange = function() {
            var p  = peers[name];
            if (!p) return;
            var cs = pc.connectionState;

            if (cs === 'connected') {
                p.state = 'connected';
            } else if (cs === 'disconnected' || cs === 'failed' || cs === 'closed') {
                p.state = 'disconnected';
                // Mark active send as failed
                var s = activeSend[name];
                if (s) {
                    var t = getTransfer(s.id);
                    if (t) { t.state = 'failed'; t.error = 'Connection lost'; }
                    delete activeSend[name];
                    renderTransfers();
                }
            }

            if (name === activePeer) setConnState(p.state);
            renderUserList();
        };

        return pc;
    }

    // ── Initiate connection to a peer ─────────────────────────────────────
    function connectToPeer(name) {
        if (peers[name] && peers[name].state === 'connecting') return;

        var pc = makePeerConnection(name);
        var dc = pc.createDataChannel('files', { ordered: true });

        peers[name]      = { pc: pc, dc: dc, state: 'connecting' };
        sendQueues[name] = sendQueues[name] || [];

        bindDataChannel(dc, name);
        setConnState('connecting');
        renderUserList();

        pc.createOffer()
            .then(function(offer) { return pc.setLocalDescription(offer); })
            .then(function() {
                socket.emit('signal', { to: name, type: 'offer', payload: pc.localDescription });
            })
            .catch(function(err) {
                console.error('Offer error:', err);
                if (peers[name]) peers[name].state = 'disconnected';
                setConnState('disconnected');
                showToast('Connection failed', 'Could not reach ' + name, 'error');
            });
    }

    // ── DataChannel setup ─────────────────────────────────────────────────
    function bindDataChannel(dc, peerName) {
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = CHUNK_SIZE;

        dc.onopen = function() {
            var p = peers[peerName];
            if (p) { p.state = 'connected'; p.dc = dc; }
            if (peerName === activePeer) setConnState('connected');
            renderUserList();
            showToast('Connected', 'P2P link established with ' + peerName, 'success');
            processQueue(peerName);
        };

        dc.onclose = function() {
            var p = peers[peerName];
            if (p) p.state = 'disconnected';
            if (peerName === activePeer) setConnState('disconnected');
            renderUserList();
        };

        dc.onerror = function(err) {
            console.error('DataChannel error with ' + peerName + ':', err);
        };

        dc.onmessage = function(e) {
            if (typeof e.data === 'string') {
                handleChannelMsg(JSON.parse(e.data), peerName);
            } else {
                handleChannelChunk(e.data, peerName);
            }
        };
    }

    // ── Signaling ──────────────────────────────────────────────────────────
    socket.on('signal', function(data) {
        var from = data.from;
        if (data.type === 'offer')  handleOffer(from, data.payload);
        if (data.type === 'answer') handleAnswer(from, data.payload);
        if (data.type === 'ice')    handleIce(from, data.payload);
    });

    function handleOffer(from, offer) {
        if (!peers[from]) {
            var pc = makePeerConnection(from);
            peers[from]      = { pc: pc, dc: null, state: 'connecting' };
            sendQueues[from] = sendQueues[from] || [];

            pc.ondatachannel = function(e) {
                peers[from].dc = e.channel;
                bindDataChannel(e.channel, from);
            };
        }

        var p = peers[from];
        p.pc.setRemoteDescription(new RTCSessionDescription(offer))
            .then(function() { return p.pc.createAnswer(); })
            .then(function(answer) { return p.pc.setLocalDescription(answer); })
            .then(function() {
                socket.emit('signal', { to: from, type: 'answer', payload: p.pc.localDescription });
                flushIce(from);
            })
            .catch(function(err) { console.error('Answer error:', err); });

        renderUserList();
        showToast(from, 'is connecting to share files. Select them from the sidebar.', 'info');
    }

    function handleAnswer(from, answer) {
        var p = peers[from];
        if (!p) return;
        p.pc.setRemoteDescription(new RTCSessionDescription(answer))
            .then(function() { flushIce(from); })
            .catch(console.error);
    }

    function handleIce(from, candidate) {
        var p = peers[from];
        if (!p || !p.pc.remoteDescription) {
            pendingIce[from] = pendingIce[from] || [];
            pendingIce[from].push(candidate);
            return;
        }
        p.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    }

    function flushIce(peerName) {
        var p = peers[peerName];
        if (!p) return;
        var candidates = pendingIce[peerName] || [];
        candidates.forEach(function(c) {
            p.pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
        });
        delete pendingIce[peerName];
    }

    // ── File sending ───────────────────────────────────────────────────────
    function queueFiles(peerName, files) {
        sendQueues[peerName] = sendQueues[peerName] || [];

        Array.from(files).forEach(function(file) {
            var id = genId();
            sendQueues[peerName].push({ file: file, id: id });
            transfers.push({
                id:        id,
                direction: 'send',
                peerName:  peerName,
                name:      file.name,
                size:      file.size,
                mime:      file.type || 'application/octet-stream',
                state:     'queued',
                progress:  0,
                speed:     0,
                startTime: null,
                endTime:   null,
                blobUrl:   null,
                error:     null
            });
        });

        renderTransfers();

        var p = peers[peerName];
        if (!p || p.state === 'idle' || p.state === 'disconnected') {
            connectToPeer(peerName);
        } else if (p.state === 'connected') {
            processQueue(peerName);
        }
        // if 'connecting' → processQueue called when DataChannel opens
    }

    function processQueue(peerName) {
        if (activeSend[peerName]) return; // already sending
        var queue = sendQueues[peerName];
        if (!queue || !queue.length) return;
        var p = peers[peerName];
        if (!p || p.state !== 'connected' || !p.dc || p.dc.readyState !== 'open') return;

        var item = queue.shift();
        var now  = Date.now();
        activeSend[peerName] = {
            file:             item.file,
            id:               item.id,
            offset:           0,
            startTime:        now,
            lastSampleTime:   now,
            lastSampleBytes:  0,
            speed:            0
        };

        var t = getTransfer(item.id);
        if (t) { t.state = 'sending'; t.startTime = now; }
        renderTransfers();

        // Send metadata header
        p.dc.send(JSON.stringify({
            type: 'file-start',
            id:   item.id,
            name: item.file.name,
            size: item.file.size,
            mime: item.file.type || 'application/octet-stream'
        }));

        sendNextChunk(peerName);
    }

    function sendNextChunk(peerName) {
        var send = activeSend[peerName];
        if (!send) return;

        var p = peers[peerName];
        if (!p || !p.dc || p.dc.readyState !== 'open') {
            finishSend(peerName, false, 'Connection closed');
            return;
        }

        var dc = p.dc;

        // All bytes sent — send end marker
        if (send.offset >= send.file.size) {
            dc.send(JSON.stringify({ type: 'file-end', id: send.id }));
            finishSend(peerName, true, null);
            return;
        }

        // Back-pressure: pause if send buffer is too full
        if (dc.bufferedAmount > MAX_BUFFER) {
            dc.onbufferedamountlow = function() {
                dc.onbufferedamountlow = null;
                sendNextChunk(peerName);
            };
            return;
        }

        var slice = send.file.slice(send.offset, send.offset + CHUNK_SIZE);
        var capturedId = send.id;

        slice.arrayBuffer().then(function(buf) {
            // Guard: still the same send and channel is open
            var currentSend = activeSend[peerName];
            if (!currentSend || currentSend.id !== capturedId) return;
            if (!peers[peerName] || !peers[peerName].dc || peers[peerName].dc.readyState !== 'open') {
                finishSend(peerName, false, 'Connection closed');
                return;
            }

            peers[peerName].dc.send(buf);
            currentSend.offset += buf.byteLength;

            // Speed sample every 500 ms
            var now = Date.now();
            var dt  = (now - currentSend.lastSampleTime) / 1000;
            if (dt >= 0.5) {
                currentSend.speed = (currentSend.offset - currentSend.lastSampleBytes) / dt;
                currentSend.lastSampleTime  = now;
                currentSend.lastSampleBytes = currentSend.offset;
            }

            var t = getTransfer(capturedId);
            if (t) {
                t.progress = currentSend.offset / currentSend.file.size;
                t.speed    = currentSend.speed;
            }

            updateTransferEl(capturedId);
            sendNextChunk(peerName);
        }).catch(function() {
            finishSend(peerName, false, 'File read error');
        });
    }

    function finishSend(peerName, success, errMsg) {
        var send = activeSend[peerName];
        if (!send) return;

        var t = getTransfer(send.id);
        if (success) {
            if (t) { t.state = 'done'; t.progress = 1; t.speed = 0; t.endTime = Date.now(); }
            showToast('Sent', send.file.name + ' (' + formatBytes(send.file.size) + ')', 'success');
        } else {
            if (t) { t.state = 'failed'; t.error = errMsg || 'Unknown error'; }
            showToast('Transfer failed', send.file.name + ': ' + (errMsg || 'Unknown error'), 'error');
        }

        delete activeSend[peerName];
        renderTransfers();
        processQueue(peerName); // start next in queue
    }

    // ── File receiving ─────────────────────────────────────────────────────
    function handleChannelMsg(msg, peerName) {
        if (msg.type === 'file-start') {
            incoming[msg.id] = {
                peerName:  peerName,
                name:      msg.name,
                size:      msg.size,
                mime:      msg.mime,
                chunks:    [],
                received:  0,
                startTime: Date.now()
            };
            recvCursor[peerName] = msg.id;

            transfers.push({
                id:        msg.id,
                direction: 'receive',
                peerName:  peerName,
                name:      msg.name,
                size:      msg.size,
                mime:      msg.mime,
                state:     'receiving',
                progress:  0,
                speed:     0,
                startTime: Date.now(),
                endTime:   null,
                blobUrl:   null,
                error:     null
            });

            renderTransfers();
            showToast(
                'Incoming file',
                peerName + ' \u2192 ' + msg.name + ' (' + formatBytes(msg.size) + ')',
                'info'
            );

        } else if (msg.type === 'file-end') {
            completeReceive(msg.id);
        }
    }

    function handleChannelChunk(buf, peerName) {
        var id  = recvCursor[peerName];
        if (!id) return;
        var inc = incoming[id];
        if (!inc) return;

        inc.chunks.push(buf);
        inc.received += buf.byteLength;

        var t = getTransfer(id);
        if (t) {
            t.progress = Math.min(inc.received / inc.size, 0.999);
            var elapsed = (Date.now() - inc.startTime) / 1000;
            t.speed = elapsed > 0.1 ? inc.received / elapsed : 0;
        }

        updateTransferEl(id);
    }

    function completeReceive(id) {
        var inc = incoming[id];
        if (!inc) return;

        var blob    = new Blob(inc.chunks, { type: inc.mime || 'application/octet-stream' });
        var blobUrl = URL.createObjectURL(blob);

        delete incoming[id];
        if (recvCursor[inc.peerName] === id) delete recvCursor[inc.peerName];

        var t = getTransfer(id);
        if (t) {
            t.state    = 'done';
            t.progress = 1;
            t.speed    = 0;
            t.endTime  = Date.now();
            t.blobUrl  = blobUrl;
        }

        renderTransfers();
        showToast('File received', inc.name + ' from ' + inc.peerName, 'success');
        tryNotify('File received', inc.name + ' from ' + inc.peerName);
    }

    function downloadBlob(url, name) {
        var a = document.createElement('a');
        a.href     = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { if (a.parentNode) a.parentNode.removeChild(a); }, 100);
    }

    // ── Transfer UI ────────────────────────────────────────────────────────
    function getVisibleTransfers() {
        if (!activePeer) return [];
        return transfers.filter(function(t) { return t.peerName === activePeer; });
    }

    function renderTransfers() {
        var visible = getVisibleTransfers();

        // Active transfer badge
        var activeCount = visible.filter(function(t) {
            return t.state === 'sending' || t.state === 'receiving' || t.state === 'queued';
        }).length;
        transferBadge.textContent = activeCount;
        transferBadge.classList.toggle('hidden', activeCount === 0);

        if (!visible.length) {
            transferEmptyState.classList.remove('hidden');
            transferList.innerHTML = '';
            return;
        }

        transferEmptyState.classList.add('hidden');
        transferList.innerHTML = '';

        // Newest first
        var reversed = visible.slice().reverse();
        reversed.forEach(function(t) {
            transferList.appendChild(buildTransferEl(t));
        });
    }

    function updateTransferEl(id) {
        var t = getTransfer(id);
        if (!t) return;
        var el = transferList.querySelector('[data-tid="' + id + '"]');
        if (!el) return; // will be re-rendered on next renderTransfers call

        var fill = el.querySelector('.tp-fill');
        var pct  = el.querySelector('.tp-pct');
        var spd  = el.querySelector('.tp-speed');
        var p    = Math.round(t.progress * 100);

        if (fill) fill.style.width = p + '%';
        if (pct)  pct.textContent  = p + '%';
        if (spd && t.speed > 0) spd.textContent = formatSpeed(t.speed);
    }

    function buildTransferEl(t) {
        var el    = document.createElement('div');
        var isUp  = t.direction === 'send';
        var pct   = Math.round(t.progress * 100);
        var icon  = fileIcon(t.mime);
        var dirIcon = isUp ? 'fa-upload' : 'fa-download';
        var dirLbl  = isUp ? 'To\u00a0' + t.peerName : 'From\u00a0' + t.peerName;

        el.className      = 'transfer-item ti-' + t.state;
        el.dataset.tid    = t.id;

        var progressHtml = '';
        if (t.state === 'sending' || t.state === 'receiving') {
            progressHtml =
                '<div class="tp-bar"><div class="tp-fill ' + (isUp ? 'tp-up' : 'tp-down') + '" style="width:' + pct + '%"></div></div>' +
                '<div class="tp-row">' +
                  '<span class="tp-pct">' + pct + '%</span>' +
                  '<span class="tp-speed">' + (t.speed > 0 ? formatSpeed(t.speed) : '\u2026') + '</span>' +
                '</div>';
        }

        var statusHtml = '';
        if (t.state === 'queued') {
            statusHtml = '<div class="ti-status ti-queued"><i class="fa fa-clock-o"></i> Queued</div>';
        } else if (t.state === 'done') {
            statusHtml = '<div class="ti-status ti-done"><i class="fa fa-check-circle"></i> ' + (isUp ? 'Sent' : 'Received') + ' \u00b7 ' + formatBytes(t.size) + '</div>';
        } else if (t.state === 'failed') {
            statusHtml = '<div class="ti-status ti-failed"><i class="fa fa-exclamation-circle"></i> ' + esc(t.error || 'Failed') + '</div>';
        }

        var actionHtml = '';
        if (t.state === 'done' && !isUp && t.blobUrl) {
            actionHtml = '<button class="ti-download-btn" data-url="' + esc(t.blobUrl) + '" data-name="' + esc(t.name) + '">' +
                           '<i class="fa fa-download"></i> Save file' +
                         '</button>';
        }

        el.innerHTML =
            '<div class="ti-icon ti-icon-' + (isUp ? 'up' : 'down') + '"><i class="fa ' + icon + '"></i></div>' +
            '<div class="ti-body">' +
              '<div class="ti-name">' + esc(t.name) + '</div>' +
              '<div class="ti-meta"><i class="fa ' + dirIcon + '"></i> ' + esc(dirLbl) + ' \u00b7 ' + formatBytes(t.size) + '</div>' +
              progressHtml +
              statusHtml +
              actionHtml +
            '</div>';

        var dlBtn = el.querySelector('.ti-download-btn');
        if (dlBtn) {
            dlBtn.addEventListener('click', function() {
                downloadBlob(this.dataset.url, this.dataset.name);
            });
        }

        return el;
    }

    clearDoneBtn.addEventListener('click', function() {
        for (var i = transfers.length - 1; i >= 0; i--) {
            if (transfers[i].state === 'done' || transfers[i].state === 'failed') {
                if (transfers[i].blobUrl) URL.revokeObjectURL(transfers[i].blobUrl);
                transfers.splice(i, 1);
            }
        }
        renderTransfers();
    });

    // ── Drop zone ──────────────────────────────────────────────────────────
    // Prevent browser from navigating away on stray drops
    document.body.addEventListener('dragover', function(e) { e.preventDefault(); });
    document.body.addEventListener('drop',     function(e) { e.preventDefault(); });

    dropZone.addEventListener('dragover', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (activePeer) dropZone.classList.add('dz-over');
    });

    dropZone.addEventListener('dragleave', function() {
        dropZone.classList.remove('dz-over');
    });

    dropZone.addEventListener('drop', function(e) {
        e.stopPropagation();
        e.preventDefault();
        dropZone.classList.remove('dz-over');
        if (!activePeer) {
            showToast('No peer selected', 'Choose someone from the sidebar first.', 'error');
            return;
        }
        var files = e.dataTransfer.files;
        if (files && files.length) queueFiles(activePeer, files);
    });

    browseFilesBtn.addEventListener('click', function() {
        if (!activePeer) {
            showToast('No peer selected', 'Choose someone from the sidebar first.', 'error');
            return;
        }
        filePickerInput.click();
    });

    filePickerInput.addEventListener('change', function() {
        if (!activePeer || !filePickerInput.files.length) return;
        queueFiles(activePeer, filePickerInput.files);
        filePickerInput.value = '';
    });

    // ── Sidebar ────────────────────────────────────────────────────────────
    sidebarToggle.addEventListener('click', function() { sidebar.classList.toggle('open'); });
    sidebarClose.addEventListener('click',  function() { sidebar.classList.remove('open'); });

    // ── Socket connection state ────────────────────────────────────────────
    socket.on('disconnect', function() { setStatus('Offline', ''); });
    socket.on('connect',    function() { if (myName) setStatus('Online', 'online'); });
});

