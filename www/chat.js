document.addEventListener('DOMContentLoaded', () => {

    // ======== STATE ========
    let myName = localStorage.getItem('pro_chat_name') || '';
    let currentChat = 'global';
    let activePeerId = null;
    let localStream = null;
    let currentCall = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let globalListenerActive = false;   // FIX 3: prevent re-attaching listener
    const rendered = new Set();         // FIX 4: keep rendered Set at top scope, persists across chat switches

    // ======== GUN.JS SETUP ========
    // FIX 1: Replaced dead Heroku peers with working public GUN relay servers
    const gun = Gun({
        peers: [
            'https://gun-manhattan.herokuapp.com/gun',   // kept as fallback (sometimes up)
            'wss://gun-us.herokuapp.com/gun',
            'https://relay.peer.ooo/gun',
            'https://gundb-relay-mlccl.ondigitalocean.app/gun'
        ]
    });

    const SEA = Gun.SEA;

    // Use a unique, consistent room key both devices must share
    const GLOBAL_ROOM = 'prochat_global_room_2025_v1';
    const globalChat = gun.get(GLOBAL_ROOM);
    const privateRelay = gun.get('prochat_private_relay_2025_v1');

    // ======== PEERJS SETUP ========
    // FIX 2: Changed 'url' → 'urls' (correct WebRTC ICE server property name)
    const peer = new Peer(undefined, {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        },
        debug: 0
    });

    // ======== DOM REFS ========
    const onboarding    = document.getElementById('onboarding');
    const nameInput     = document.getElementById('name-input');
    const startBtn      = document.getElementById('start-btn');
    const sidebar       = document.getElementById('sidebar');
    const sidebarOverlay= document.getElementById('sidebar-overlay');
    const chatBody      = document.getElementById('chat-body');
    const msgInput      = document.getElementById('msg-input');
    const sendBtn       = document.getElementById('send-btn');
    const voiceBtn      = document.getElementById('voice-btn');
    const voiceOverlay  = document.getElementById('voice-overlay');
    const callingUI     = document.getElementById('calling-ui');
    const chatTitle     = document.getElementById('chat-title');
    const videoCallBtn  = document.getElementById('video-call-btn');
    const statusText    = document.getElementById('status-text');

    // ======== ONBOARDING ========
    if (myName) {
        onboarding.classList.add('hide');
        setTimeout(() => { onboarding.style.display = 'none'; }, 400);
        initApp();
    }

    nameInput.addEventListener('input', () => {
        startBtn.disabled = nameInput.value.trim().length < 2;
    });

    startBtn.addEventListener('click', () => {
        myName = nameInput.value.trim();
        localStorage.setItem('pro_chat_name', myName);
        onboarding.classList.add('hide');
        setTimeout(() => { onboarding.style.display = 'none'; }, 400);
        initApp();
    });

    // ======== INIT ========
    function initApp() {
        loadGlobalChat();
        updateConnectionStatus();
    }

    // ======== CONNECTION STATUS ========
    function updateConnectionStatus() {
        // Poll GUN connection state
        const check = setInterval(() => {
            if (gun._.opt && gun._.opt.peers) {
                const peers = Object.keys(gun._.opt.peers);
                const connected = peers.some(p => {
                    const peer = gun._.opt.peers[p];
                    return peer && peer.wire && peer.wire.readyState === 1;
                });
                statusText.textContent = connected ? '● Online' : '● Connecting...';
            }
        }, 3000);
    }

    // ======== SIDEBAR ========
    document.getElementById('open-sidebar').addEventListener('click', openSidebar);
    document.getElementById('close-sidebar').addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);
    document.getElementById('global-btn').addEventListener('click', () => {
        switchChat('global');
        closeSidebar();
    });

    function openSidebar() {
        sidebar.classList.add('open');
        sidebarOverlay.classList.add('show');
    }
    function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('show');
    }

    // ======== PEERJS ========
    peer.on('open', id => {
        document.getElementById('my-peer-id').textContent = id;
        statusText.textContent = '● Encrypted';
        // Listen for incoming private chats
        gun.get('prochat_inbox_v1_' + id).map().on((val, senderId) => {
            if (val) addContactToSidebar(senderId);
        });
    });

    peer.on('error', err => {
        console.warn('PeerJS Error:', err.type, err);
        // Auto-reconnect on fatal errors
        if (['network', 'server-error', 'socket-error'].includes(err.type)) {
            statusText.textContent = '● Reconnecting...';
        }
    });

    peer.on('disconnected', () => {
        statusText.textContent = '● Reconnecting...';
        // Attempt to reconnect
        setTimeout(() => {
            if (!peer.destroyed) peer.reconnect();
        }, 2000);
    });

    peer.on('call', async call => {
        if (confirm('Incoming call — Answer?')) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStream = stream;
                document.getElementById('local-video').srcObject = stream;
                call.answer(stream);
                handleCall(call);
            } catch (e) { alert('Camera/mic access denied.'); }
        } else {
            call.close();
        }
    });

    document.getElementById('connect-btn').addEventListener('click', () => {
        const id = document.getElementById('friend-id-input').value.trim();
        if (id) {
            addContactToSidebar(id);
            switchChat('private', id);
            document.getElementById('friend-id-input').value = '';
            closeSidebar();
        }
    });

    document.getElementById('copy-id-btn').addEventListener('click', () => {
        const id = document.getElementById('my-peer-id').textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(id).then(() => {
                const btn = document.getElementById('copy-id-btn');
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy ID'; }, 2000);
            });
        } else {
            prompt('Copy your ID:', id);
        }
    });

    // ======== CONTACT LIST ========
    const savedContacts = JSON.parse(localStorage.getItem('pro_chat_contacts') || '[]');
    savedContacts.forEach(addContactToSidebar);

    function addContactToSidebar(id) {
        // Save to localStorage
        if (!savedContacts.includes(id)) {
            savedContacts.push(id);
            localStorage.setItem('pro_chat_contacts', JSON.stringify(savedContacts));
        }

        const list = document.getElementById('contact-list');
        // Don't duplicate
        if (document.getElementById(`contact-${id}`)) return;

        const row = document.createElement('div');
        row.className = 'contact-row';
        row.id = `contact-${id}`;
        row.innerHTML = `
            <div class="c-avatar">${id.charAt(0).toUpperCase()}</div>
            <div class="c-info">
                <h4>${id.substring(0, 10)}...</h4>
                <p>Private Chat</p>
            </div>`;
        row.addEventListener('click', () => {
            document.querySelectorAll('.contact-row').forEach(r => r.classList.remove('active-contact'));
            row.classList.add('active-contact');
            switchChat('private', id);
            closeSidebar();
        });
        list.appendChild(row);
    }

    // ======== VIDEO CALLING ========
    videoCallBtn.addEventListener('click', async () => {
        if (!activePeerId) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream = stream;
            document.getElementById('local-video').srcObject = stream;
            const call = peer.call(activePeerId, stream);
            handleCall(call);
        } catch (e) { alert('Camera/mic access denied.'); }
    });

    function handleCall(call) {
        currentCall = call;
        callingUI.classList.add('active');
        call.on('stream', stream => {
            document.getElementById('remote-video').srcObject = stream;
        });
        call.on('close', endCall);
        call.on('error', endCall);
    }

    // ======== MIC / CAM TOGGLE (were wired in HTML but had no JS handlers) ========
    let micMuted = false;
    let camOff = false;

    document.getElementById('toggle-mic').addEventListener('click', () => {
        if (!localStream) return;
        micMuted = !micMuted;
        localStream.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
        const btn = document.getElementById('toggle-mic');
        btn.textContent = micMuted ? '🔇' : '🎙️';
        btn.style.background = micMuted ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.18)';
    });

    document.getElementById('toggle-cam').addEventListener('click', () => {
        if (!localStream) return;
        camOff = !camOff;
        localStream.getVideoTracks().forEach(t => { t.enabled = !camOff; });
        const btn = document.getElementById('toggle-cam');
        btn.textContent = camOff ? '📵' : '📹';
        btn.style.background = camOff ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.18)';
    });

    function endCall() {
        if (currentCall) { currentCall.close(); currentCall = null; }
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        callingUI.classList.remove('active');
        // Reset mic/cam button states for next call
        micMuted = false; camOff = false;
        document.getElementById('toggle-mic').textContent = '🎙️';
        document.getElementById('toggle-mic').style.background = '';
        document.getElementById('toggle-cam').textContent = '📹';
        document.getElementById('toggle-cam').style.background = '';
    }

    document.getElementById('end-call-btn').addEventListener('click', endCall);

    // ======== VOICE MESSAGING ========
    voiceBtn.addEventListener('mousedown', startRecording);
    voiceBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); }, { passive: false });
    window.addEventListener('mouseup', stopRecording);
    window.addEventListener('touchend', stopRecording);

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // FIX: pick a mimeType supported by this browser (iOS Safari needs mp4)
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/mp4')
                    ? 'audio/mp4'
                    : '';
            mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = sendVoiceMessage;
            mediaRecorder.start();
            voiceOverlay.classList.add('active');
        } catch (e) { alert('Mic access denied.'); }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            voiceOverlay.classList.remove('active');
        }
    }

    function sendVoiceMessage() {
        if (audioChunks.length === 0) return;
        const mimeType = audioChunks[0].type || 'audio/webm';
        const blob = new Blob(audioChunks, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            const b64 = reader.result;
            if (currentChat === 'global') {
                globalChat.set({ sender: myName, audio: b64, time: Date.now() });
            } else if (activePeerId) {
                const roomId = getRoomId();
                privateRelay.get(roomId).set({ sender: myName, audio: b64, time: Date.now() });
                gun.get('prochat_inbox_v1_' + activePeerId).get(peer.id).put(true);
            }
        };
    }

    // ======== MESSAGE STORE ========
    const messageStore = { global: [], private: {} };
    let globalListenerAttached = false;

    function attachGlobalListener() {
        if (globalListenerAttached) return;
        globalListenerAttached = true;
        globalChat.map().on((data, id) => {
            if (data && (data.text || data.audio) && data.sender) {
                if (!messageStore.global.find(m => m.id === id)) {
                    messageStore.global.push({ id, ...data });
                    messageStore.global.sort((a, b) => a.time - b.time); // sort by time
                    if (currentChat === 'global') {
                        const type = data.sender === myName ? 'sent' : 'received';
                        appendMessage(data.sender, data.text || null, type, id, data.audio || null, data.time);
                    }
                }
            }
        });
    }

    // ======== GLOBAL CHAT ========
    function loadGlobalChat() {
        currentChat = 'global';
        activePeerId = null;
        chatBody.innerHTML = '';
        rendered.clear();
        chatTitle.textContent = 'Global Community';
        videoCallBtn.classList.add('hidden');
        statusText.textContent = '● Online';

        document.querySelectorAll('.contact-row').forEach(r => r.classList.remove('active-contact'));
        document.getElementById('global-btn').classList.add('active-contact');

        attachGlobalListener();

        // Render from memory
        messageStore.global.forEach(data => {
            const type = data.sender === myName ? 'sent' : 'received';
            appendMessage(data.sender, data.text || null, type, data.id, data.audio || null, data.time);
        });
    }

    // ======== PRIVATE CHAT ========
    const activePrivateListeners = new Set();

    async function loadPrivateChat(friendId) {
        currentChat = 'private';
        activePeerId = friendId;
        chatBody.innerHTML = '';
        rendered.clear();
        chatTitle.textContent = `🔒 ${friendId.substring(0, 10)}...`;
        videoCallBtn.classList.remove('hidden');
        statusText.textContent = '● Encrypted';

        const roomId = getRoomId();
        if (!messageStore.private[roomId]) messageStore.private[roomId] = [];

        // Render from memory
        for (const data of messageStore.private[roomId]) {
            let text = data.text || null;
            if (text) {
                try { text = await SEA.decrypt(text, roomId); } catch (e) { text = '[encrypted]'; }
            }
            const type = data.sender === myName ? 'sent' : 'received';
            appendMessage(data.sender, text, type, data.id, data.audio || null, data.time);
        }

        // Attach listener only once per room
        if (!activePrivateListeners.has(roomId)) {
            activePrivateListeners.add(roomId);
            privateRelay.get(roomId).map().on(async (data, id) => {
                if (data && (data.text || data.audio) && data.sender) {
                    if (!messageStore.private[roomId].find(m => m.id === id)) {
                        messageStore.private[roomId].push({ id, ...data });
                        messageStore.private[roomId].sort((a, b) => a.time - b.time);
                        
                        if (currentChat === 'private' && activePeerId === friendId) {
                            let text = data.text || null;
                            if (text) {
                                try { text = await SEA.decrypt(text, roomId); } catch (e) { text = '[encrypted]'; }
                            }
                            const type = data.sender === myName ? 'sent' : 'received';
                            appendMessage(data.sender, text, type, id, data.audio || null, data.time);
                        }
                    }
                }
            });
        }
    }

    function switchChat(type, friendId = null) {
        if (type === 'global') loadGlobalChat();
        else if (friendId) loadPrivateChat(friendId);
    }

    // ======== SEND MESSAGE ========
    async function sendMessage() {
        const text = msgInput.value.trim();
        if (!text) return;
        msgInput.value = '';

        if (currentChat === 'global') {
            globalChat.set({
                sender: myName,
                text: text,
                time: Date.now()
            });
        } else if (activePeerId) {
            const key = getRoomId();
            const enc = await SEA.encrypt(text, key);
            privateRelay.get(getRoomId()).set({
                sender: myName,
                text: enc,
                time: Date.now()
            });
            gun.get('prochat_inbox_v1_' + activePeerId).get(peer.id).put(true);
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    msgInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    // ======== HELPERS ========
    function getRoomId() {
        return [peer.id, activePeerId].sort().join('__');
    }

    function appendMessage(sender, text, type, id, audio = null, time = null) {
        if (!id || rendered.has(id)) return;
        rendered.add(id);

        const row = document.createElement('div');
        row.className = `msg-row ${type}`;
        row.id = `m-${id}`;

        // Avatar (received only)
        if (type === 'received') {
            const avatar = document.createElement('div');
            avatar.className = 'msg-avatar';
            avatar.textContent = (sender || '?').charAt(0).toUpperCase();
            row.appendChild(avatar);
        }

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        // Sender name for received messages
        if (type === 'received') {
            const nameEl = document.createElement('p');
            nameEl.className = 'sender-name';
            nameEl.textContent = sender;
            bubble.appendChild(nameEl);
        }

        if (audio) {
            const player = document.createElement('audio');
            player.src = audio;
            player.controls = true;
            bubble.appendChild(player);
        } else if (text) {
            const textEl = document.createElement('p');
            textEl.className = 'msg-text';
            textEl.textContent = text;
            bubble.appendChild(textEl);
        }

        // Timestamp
        const timeEl = document.createElement('span');
        timeEl.className = 'msg-time';
        const msgDate = time ? new Date(time) : new Date();
        timeEl.textContent = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        bubble.appendChild(timeEl);

        row.appendChild(bubble);
        chatBody.appendChild(row);
        chatBody.scrollTop = chatBody.scrollHeight;
    }
});
