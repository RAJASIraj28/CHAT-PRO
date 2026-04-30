document.addEventListener('DOMContentLoaded', () => {

    // ======== STATE ========
    let myName = localStorage.getItem('pro_chat_name') || '';
    let currentChat = 'global'; // 'global' or 'private'
    let activePeerId = null;
    let localStream = null;
    let currentCall = null;
    let mediaRecorder = null;
    let audioChunks = [];

    // ======== GUN.JS SETUP ========
    const gun = Gun({ peers: ['https://gun-manhattan.herokuapp.com/gun', 'https://gun-us.herokuapp.com/gun'] });
    const SEA = Gun.SEA;
    const globalChat = gun.get('pro_chat_global_v4_final');
    const privateRelay = gun.get('pro_chat_private_v4_final');

    // ======== PEERJS SETUP ========
    const peer = new Peer(undefined, {
        config: {
            iceServers: [
                { url: 'stun:stun.l.google.com:19302' },
                { url: 'stun:stun1.l.google.com:19302' },
                { url: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    // ======== DOM REFS ========
    const onboarding = document.getElementById('onboarding');
    const nameInput = document.getElementById('name-input');
    const startBtn = document.getElementById('start-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const chatBody = document.getElementById('chat-body');
    const msgInput = document.getElementById('msg-input');
    const sendBtn = document.getElementById('send-btn');
    const voiceBtn = document.getElementById('voice-btn');
    const voiceOverlay = document.getElementById('voice-overlay');
    const callingUI = document.getElementById('calling-ui');
    const chatTitle = document.getElementById('chat-title');
    const videoCallBtn = document.getElementById('video-call-btn');
    const statusText = document.getElementById('status-text');

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
    }

    // ======== SIDEBAR ========
    document.getElementById('open-sidebar').addEventListener('click', openSidebar);
    document.getElementById('close-sidebar').addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);
    document.getElementById('global-btn').addEventListener('click', () => { switchChat('global'); closeSidebar(); });

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
    });

    peer.on('error', err => {
        console.warn('PeerJS Error:', err);
        statusText.textContent = '● Reconnecting...';
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
            switchChat('private', id);
            document.getElementById('friend-id-input').value = '';
            closeSidebar();
        }
    });

    document.getElementById('copy-id-btn').addEventListener('click', () => {
        const id = document.getElementById('my-peer-id').textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(id).then(() => alert('ID copied!'));
        } else {
            prompt('Copy your ID:', id);
        }
    });

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
        call.on('stream', stream => { document.getElementById('remote-video').srcObject = stream; });
        call.on('close', endCall);
        call.on('error', endCall);
    }

    function endCall() {
        if (currentCall) { currentCall.close(); currentCall = null; }
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        callingUI.classList.remove('active');
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
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
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
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            const b64 = reader.result;
            if (currentChat === 'global') {
                globalChat.set({ sender: myName, audio: b64, time: Date.now() });
            } else if (activePeerId) {
                const roomId = getRoomId();
                privateRelay.get(roomId).set({ sender: myName, audio: b64, time: Date.now() });
            }
        };
    }

    // ======== CHAT LOGIC ========
    let globalListener = null;

    function loadGlobalChat() {
        currentChat = 'global';
        activePeerId = null;
        chatBody.innerHTML = '';
        chatTitle.textContent = 'Global Community';
        videoCallBtn.classList.add('hidden');
        statusText.textContent = '● Online';

        globalChat.map().on((data, id) => {
            if (data && (data.text || data.audio)) {
                appendMessage(data.sender, data.text, data.sender === myName ? 'sent' : 'received', id, data.audio);
            }
        });
    }

    async function loadPrivateChat(friendId) {
        currentChat = 'private';
        activePeerId = friendId;
        chatBody.innerHTML = '';
        chatTitle.textContent = `🔒 ${friendId.substring(0, 8)}...`;
        videoCallBtn.classList.remove('hidden');
        statusText.textContent = '● Encrypted';

        const roomId = getRoomId();
        const key = roomId;

        privateRelay.get(roomId).map().on(async (data, id) => {
            if (data && (data.text || data.audio)) {
                let text = data.text;
                if (text) {
                    try { text = await SEA.decrypt(text, key); } catch (e) {}
                }
                appendMessage(data.sender, text, data.sender === myName ? 'sent' : 'received', id, data.audio);
            }
        });
    }

    function switchChat(type, friendId = null) {
        if (type === 'global') loadGlobalChat();
        else if (friendId) loadPrivateChat(friendId);
    }

    async function sendMessage() {
        const text = msgInput.value.trim();
        if (!text) return;
        msgInput.value = '';

        if (currentChat === 'global') {
            globalChat.set({ sender: myName, text, time: Date.now() });
        } else if (activePeerId) {
            const key = getRoomId();
            const enc = await SEA.encrypt(text, key);
            privateRelay.get(getRoomId()).set({ sender: myName, text: enc, time: Date.now() });
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    msgInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    // ======== HELPERS ========
    function getRoomId() {
        return [peer.id, activePeerId].sort().join('__');
    }

    const rendered = new Set();
    function appendMessage(sender, text, type, id, audio = null) {
        if (!id || rendered.has(id)) return;
        rendered.add(id);

        const row = document.createElement('div');
        row.className = `msg-row ${type}`;
        row.id = `m-${id}`;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        const nameEl = document.createElement('p');
        nameEl.className = 'sender-name';
        nameEl.textContent = sender;
        bubble.appendChild(nameEl);

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

        row.appendChild(bubble);
        chatBody.appendChild(row);
        chatBody.scrollTop = chatBody.scrollHeight;
    }
});
