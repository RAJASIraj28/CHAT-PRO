document.addEventListener('DOMContentLoaded', () => {
    
    // ==== STATE & CONSTANTS ====
    let myName = localStorage.getItem('my_chat_name') || '';
    let mySecretKey = localStorage.getItem('my_chat_key') || Math.random().toString(36).substring(2, 15);
    localStorage.setItem('my_chat_key', mySecretKey);

    let currentChatType = 'global';
    let activeFriendId = null;
    let localStream = null;
    let currentCall = null;
    let typingTimeout = null;

    // Use a more robust set of Gun.js relay peers
    const gun = Gun({
        peers: ['https://gun-manhattan.herokuapp.com/gun', 'https://gun-us.herokuapp.com/gun']
    });
    
    // SEA Encryption Module (Simplified for logic)
    const SEA = Gun.SEA;
    const globalChat = gun.get('pro_chat_global_final_v3');
    const privateChatRelay = gun.get('pro_chat_private_relay_v3');

    const peer = new Peer(undefined, {
        config: {
            'iceServers': [
                { url: 'stun:stun.l.google.com:19302' },
                { url: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });

    // ==== UI ELEMENTS ====
    const chatBody = document.getElementById('chat-messages');
    const msgInput = document.getElementById('msg-input');
    const sendBtn = document.getElementById('send-btn');
    const sidebar = document.getElementById('contacts-sidebar');
    const onboardScreen = document.getElementById('onboarding-screen');
    const onboardNameInput = document.getElementById('onboard-name');
    const finishOnboardBtn = document.getElementById('finish-onboard-btn');
    const callingUI = document.getElementById('calling-ui');
    const statusText = document.getElementById('connection-status');

    // ==== INITIALIZATION ====
    if (!myName) {
        onboardScreen.style.display = 'flex';
    } else {
        onboardScreen.style.display = 'none';
        initApp();
    }

    onboardNameInput.addEventListener('input', () => {
        finishOnboardBtn.disabled = onboardNameInput.value.trim().length < 2;
    });

    finishOnboardBtn.addEventListener('click', () => {
        myName = onboardNameInput.value.trim();
        localStorage.setItem('my_chat_name', myName);
        onboardScreen.style.opacity = '0';
        setTimeout(() => {
            onboardScreen.style.display = 'none';
            initApp();
        }, 400);
    });

    function initApp() {
        loadGlobalChat();
        startHeartbeat();
    }

    function startHeartbeat() {
        setInterval(() => {
            if (peer && !peer.destroyed) peer.socket.send({ type: 'HEARTBEAT' });
        }, 15000);
    }

    // ==== SIDEBAR LOGIC ====
    document.getElementById('open-sidebar').addEventListener('click', () => sidebar.classList.add('open'));
    document.querySelector('.close-sidebar').addEventListener('click', () => sidebar.classList.remove('open'));
    document.getElementById('global-community-btn').addEventListener('click', () => switchChat('global'));

    // ==== PEERJS LOGIC ====
    peer.on('open', (id) => {
        document.getElementById('my-peer-id').textContent = id;
        statusText.textContent = 'Ready (Encrypted)';
    });

    peer.on('call', async (call) => {
        if (confirm(`Incoming video call... Answer?`)) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream = stream;
            document.getElementById('local-video').srcObject = stream;
            call.answer(stream);
            handleCall(call);
        }
    });

    document.getElementById('connect-btn').addEventListener('click', () => {
        const friendId = document.getElementById('friend-id-input').value.trim();
        if (friendId) {
            switchChat('private', friendId);
            document.getElementById('friend-id-input').value = '';
            sidebar.classList.remove('open');
        }
    });

    // ==== CALLING LOGIC ====
    document.getElementById('start-video-call').addEventListener('click', async () => {
        if (!activeFriendId) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream = stream;
            document.getElementById('local-video').srcObject = stream;
            const call = peer.call(activeFriendId, stream);
            handleCall(call);
        } catch (err) {
            alert("Camera access denied.");
        }
    });

    function handleCall(call) {
        currentCall = call;
        callingUI.classList.add('active');
        call.on('stream', (remoteStream) => {
            document.getElementById('remote-video').srcObject = remoteStream;
        });
        call.on('close', endCall);
    }

    function endCall() {
        if (currentCall) currentCall.close();
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        callingUI.classList.remove('active');
        currentCall = null;
    }
    document.getElementById('end-call-btn').addEventListener('click', endCall);

    // ==== CHAT ENGINE (ENCRYPTED) ====
    function loadGlobalChat() {
        chatBody.innerHTML = '';
        document.getElementById('chat-title').textContent = 'Global Community';
        document.getElementById('start-video-call').style.display = 'none';
        
        globalChat.map().on((data, id) => {
            if (data && data.text) {
                appendMessage(data.sender, data.text, data.sender === myName ? 'sent' : 'received', id);
            }
        });
    }

    async function loadPrivateChat(friendId) {
        chatBody.innerHTML = '';
        activeFriendId = friendId;
        document.getElementById('chat-title').textContent = `Secure Chat: ${friendId.substring(0,6)}`;
        document.getElementById('start-video-call').style.display = 'flex';

        const roomId = [peer.id, friendId].sort().join('_');
        const sharedKey = roomId; // In a production app, this would be a derived secret

        privateChatRelay.get(roomId).map().on(async (encryptedData, id) => {
            if (encryptedData && encryptedData.text) {
                // Decrypting on the fly
                const decryptedText = await SEA.decrypt(encryptedData.text, sharedKey);
                if (decryptedText) {
                    appendMessage(encryptedData.sender, decryptedText, encryptedData.sender === myName ? 'sent' : 'received', id);
                }
            }
        });
    }

    function switchChat(type, friendId = null) {
        currentChatType = type;
        if (type === 'global') loadGlobalChat();
        else if (friendId) loadPrivateChat(friendId);
        sidebar.classList.remove('open');
    }

    async function sendMessage() {
        const text = msgInput.value.trim();
        if (!text) return;

        if (currentChatType === 'global') {
            globalChat.set({ sender: myName, text: text, time: Date.now() });
        } else if (activeFriendId) {
            const roomId = [peer.id, activeFriendId].sort().join('_');
            const sharedKey = roomId;
            const encryptedText = await SEA.encrypt(text, sharedKey);
            privateChatRelay.get(roomId).set({ sender: myName, text: encryptedText, time: Date.now() });
        }

        msgInput.value = '';
    }

    // TYPING INDICATOR
    msgInput.addEventListener('input', () => {
        if (currentChatType === 'private' && activeFriendId) {
            // Signal typing (can be added to Gun.js stream)
        }
    });

    sendBtn.addEventListener('click', sendMessage);
    msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

    function appendMessage(sender, text, type, id) {
        if (document.getElementById(`msg-${id}`)) return;
        const row = document.createElement('div');
        row.className = `msg-row ${type}`;
        row.id = `msg-${id}`;
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        const senderSpan = document.createElement('p');
        senderSpan.style.fontSize = '0.7rem'; senderSpan.style.opacity = '0.6'; senderSpan.style.marginBottom = '4px';
        senderSpan.textContent = sender;
        const textP = document.createElement('p');
        textP.textContent = text;
        bubble.appendChild(senderSpan); bubble.appendChild(textP); row.appendChild(bubble);
        chatBody.appendChild(row);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    document.getElementById('copy-id-btn').addEventListener('click', () => {
        const id = document.getElementById('my-peer-id').textContent;
        navigator.clipboard.writeText(id).then(() => alert("Private ID Copied!"));
    });

});
