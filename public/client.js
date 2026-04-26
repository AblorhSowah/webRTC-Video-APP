document.addEventListener('DOMContentLoaded', function () {
    if (typeof io === 'undefined') {
        const btn = document.getElementById('loginBtn');
        btn.innerHTML = 'Reload Page';
        btn.style.background = '#c0392b';
        btn.addEventListener('click', function () {
            location.reload();
        });
        return;
    }

    const socket = io.connect(window.location.origin);
    const rtcConfig = {
        iceCandidatePoolSize: 10,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' }
        ]
    };
    const demoCaptureConfig = {
        intervalMs: 220,
        maxWidth: 960,
        maxHeight: 540,
        quality: 0.5,
        format: 'image/webp'
    };

    let peerConnection = null;
    let localStream = null;
    let myName = '';
    let activeChat = '';
    let micEnabled = true;
    let camEnabled = true;
    let typingTimer = null;
    let isTyping = false;
    let pendingRemoteOffer = null;
    let pendingIceCandidates = [];
    let mediaRequest = null;
    let applyingRemoteOffer = false;
    let notificationPermissionAsked = false;
    let activeCallPeer = '';
    let demoScreenStream = null;
    let demoFrameTimer = null;
    let demoCanvas = null;
    let demoVideo = null;
    let demoQuestions = [];
    let demoRaisedHands = [];
    let hasRaisedHand = false;
    let statusFeed = [];
    let knownUsers = [];
    let activeStatusOwner = '';
    let activeStatusIndex = 0;
    let seenStatusState = {};
    let demoState = {
        active: false,
        presenter: null,
        title: '',
        startedAt: null,
        raisedHands: []
    };

    const chatHistory = {};

    const loginPage = document.getElementById('loginPage');
    const appPage = document.getElementById('appPage');
    const usernameInput = document.getElementById('usernameInput');
    const loginBtn = document.getElementById('loginBtn');
    const myNameLabel = document.getElementById('myNameLabel');
    const chatWithLabel = document.getElementById('chatWithLabel');
    const userListEl = document.getElementById('userList');
    const onlineBadge = document.getElementById('onlineBadge');
    const statusBadge = document.getElementById('statusBadge');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const statusListEl = document.getElementById('statusList');
    const addStatusBtn = document.getElementById('addStatusBtn');
    const clearStatusBtn = document.getElementById('clearStatusBtn');
    const statusInput = document.getElementById('statusInput');
    const welcomePane = document.getElementById('welcomePane');
    const chatPanel = document.getElementById('chatPanel');
    const chatPartyAvatar = document.getElementById('chatPartyAvatar');
    const chatPartyName = document.getElementById('chatPartyName');
    const chatPartyMeta = document.getElementById('chatPartyMeta');
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const callBtn = document.getElementById('callBtn');
    const hangUpBtn = document.getElementById('hangUpBtn');
    const fileInput = document.getElementById('fileInput');
    const typingIndicator = document.getElementById('typingIndicator');
    const videoOverlay = document.getElementById('videoOverlay');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const callWithLabel = document.getElementById('callWithLabel');
    const callStatusLabel = document.getElementById('callStatusLabel');
    const toggleMicBtn = document.getElementById('toggleMicBtn');
    const toggleCamBtn = document.getElementById('toggleCamBtn');
    const dropHint = document.getElementById('dropHint');
    const demoPanel = document.getElementById('demoPanel');
    const demoToggleBtn = document.getElementById('demoToggleBtn');
    const demoLivePill = document.getElementById('demoLivePill');
    const startDemoBtn = document.getElementById('startDemoBtn');
    const stopDemoBtn = document.getElementById('stopDemoBtn');
    const closeDemoBtn = document.getElementById('closeDemoBtn');
    const demoTitle = document.getElementById('demoTitle');
    const demoSubtitle = document.getElementById('demoSubtitle');
    const demoFrameImage = document.getElementById('demoFrameImage');
    const demoEmptyState = document.getElementById('demoEmptyState');
    const demoQuestionList = document.getElementById('demoQuestionList');
    const demoQuestionInput = document.getElementById('demoQuestionInput');
    const demoQuestionBtn = document.getElementById('demoQuestionBtn');
    const demoQuestionCount = document.getElementById('demoQuestionCount');
    const statusPanel = document.getElementById('statusPanel');
    const closeStatusBtn = document.getElementById('closeStatusBtn');
    const statusViewerName = document.getElementById('statusViewerName');
    const statusViewerMeta = document.getElementById('statusViewerMeta');
    const statusViewerImage = document.getElementById('statusViewerImage');
    const statusViewerVideo = document.getElementById('statusViewerVideo');
    const statusViewerEmpty = document.getElementById('statusViewerEmpty');
    const statusViewerCount = document.getElementById('statusViewerCount');
    const statusPrevBtn = document.getElementById('statusPrevBtn');
    const statusNextBtn = document.getElementById('statusNextBtn');
    const demoPresenterChip = document.getElementById('demoPresenterChip');
    const demoHandsChip = document.getElementById('demoHandsChip');
    const raiseHandBtn = document.getElementById('raiseHandBtn');
    const demoFullscreenBtn = document.getElementById('demoFullscreenBtn');
    const demoScreenShell = document.getElementById('demoScreenShell');
    const demoRaisedList = document.getElementById('demoRaisedList');
    const demoRaisedCount = document.getElementById('demoRaisedCount');
    const toastStack = document.getElementById('toastStack');

    function setStatus(text, cls) {
        statusBadge.textContent = text;
        statusBadge.className = 'status-badge' + (cls ? ' ' + cls : '');
    }

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str || ''));
        return div.innerHTML;
    }

    function getAvatarLetters(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return 'CF';
        return trimmed.slice(0, 2).toUpperCase();
    }

    function getSeenStatusStorageKey() {
        return 'cf-soci-status-seen:' + String(myName || 'guest').toLowerCase();
    }

    function loadSeenStatusState() {
        try {
            const raw = window.localStorage.getItem(getSeenStatusStorageKey());
            seenStatusState = raw ? JSON.parse(raw) : {};
        } catch (error) {
            seenStatusState = {};
        }
    }

    function saveSeenStatusState() {
        try {
            window.localStorage.setItem(getSeenStatusStorageKey(), JSON.stringify(seenStatusState));
        } catch (error) {
            return null;
        }
    }

    function getStatusGroup(owner) {
        return statusFeed.find(function (item) {
            return item.from === owner;
        }) || null;
    }

    function getLatestStatus(group) {
        if (!group || !group.items || !group.items.length) return null;
        return group.items[group.items.length - 1];
    }

    function hasUnseenStatus(owner) {
        const group = getStatusGroup(owner);
        if (!group) return false;
        return (seenStatusState[owner] || 0) < (group.latestTime || 0);
    }

    function markStatusSeen(owner) {
        const group = getStatusGroup(owner);
        if (!group) return;
        seenStatusState[owner] = group.latestTime || Date.now();
        saveSeenStatusState();
    }

    function formatStatusMeta(status, group, index) {
        if (!status) return 'No status selected';

        const parts = [status.kind === 'video' ? 'Video' : 'Photo', formatTime(status.time)];
        if (status.kind === 'video' && status.durationSec) {
            parts.push(Math.ceil(status.durationSec) + 's');
        }
        if (group && group.items && group.items.length > 1) {
            parts.push((index + 1) + ' of ' + group.items.length);
        }
        parts.push(group && group.online ? 'online' : 'offline');
        return parts.join(' • ');
    }

    function hideStatusMedia() {
        statusViewerImage.classList.add('hidden');
        statusViewerVideo.classList.add('hidden');
        statusViewerVideo.pause();
        statusViewerVideo.removeAttribute('src');
        statusViewerVideo.load();
        statusViewerImage.removeAttribute('src');
    }

    function renderStatusList() {
        statusListEl.innerHTML = '';

        const myStatus = getStatusGroup(myName);
        clearStatusBtn.classList.toggle('hidden', !myStatus);

        if (!statusFeed.length) {
            statusListEl.innerHTML = '<div class="status-empty-pill">No statuses yet</div>';
            return;
        }

        statusFeed.forEach(function (group) {
            const latest = getLatestStatus(group);
            if (!latest) return;

            const unseen = hasUnseenStatus(group.from);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'status-item' +
                (group.from === activeStatusOwner ? ' active' : '') +
                (unseen ? ' unseen' : ' seen') +
                (group.online ? '' : ' offline');
            item.innerHTML = [
                '<span class="status-ring">',
                '<span class="status-avatar">' + escapeHtml(getAvatarLetters(group.from)) + '</span>',
                '<span class="status-kind-badge"><i class="fa ' + (latest.kind === 'video' ? 'fa-play' : 'fa-camera') + '"></i></span>',
                '</span>',
                '<span class="status-owner">' + escapeHtml(group.from) + '</span>',
                '<span class="status-meta">' + escapeHtml(group.online ? 'online' : 'offline') + '</span>',
                '<span class="status-count-badge">' + group.items.length + '</span>'
            ].join('');
            item.addEventListener('click', function () {
                openStatus(group.from, group.items.length - 1);
            });
            statusListEl.appendChild(item);
        });
    }

    function showStatusPanel() {
        welcomePane.classList.add('hidden');
        chatPanel.classList.add('hidden');
        demoPanel.classList.add('hidden');
        statusPanel.classList.remove('hidden');
    }

    function openStatus(owner, index) {
        const group = getStatusGroup(owner);
        if (!group || !group.items.length) return;

        const safeIndex = Math.min(Math.max(index || 0, 0), group.items.length - 1);
        const status = group.items[safeIndex];

        activeStatusOwner = owner;
        activeStatusIndex = safeIndex;
        markStatusSeen(owner);
        showStatusPanel();
        renderStatusList();
        statusViewerName.textContent = owner + "'s status";
        statusViewerMeta.textContent = formatStatusMeta(status, group, safeIndex);
        statusViewerCount.textContent = (safeIndex + 1) + ' / ' + group.items.length;
        statusPrevBtn.disabled = safeIndex === 0;
        statusNextBtn.disabled = safeIndex === group.items.length - 1;
        statusViewerEmpty.classList.add('hidden');
        hideStatusMedia();

        if (status.kind === 'video') {
            statusViewerVideo.src = status.fileData;
            statusViewerVideo.classList.remove('hidden');
        } else {
            statusViewerImage.src = status.fileData;
            statusViewerImage.classList.remove('hidden');
        }

        setNavLabel({
            kicker: 'CF soci Status',
            title: owner + "'s update",
            iconClass: status.kind === 'video' ? 'fa-play-circle' : 'fa-camera'
        });

        if (window.innerWidth < 768) {
            sidebar.classList.remove('open');
        }
    }

    function stepActiveStatus(delta) {
        const group = getStatusGroup(activeStatusOwner);
        if (!group) return;
        const nextIndex = activeStatusIndex + delta;
        if (nextIndex < 0 || nextIndex >= group.items.length) return;
        openStatus(activeStatusOwner, nextIndex);
    }

    function syncStatusFeed(list) {
        const previousMap = {};
        statusFeed.forEach(function (group) {
            previousMap[group.from] = group.latestTime;
        });

        const hadStatusesBefore = statusFeed.length > 0;
        statusFeed = (list || []).slice();
        renderStatusList();
        if (knownUsers.length) {
            renderUserList(knownUsers);
        }

        if (activeStatusOwner && !getStatusGroup(activeStatusOwner)) {
            activeStatusOwner = '';
            activeStatusIndex = 0;
            hideStatusMedia();
            statusViewerCount.textContent = '0 / 0';
            statusViewerEmpty.classList.remove('hidden');
            showWelcomePane();
        } else if (activeStatusOwner) {
            const activeGroup = getStatusGroup(activeStatusOwner);
            const nextIndex = Math.min(activeStatusIndex, activeGroup.items.length - 1);
            openStatus(activeStatusOwner, nextIndex);
        }

        statusFeed.forEach(function (group) {
            const latest = getLatestStatus(group);
            if (latest && group.from !== myName && hadStatusesBefore && previousMap[group.from] !== group.latestTime) {
                showToast(group.from, 'shared a new ' + (latest.kind === 'video' ? 'video' : 'photo') + ' status.');
            }
        });
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function (event) {
                resolve(event.target.result);
            };
            reader.onerror = function () {
                reject(new Error('Unable to read file.'));
            };
            reader.readAsDataURL(file);
        });
    }

    function getVideoDuration(file) {
        return new Promise(function (resolve, reject) {
            const video = document.createElement('video');
            const objectUrl = URL.createObjectURL(file);
            video.preload = 'metadata';
            video.onloadedmetadata = function () {
                const duration = video.duration || 0;
                URL.revokeObjectURL(objectUrl);
                resolve(duration);
            };
            video.onerror = function () {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Unable to read video duration.'));
            };
            video.src = objectUrl;
        });
    }

    async function shareStatus(file) {
        if (!myName) {
            Swal.fire('Sign in first');
            return;
        }

        const isImage = /^image\//i.test(file.type || '');
        const isVideo = /^video\//i.test(file.type || '');

        if (!isImage && !isVideo) {
            Swal.fire('Only images and videos can be used as status.');
            return;
        }

        if (isImage && file.size > 5 * 1024 * 1024) {
            Swal.fire('Picture too large. Maximum size is 5 MB.');
            return;
        }

        let durationSec = 0;
        if (isVideo) {
            durationSec = await getVideoDuration(file);
            if (durationSec > 120) {
                Swal.fire('Video too long. Maximum status video length is 2 minutes.');
                return;
            }
        }

        const fileData = await readFileAsDataUrl(file);
        socket.emit('status:update', {
            kind: isVideo ? 'video' : 'image',
            fileName: file.name,
            fileType: file.type,
            fileData: fileData,
            durationSec: durationSec
        });
        showToast('Status shared', 'Added a new ' + (isVideo ? 'video' : 'photo') + ' update to your status.');
    }

    function hasSecureMediaOrigin() {
        return window.isSecureContext || /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    }

    function showMobilePermissionHelp() {
        Swal.fire({
            title: 'Camera and microphone need HTTPS',
            html: [
                '<p>Phone browsers allow login and chat on HTTP, but camera and microphone access still require HTTPS.</p>',
                '<p>You can keep using chat now, or open the app over HTTPS for calls and screen demo.</p>'
            ].join(''),
            icon: 'info'
        });
    }

    function showToast(title, body) {
        const toast = document.createElement('div');
        toast.className = 'app-toast';
        toast.innerHTML = [
            '<div class="app-toast-title">' + escapeHtml(title) + '</div>',
            '<div class="app-toast-body">' + escapeHtml(body) + '</div>'
        ].join('');
        toastStack.appendChild(toast);
        window.setTimeout(function () {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(16px)';
                window.setTimeout(function () {
                    if (toast.parentNode) toast.parentNode.removeChild(toast);
                }, 220);
            }
        }, 3200);
    }

    function tryBrowserNotification(title, body) {
        if (!('Notification' in window)) return;
        if (document.visibilityState === 'visible') return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body: body });
        }
    }

    function requestNotificationPermission() {
        if (!('Notification' in window)) return;
        if (notificationPermissionAsked) return;
        notificationPermissionAsked = true;
        if (Notification.permission === 'default') {
            Notification.requestPermission().catch(function () {
                notificationPermissionAsked = true;
            });
        }
    }

    function syncMediaButtons() {
        const hasAudio = !!(localStream && localStream.getAudioTracks().length);
        const hasVideo = !!(localStream && localStream.getVideoTracks().length);

        toggleMicBtn.disabled = !hasAudio;
        toggleCamBtn.disabled = !hasVideo;

        toggleMicBtn.innerHTML = hasAudio && micEnabled
            ? '<i class="fa fa-microphone"></i>'
            : '<i class="fa fa-microphone-slash"></i>';
        toggleCamBtn.innerHTML = hasVideo && camEnabled
            ? '<i class="fa fa-video-camera"></i>'
            : '<i class="fa fa-times"></i>';

        toggleMicBtn.classList.toggle('ctrl-muted', !hasAudio || !micEnabled);
        toggleCamBtn.classList.toggle('ctrl-muted', !hasVideo || !camEnabled);
    }

    function getPreferredMediaConstraints() {
        return {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
    }

    function setLocalStream(stream) {
        localStream = stream;
        localVideo.srcObject = stream;
        micEnabled = !!(stream && stream.getAudioTracks().length);
        camEnabled = !!(stream && stream.getVideoTracks().length);
        syncMediaButtons();
    }

    async function ensureLocalMedia() {
        if (localStream && localStream.getTracks().some(function (track) { return track.readyState === 'live'; })) {
            return localStream;
        }

        if (!hasSecureMediaOrigin()) {
            throw new Error('Camera and microphone require HTTPS on phones.');
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('This browser does not support media devices.');
        }

        if (mediaRequest) {
            return mediaRequest;
        }

        const attempts = [
            { constraints: getPreferredMediaConstraints(), warning: '' },
            {
                constraints: {
                    audio: getPreferredMediaConstraints().audio,
                    video: false
                },
                warning: 'Camera unavailable. Continuing with microphone only.'
            },
            {
                constraints: {
                    audio: false,
                    video: getPreferredMediaConstraints().video
                },
                warning: 'Microphone unavailable. Continuing with camera only.'
            }
        ];

        mediaRequest = (async function () {
            let lastError = null;

            for (const attempt of attempts) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
                    setLocalStream(stream);
                    if (attempt.warning) {
                        showToast('Media access', attempt.warning);
                    }
                    return stream;
                } catch (error) {
                    lastError = error;
                }
            }

            setLocalStream(null);
            throw lastError || new Error('Unable to access camera or microphone.');
        })();

        try {
            return await mediaRequest;
        } finally {
            mediaRequest = null;
        }
    }

    function addLocalTracksToPeerConnection() {
        if (!peerConnection || !localStream) return;
        const senders = peerConnection.getSenders();
        localStream.getTracks().forEach(function (track) {
            const alreadyAdded = senders.some(function (sender) {
                return sender.track && sender.track.id === track.id;
            });
            if (!alreadyAdded) {
                peerConnection.addTrack(track, localStream);
            }
        });
    }

    async function flushPendingIceCandidates() {
        if (!peerConnection || !peerConnection.remoteDescription) return;
        const queuedCandidates = pendingIceCandidates;
        pendingIceCandidates = [];
        for (const candidate of queuedCandidates) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.warn('addIceCandidate:', error);
            }
        }
    }

    async function applyPendingRemoteOffer() {
        if (!peerConnection || !pendingRemoteOffer || applyingRemoteOffer) return;

        applyingRemoteOffer = true;
        const remoteOffer = pendingRemoteOffer;
        pendingRemoteOffer = null;

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteOffer));
            await flushPendingIceCandidates();
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', peerConnection.localDescription);
            callStatusLabel.textContent = 'Connecting...';
            setStatus('Calling', 'calling');
        } catch (error) {
            console.error('answer failed:', error);
            handleLeave();
        } finally {
            applyingRemoteOffer = false;
        }
    }

    function renderUserList(list) {
        knownUsers = list.slice();
        onlineBadge.textContent = list.filter(function (name) {
            return name !== myName;
        }).length;
        userListEl.innerHTML = '';

        list.forEach(function (name) {
            if (name === myName) return;
            const hasStatus = !!getStatusGroup(name);
            const hasUnseen = hasUnseenStatus(name);

            const li = document.createElement('li');
            li.className = 'user-item' + (name === activeChat ? ' active' : '');
            li.dataset.name = name;
            li.innerHTML = [
                '<div class="user-avatar' + (hasStatus ? ' has-status' : '') + (hasUnseen ? ' has-unseen-status' : '') + '"><i class="fa fa-user"></i></div>',
                '<div class="user-info">',
                '<span class="user-name">' + escapeHtml(name) + '</span>',
                '<span class="user-status-dot"></span>',
                '</div>'
            ].join('');
            li.addEventListener('click', function () {
                openChat(name);
            });
            userListEl.appendChild(li);
        });
    }

    function getHistory(peer) {
        if (!chatHistory[peer]) {
            chatHistory[peer] = [];
        }
        return chatHistory[peer];
    }

    function appendBubble(message, peer, save) {
        const targetPeer = peer || activeChat;
        const shouldSave = save !== false;
        if (shouldSave && targetPeer) {
            getHistory(targetPeer).push(message);
        }

        if (targetPeer !== activeChat) return;

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble ' + (message.self ? 'msg-self' : 'msg-other');
        const sender = message.self ? 'You' : escapeHtml(message.from);

        if (message.file) {
            const isImage = /^image\//i.test(message.fileType || '');
            if (isImage) {
                bubble.innerHTML = [
                    '<div class="msg-sender">' + sender + '</div>',
                    '<img src="' + message.fileData + '" class="msg-image" alt="' + escapeHtml(message.fileName) + '">',
                    '<div class="msg-meta">' + formatTime(message.time) + '</div>'
                ].join('');
                bubble.querySelector('.msg-image').addEventListener('click', function () {
                    window.open(message.fileData, '_blank');
                });
            } else {
                bubble.innerHTML = [
                    '<div class="msg-sender">' + sender + '</div>',
                    '<a class="msg-file" href="' + message.fileData + '" download="' + escapeHtml(message.fileName) + '">',
                    '<i class="fa fa-file"></i> ' + escapeHtml(message.fileName),
                    '</a>',
                    '<div class="msg-meta">' + formatTime(message.time) + '</div>'
                ].join('');
            }
        } else {
            bubble.innerHTML = [
                '<div class="msg-sender">' + sender + '</div>',
                '<div class="msg-text">' + escapeHtml(message.text) + '</div>',
                '<div class="msg-meta">' + formatTime(message.time) + '</div>'
            ].join('');
        }

        chatMessages.appendChild(bubble);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function renderChatHistory() {
        if (!activeChat) return;
        chatMessages.querySelectorAll('.msg-bubble').forEach(function (element) {
            element.remove();
        });
        getHistory(activeChat).forEach(function (message) {
            appendBubble(message, activeChat, false);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function markUnread(peerName) {
        const userItem = document.querySelector('.user-item[data-name="' + peerName + '"]');
        if (userItem && !userItem.querySelector('.unread-dot')) {
            const unreadDot = document.createElement('span');
            unreadDot.className = 'unread-dot';
            userItem.appendChild(unreadDot);
        }
    }

    function openChat(name) {
        activeChat = name;
        statusPanel.classList.add('hidden');
        activeStatusOwner = '';
        activeStatusIndex = 0;
        hideStatusMedia();
        setConversationHeader(name, 'Private thread ready for chat, files, and instant calls.');
        setNavLabel({
            kicker: 'Direct chat',
            title: name,
            dotColor: '#35d399'
        });
        welcomePane.classList.add('hidden');
        demoPanel.classList.add('hidden');
        chatPanel.classList.remove('hidden');
        document.querySelectorAll('.user-item').forEach(function (element) {
            element.classList.toggle('active', element.dataset.name === name);
        });
        const userItem = document.querySelector('.user-item[data-name="' + name + '"]');
        if (userItem) {
            const unreadDot = userItem.querySelector('.unread-dot');
            if (unreadDot) unreadDot.remove();
        }
        if (window.innerWidth < 768) {
            sidebar.classList.remove('open');
        }
        renderChatHistory();
    }

    function setNavLabel(options) {
        const kicker = escapeHtml(options.kicker || 'CF soci');
        const title = escapeHtml(options.title || 'Social workspace');
        const icon = options.iconClass
            ? '<i class="fa ' + options.iconClass + '"></i>'
            : '';
        const dot = options.dotColor
            ? '<span class="nav-presence-dot" style="background:' + options.dotColor + '"></span>'
            : '';

        chatWithLabel.innerHTML = '' +
            '<span class="nav-kicker">' + kicker + '</span>' +
            '<span class="nav-main">' + dot + icon + '<span>' + title + '</span></span>';
    }

    function setConversationHeader(name, meta) {
        chatPartyAvatar.textContent = getAvatarLetters(name);
        chatPartyName.textContent = name || 'No contact selected';
        chatPartyMeta.textContent = meta || 'Choose someone from the sidebar to start messaging or launch a call.';
    }

    function showWelcomePane() {
        welcomePane.classList.remove('hidden');
        chatPanel.classList.add('hidden');
        demoPanel.classList.add('hidden');
        statusPanel.classList.add('hidden');
        activeStatusOwner = '';
        activeStatusIndex = 0;
        hideStatusMedia();
        statusViewerEmpty.classList.remove('hidden');
        statusViewerCount.textContent = '0 / 0';
        statusPrevBtn.disabled = true;
        statusNextBtn.disabled = true;
        setConversationHeader('', 'Choose someone from the sidebar to start messaging or launch a call.');
        setNavLabel({
            kicker: 'CF soci',
            title: 'Social workspace',
            iconClass: 'fa-video-camera'
        });
    }

    function showDemoPanel() {
        welcomePane.classList.add('hidden');
        chatPanel.classList.add('hidden');
        demoPanel.classList.remove('hidden');
        statusPanel.classList.add('hidden');
        activeStatusOwner = '';
        activeStatusIndex = 0;
        hideStatusMedia();
        setNavLabel({
            kicker: 'CF soci Demo',
            title: 'Live demo room',
            iconClass: 'fa-desktop'
        });
        if (window.innerWidth < 768) {
            sidebar.classList.remove('open');
        }
    }

    function resetLoginBtn() {
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'Get Started &nbsp;<i class="fa fa-arrow-right"></i>';
    }

    async function doLogin() {
        const name = usernameInput.value.trim();
        if (!name) {
            Swal.fire('Please enter a username');
            return;
        }

        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>&nbsp; Connecting...';

        if (hasSecureMediaOrigin()) {
            loginBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>&nbsp; Requesting permissions...';
            try {
                await ensureLocalMedia();
            } catch (error) {
                if (error && error.message && error.message.indexOf('HTTPS') !== -1) {
                    showMobilePermissionHelp();
                } else {
                    showToast('Permissions not granted', 'You can still log in and chat without camera or microphone.');
                }
            }
            loginBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>&nbsp; Connecting...';
        } else {
            showToast('HTTP mode', 'Chat works on HTTP. Calls and demo screen sharing still need HTTPS on phone browsers.');
        }

        socket.emit('UserStart', { type: 'login', name: name });
        window.setTimeout(function () {
            if (loginPage.style.display !== 'none') {
                resetLoginBtn();
            }
        }, 6000);
    }

    function buildPeerConnection() {
        if (peerConnection) {
            peerConnection.onicecandidate = null;
            peerConnection.ontrack = null;
            peerConnection.close();
        }

        peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnection.onicecandidate = function (event) {
            if (event.candidate) {
                socket.emit('candidate', event.candidate);
            }
        };
        peerConnection.ontrack = function (event) {
            remoteVideo.srcObject = event.streams[0];
            callStatusLabel.textContent = 'Connected';
            setStatus('Connected', 'connected');
        };
        peerConnection.onconnectionstatechange = function () {
            if (!peerConnection) return;
            const state = peerConnection.connectionState;
            if (state === 'connecting') {
                callStatusLabel.textContent = 'Connecting...';
                setStatus('Calling', 'calling');
            }
            if (state === 'connected') {
                callStatusLabel.textContent = 'Connected';
                setStatus('Connected', 'connected');
            }
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                handleLeave();
            }
        };
        peerConnection.oniceconnectionstatechange = function () {
            const state = peerConnection.iceConnectionState;
            if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                handleLeave();
            }
        };
        peerConnection.onicecandidateerror = function () {
            callStatusLabel.textContent = 'Network issue detected';
        };

        addLocalTracksToPeerConnection();
    }

    function showVideoOverlay(name) {
        activeCallPeer = name;
        callWithLabel.textContent = name;
        videoOverlay.classList.remove('hidden');
    }

    function hideVideoOverlay() {
        activeCallPeer = '';
        videoOverlay.classList.add('hidden');
        callStatusLabel.textContent = 'Connecting...';
        callWithLabel.textContent = '';
        if (myName) {
            setStatus('Online', 'connected');
        }
    }

    function clearChatAndSession() {
        Object.keys(chatHistory).forEach(function (key) {
            delete chatHistory[key];
        });
        chatMessages.querySelectorAll('.msg-bubble').forEach(function (element) {
            element.remove();
        });
        typingIndicator.textContent = '';
        activeChat = '';
    }

    function handleLeave() {
        if (peerConnection) {
            peerConnection.onicecandidate = null;
            peerConnection.ontrack = null;
            peerConnection.onconnectionstatechange = null;
            peerConnection.close();
            peerConnection = null;
        }
        pendingRemoteOffer = null;
        pendingIceCandidates = [];
        remoteVideo.srcObject = null;
        hideVideoOverlay();
    }

    function clearDemoFrame() {
        demoFrameImage.src = '';
        demoFrameImage.classList.add('hidden');
        demoEmptyState.classList.remove('hidden');
    }

    function renderDemoQuestions() {
        demoQuestionList.innerHTML = '';
        demoQuestionCount.textContent = String(demoQuestions.length);

        if (!demoQuestions.length) {
            const empty = document.createElement('div');
            empty.className = 'demo-question-item';
            empty.innerHTML = [
                '<div class="demo-question-meta"><span>Audience</span><span>Waiting</span></div>',
                '<div>No questions yet. Ask one when the demo begins.</div>'
            ].join('');
            demoQuestionList.appendChild(empty);
            return;
        }

        demoQuestions.forEach(function (question) {
            const item = document.createElement('div');
            item.className = 'demo-question-item';
            item.innerHTML = [
                '<div class="demo-question-meta"><span>' + escapeHtml(question.from) + '</span><span>' + formatTime(question.time) + '</span></div>',
                '<div>' + escapeHtml(question.text) + '</div>'
            ].join('');
            demoQuestionList.appendChild(item);
        });
        demoQuestionList.scrollTop = demoQuestionList.scrollHeight;
    }

    function renderRaisedHands() {
        demoRaisedList.innerHTML = '';
        demoRaisedCount.textContent = String(demoRaisedHands.length);
        demoHandsChip.textContent = 'Hands: ' + demoRaisedHands.length;

        if (!demoRaisedHands.length) {
            const empty = document.createElement('div');
            empty.className = 'demo-question-item';
            empty.innerHTML = [
                '<div class="demo-question-meta"><span>Audience</span><span>Quiet</span></div>',
                '<div>No hands raised right now.</div>'
            ].join('');
            demoRaisedList.appendChild(empty);
            return;
        }

        demoRaisedHands.forEach(function (name) {
            const item = document.createElement('div');
            item.className = 'demo-raised-item';
            item.innerHTML = '<i class="fa fa-hand-paper-o"></i><span>' + escapeHtml(name) + '</span>';
            demoRaisedList.appendChild(item);
        });
    }

    function syncDemoUI() {
        const isPresenter = demoState.presenter === myName;
        demoLivePill.classList.toggle('hidden', !demoState.active);
        startDemoBtn.classList.toggle('hidden', demoState.active);
        stopDemoBtn.classList.toggle('hidden', !(demoState.active && isPresenter));
        demoQuestionBtn.disabled = !demoState.active;
        demoQuestionInput.disabled = !demoState.active;
        raiseHandBtn.disabled = !demoState.active || isPresenter;
        raiseHandBtn.classList.toggle('is-active', hasRaisedHand);
        demoPresenterChip.textContent = 'Presenter: ' + (demoState.presenter || 'waiting');

        if (demoState.active) {
            demoTitle.textContent = demoState.title || (demoState.presenter ? demoState.presenter + "'s Demo" : 'Live Demo');
            demoSubtitle.textContent = demoState.presenter
                ? demoState.presenter + ' is sharing now. Ask questions in the panel.'
                : 'A live demo is in progress.';
        } else {
            demoTitle.textContent = 'No live demo yet';
            demoSubtitle.textContent = 'Open a demo to share your screen with everyone and collect questions live.';
            clearDemoFrame();
            demoQuestions = [];
            demoRaisedHands = [];
            hasRaisedHand = false;
            renderDemoQuestions();
        }

        renderRaisedHands();
    }

    function stopDemoCapture() {
        if (demoFrameTimer) {
            window.clearInterval(demoFrameTimer);
            demoFrameTimer = null;
        }
        if (demoScreenStream) {
            demoScreenStream.getTracks().forEach(function (track) {
                track.stop();
            });
            demoScreenStream = null;
        }
        demoCanvas = null;
        demoVideo = null;
    }

    function pushDemoFrame(frameDataUrl) {
        demoFrameImage.src = frameDataUrl;
        demoFrameImage.classList.remove('hidden');
        demoEmptyState.classList.add('hidden');
    }

    function getDemoFrameSize(videoWidth, videoHeight) {
        const safeWidth = videoWidth || 1280;
        const safeHeight = videoHeight || 720;
        const widthRatio = demoCaptureConfig.maxWidth / safeWidth;
        const heightRatio = demoCaptureConfig.maxHeight / safeHeight;
        const scale = Math.min(widthRatio, heightRatio, 1);

        return {
            width: Math.max(320, Math.round(safeWidth * scale)),
            height: Math.max(180, Math.round(safeHeight * scale))
        };
    }

    async function startDemoSession() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            Swal.fire('This browser does not support screen sharing.');
            return;
        }
        if (!hasSecureMediaOrigin()) {
            Swal.fire('Screen sharing requires HTTPS on phone browsers.');
            return;
        }
        if (demoState.active && demoState.presenter && demoState.presenter !== myName) {
            Swal.fire('Another demo is already live.');
            return;
        }

        try {
            demoScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        } catch (error) {
            Swal.fire('Screen share was cancelled or blocked.');
            return;
        }

        demoCanvas = document.createElement('canvas');
        demoVideo = document.createElement('video');
        demoVideo.autoplay = true;
        demoVideo.muted = true;
        demoVideo.playsInline = true;
        demoVideo.srcObject = demoScreenStream;

        demoScreenStream.getVideoTracks()[0].addEventListener('ended', function () {
            socket.emit('demo:stop');
            stopDemoCapture();
        });

        socket.emit('demo:start', {
            title: myName + "'s Demo"
        });

        demoFrameTimer = window.setInterval(function () {
            if (!demoVideo || demoVideo.readyState < 2) return;
            const frameSize = getDemoFrameSize(demoVideo.videoWidth, demoVideo.videoHeight);
            const width = frameSize.width;
            const height = frameSize.height;
            demoCanvas.width = width;
            demoCanvas.height = height;
            const context = demoCanvas.getContext('2d');
            context.drawImage(demoVideo, 0, 0, width, height);
            const frame = demoCanvas.toDataURL(demoCaptureConfig.format, demoCaptureConfig.quality);
            pushDemoFrame(frame);
            socket.emit('demo:frame', { frame: frame });
        }, demoCaptureConfig.intervalMs);

        showDemoPanel();
    }

    function stopDemoSession() {
        if (demoState.presenter === myName) {
            socket.emit('demo:stop');
        }
        stopDemoCapture();
    }

    function toggleRaisedHand() {
        if (!demoState.active || demoState.presenter === myName) return;
        hasRaisedHand = !hasRaisedHand;
        socket.emit('demo:raise-hand', { raised: hasRaisedHand });
        syncDemoUI();
    }

    function toggleDemoFullscreen() {
        if (!document.fullscreenElement) {
            if (demoScreenShell.requestFullscreen) {
                demoScreenShell.requestFullscreen().catch(function () {
                    return null;
                });
            }
            return;
        }

        if (document.exitFullscreen) {
            document.exitFullscreen().catch(function () {
                return null;
            });
        }
    }

    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || !activeChat) return;
        chatInput.value = '';
        const message = { from: myName, text: text, time: Date.now(), self: true };
        socket.emit('chatMessage', { to: activeChat, text: text });
        appendBubble(message, activeChat, true);
    }

    function sendFile(file) {
        if (!activeChat) {
            Swal.fire('Open a chat first');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            Swal.fire('File too large. Max 10 MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function (event) {
            const message = {
                from: myName,
                file: true,
                fileName: file.name,
                fileType: file.type,
                fileData: event.target.result,
                time: Date.now(),
                self: true
            };
            socket.emit('fileTransfer', {
                to: activeChat,
                fileName: file.name,
                fileType: file.type,
                fileData: event.target.result
            });
            appendBubble(message, activeChat, true);
        };
        reader.readAsDataURL(file);
    }

    window.handleDrop = function handleDrop(event) {
        event.preventDefault();
        dropHint.style.display = 'none';
        if (!activeChat) {
            Swal.fire('Open a chat first');
            return;
        }
        const file = event.dataTransfer.files[0];
        if (file) sendFile(file);
    };

    function handleIncomingCall(from) {
        Swal.fire({
            title: from + ' is calling...',
            text: 'Answer to join the video call.',
            showCancelButton: true,
            confirmButtonText: 'Answer',
            cancelButtonText: 'Decline',
            allowOutsideClick: false
        }).then(async function (result) {
            if (!result.value) {
                socket.emit('UserStart', { type: 'leave', name: from });
                pendingRemoteOffer = null;
                pendingIceCandidates = [];
                return;
            }

            openChat(from);

            try {
                await ensureLocalMedia();
            } catch (error) {
                if (error && error.message && error.message.indexOf('HTTPS') !== -1) {
                    showMobilePermissionHelp();
                } else {
                    Swal.fire('Camera or microphone not available. Check browser permissions.');
                }
                socket.emit('UserStart', { type: 'leave', name: from });
                return;
            }

            buildPeerConnection();
            showVideoOverlay(from);
            callStatusLabel.textContent = pendingRemoteOffer ? 'Connecting...' : 'Waiting for call data...';
            setStatus('Calling', 'calling');
            await applyPendingRemoteOffer();
        });
    }

    loginBtn.addEventListener('click', doLogin);
    usernameInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') doLogin();
    });

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }

        if (!activeChat) return;
        if (!isTyping) {
            isTyping = true;
            socket.emit('typing', { to: activeChat, typing: true });
        }
        window.clearTimeout(typingTimer);
        typingTimer = window.setTimeout(function () {
            isTyping = false;
            socket.emit('typing', { to: activeChat, typing: false });
        }, 1500);
    });

    fileInput.addEventListener('change', function () {
        if (fileInput.files.length) sendFile(fileInput.files[0]);
        fileInput.value = '';
    });

    addStatusBtn.addEventListener('click', function () {
        statusInput.click();
    });

    clearStatusBtn.addEventListener('click', function () {
        socket.emit('status:clear');
        if (activeStatusOwner === myName) {
            showWelcomePane();
        }
    });

    statusInput.addEventListener('change', async function () {
        try {
            if (statusInput.files.length) {
                await shareStatus(statusInput.files[0]);
            }
        } catch (error) {
            Swal.fire(error && error.message ? error.message : 'Unable to share status.');
        } finally {
            statusInput.value = '';
        }
    });

    chatMessages.addEventListener('dragover', function () {
        dropHint.style.display = 'flex';
    });
    chatMessages.addEventListener('dragleave', function () {
        dropHint.style.display = 'none';
    });

    callBtn.addEventListener('click', async function () {
        if (!activeChat) {
            Swal.fire('Select a user to call');
            return;
        }
        try {
            await ensureLocalMedia();
        } catch (error) {
            if (error && error.message && error.message.indexOf('HTTPS') !== -1) {
                showMobilePermissionHelp();
            } else {
                Swal.fire('Camera or microphone not available. Check browser permissions.');
            }
            return;
        }
        buildPeerConnection();
        showVideoOverlay(activeChat);
        callStatusLabel.textContent = 'Calling...';
        setStatus('Calling', 'calling');
        peerConnection.createOffer()
            .then(function (sdp) {
                return peerConnection.setLocalDescription(sdp);
            })
            .then(function () {
                socket.emit('UserStart', { type: 'offer', name: activeChat });
                socket.emit('msg', peerConnection.localDescription);
            })
            .catch(function (error) {
                console.error('createOffer failed:', error);
                handleLeave();
            });
    });

    hangUpBtn.addEventListener('click', function () {
        if (activeChat) {
            socket.emit('UserStart', { type: 'leave', name: activeChat });
        }
        handleLeave();
    });

    toggleMicBtn.addEventListener('click', function () {
        if (!localStream || !localStream.getAudioTracks().length) return;
        micEnabled = !micEnabled;
        localStream.getAudioTracks().forEach(function (track) {
            track.enabled = micEnabled;
        });
        syncMediaButtons();
    });

    toggleCamBtn.addEventListener('click', function () {
        if (!localStream || !localStream.getVideoTracks().length) return;
        camEnabled = !camEnabled;
        localStream.getVideoTracks().forEach(function (track) {
            track.enabled = camEnabled;
        });
        syncMediaButtons();
    });

    sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('open');
    });

    sidebarClose.addEventListener('click', function () {
        sidebar.classList.remove('open');
    });

    demoToggleBtn.addEventListener('click', function () {
        showDemoPanel();
    });

    statusPrevBtn.addEventListener('click', function () {
        stepActiveStatus(-1);
    });

    statusNextBtn.addEventListener('click', function () {
        stepActiveStatus(1);
    });

    closeStatusBtn.addEventListener('click', function () {
        if (activeChat) {
            openChat(activeChat);
            return;
        }
        showWelcomePane();
    });

    closeDemoBtn.addEventListener('click', function () {
        if (activeChat) {
            chatPanel.classList.remove('hidden');
            demoPanel.classList.add('hidden');
            statusPanel.classList.add('hidden');
            welcomePane.classList.add('hidden');
            setNavLabel({
                kicker: 'Direct chat',
                title: activeChat,
                dotColor: '#35d399'
            });
        } else {
            showWelcomePane();
        }
    });

    startDemoBtn.addEventListener('click', function () {
        startDemoSession();
    });

    stopDemoBtn.addEventListener('click', function () {
        stopDemoSession();
    });

    raiseHandBtn.addEventListener('click', function () {
        toggleRaisedHand();
    });

    demoFullscreenBtn.addEventListener('click', function () {
        toggleDemoFullscreen();
    });

    demoQuestionBtn.addEventListener('click', function () {
        const text = demoQuestionInput.value.trim();
        if (!text || !demoState.active) return;
        socket.emit('demo:question', { text: text });
        demoQuestionInput.value = '';
    });

    demoQuestionInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            demoQuestionBtn.click();
        }
    });

    socket.on('connect_error', function () {
        resetLoginBtn();
        setStatus('Offline', '');
    });

    socket.on('message', function (data) {
        switch (data.type) {
            case 'login':
                handleLogin(data.success);
                break;
            case 'offer':
                handleIncomingCall(data.from);
                break;
            case 'leave':
                if (activeCallPeer) {
                    showToast('Call ended', activeCallPeer + ' left the call.');
                }
                handleLeave();
                break;
            case 'invalid':
                Swal.fire('User not found on the server');
                handleLeave();
                break;
            case 'errr':
                console.warn('Server error:', data.message);
                break;
            default:
                break;
        }
    });

    function handleLogin(success) {
        if (!success) {
            resetLoginBtn();
            Swal.fire('Username already taken. Try another.');
            return;
        }

        myName = usernameInput.value.trim();
        myNameLabel.textContent = myName;
        loadSeenStatusState();
        loginPage.style.display = 'none';
        appPage.classList.add('active');
        setStatus('Online', 'connected');
        requestNotificationPermission();
        syncDemoUI();
        if (!localStream && hasSecureMediaOrigin()) {
            ensureLocalMedia().catch(function () {
                return null;
            });
        }
    }

    socket.on('userList', function (list) {
        renderUserList(list);
    });

    socket.on('status:list', function (list) {
        syncStatusFeed(list);
    });

    socket.on('chatMessage', function (data) {
        if (data.self) return;

        const message = {
            from: data.from,
            text: data.text,
            time: data.time,
            self: false
        };
        appendBubble(message, data.from, true);

        if (data.from !== activeChat) {
            markUnread(data.from);
            showToast(data.from, data.text);
            tryBrowserNotification(data.from, data.text);
        }
    });

    socket.on('typing', function (data) {
        if (data.from !== activeChat) return;
        typingIndicator.textContent = data.typing ? data.from + ' is typing...' : '';
    });

    socket.on('fileTransfer', function (data) {
        const message = {
            from: data.from,
            file: true,
            fileName: data.fileName,
            fileType: data.fileType,
            fileData: data.fileData,
            time: data.time,
            self: false
        };
        appendBubble(message, data.from, true);
        if (data.from !== activeChat) {
            markUnread(data.from);
            showToast(data.from, 'sent a file: ' + data.fileName);
            tryBrowserNotification(data.from, 'sent a file: ' + data.fileName);
        }
    });

    socket.on('offer', function (sdp) {
        pendingRemoteOffer = sdp;
        applyPendingRemoteOffer();
    });

    socket.on('Reanswer', function (sdp) {
        if (!peerConnection) return;
        peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
            .then(function () {
                return flushPendingIceCandidates();
            })
            .catch(function (error) {
                console.error('setRemoteDescription failed:', error);
            });
    });

    socket.on('candidate', function (candidate) {
        if (!peerConnection || !peerConnection.remoteDescription) {
            pendingIceCandidates.push(candidate);
            return;
        }
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(function (error) {
            console.warn('addIceCandidate:', error);
        });
    });

    socket.on('demo:state', function (state) {
        demoState = state || { active: false, presenter: null, title: '', startedAt: null, raisedHands: [] };
        demoRaisedHands = (demoState.raisedHands || []).slice();
        hasRaisedHand = demoRaisedHands.indexOf(myName) !== -1;
        syncDemoUI();
    });

    socket.on('demo:started', function (state) {
        demoState = state;
        demoQuestions = [];
        demoRaisedHands = (state.raisedHands || []).slice();
        hasRaisedHand = demoRaisedHands.indexOf(myName) !== -1;
        renderDemoQuestions();
        syncDemoUI();
        showToast('Demo started', (state.presenter || 'Someone') + ' started a live demo.');
    });

    socket.on('demo:frame', function (payload) {
        if (!payload || !payload.frame) return;
        pushDemoFrame(payload.frame);
    });

    socket.on('demo:question', function (question) {
        demoQuestions.push(question);
        renderDemoQuestions();
        if (question.from !== myName) {
            showToast('New question', question.from + ': ' + question.text);
        }
    });

    socket.on('demo:hands', function (payload) {
        demoRaisedHands = (payload && payload.raisedHands ? payload.raisedHands : []).slice();
        hasRaisedHand = demoRaisedHands.indexOf(myName) !== -1;
        renderRaisedHands();
        syncDemoUI();
        if (payload && payload.from && payload.from !== myName) {
            showToast('Hand raised', payload.from + (payload.raised ? ' raised a hand.' : ' lowered their hand.'));
        }
    });

    socket.on('demo:stopped', function (payload) {
        const presenter = payload && payload.presenter ? payload.presenter : 'Presenter';
        if (presenter === myName) {
            stopDemoCapture();
        }
        demoState = { active: false, presenter: null, title: '', startedAt: null, raisedHands: [] };
        demoRaisedHands = [];
        hasRaisedHand = false;
        syncDemoUI();
        showToast('Demo ended', presenter + ' ended the live demo.');
    });

    socket.on('demo:error', function (payload) {
        const message = payload && payload.message ? payload.message : 'Unable to start demo.';
        Swal.fire(message);
        stopDemoCapture();
    });

    socket.on('disconnect', function () {
        setStatus('Offline', '');
        handleLeave();
        stopDemoCapture();
        clearChatAndSession();
        demoState = { active: false, presenter: null, title: '', startedAt: null, raisedHands: [] };
        demoQuestions = [];
        demoRaisedHands = [];
        hasRaisedHand = false;
        statusFeed = [];
        knownUsers = [];
        activeStatusOwner = '';
        activeStatusIndex = 0;
        renderStatusList();
        hideStatusMedia();
        statusViewerEmpty.classList.remove('hidden');
        statusViewerCount.textContent = '0 / 0';
        syncDemoUI();
        renderUserList([]);
        appPage.classList.remove('active');
        loginPage.style.display = '';
        resetLoginBtn();
        myName = '';
        if (localStream) {
            localStream.getTracks().forEach(function (track) {
                track.stop();
            });
            setLocalStream(null);
        }
        showWelcomePane();
        Swal.fire('Disconnected. Please sign in again.');
    });

    window.addEventListener('beforeunload', function () {
        stopDemoCapture();
        socket.disconnect();
    });

    syncMediaButtons();
    syncDemoUI();
    renderDemoQuestions();
    renderRaisedHands();
    showWelcomePane();
});
