document.addEventListener('DOMContentLoaded', () => {
    
    // ==== STATE & CONSTANTS ====
    let myName = localStorage.getItem('my_chat_name') || '';
    let currentChatType = 'global'; // 'global' or 'private'
    let activeFriendId = null;
    let localStream = null;
    let currentCall = null;

    const gun = Gun(['https://gun-manhattan.herokuapp.com/gun']);
    const chatDB = gun.get('pro_chat_global_final_v1');

    const peer = new Peer(undefined, {
        config: {
            'iceServers': [
                { url: 'stun:stun.l.google.com:19302' },
                { url: 'stun:stun1.l.google.com:19302' },
                { url: 'stun:stun2.l.google.com:19302' }
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

    // ==== ONBOARDING ====
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
        onboardScreen.style.display = 'none';
        initApp();
    });

    function initApp() {
        renderContacts();
        loadGlobalChat();
    }

    // ==== SIDEBAR LOGIC ====
    document.getElementById('open-sidebar').addEventListener('click', () => sidebar.classList.add('open'));
    document.querySelector('.close-sidebar').addEventListener('click', () => sidebar.classList.remove('open'));
    document.getElementById('global-community-btn').addEventListener('click', () => switchChat('global'));

    // ==== PEERJS LOGIC ====
    peer.on('open', (id) => {
        document.getElementById('my-peer-id').textContent = id;
    });

    peer.on('connection', (conn) => {
        setupPrivateChat(conn);
    });

    peer.on('call', async (call) => {
        if (confirm(`Incoming call from ${call.peer}. Answer?`)) {
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
            startPrivateChat(friendId);
            document.getElementById('friend-id-input').value = '';
            sidebar.classList.remove('open');
        }
    });

    function startPrivateChat(id) {
        const conn = peer.connect(id);
        setupPrivateChat(conn);
    }

    function setupPrivateChat(conn) {
        activeFriendId = conn.peer;
        currentChatType = 'private';
        document.getElementById('chat-title').textContent = `Chat with ${idTruncate(conn.peer)}`;
        document.getElementById('start-video-call').style.display = 'flex';
        chatBody.innerHTML = '';
        
        conn.on('data', (data) => {
            appendMessage(data.sender, data.text, 'received');
        });
    }

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
            alert("Camera/Mic access denied or unavailable.");
        }
    });

    function handleCall(call) {
        currentCall = call;
        callingUI.classList.add('active');
        
        call.on('stream', (remoteStream) => {
            document.getElementById('remote-video').srcObject = remoteStream;
        });

        call.on('close', endCall);
        call.on('error', endCall);
    }

    function endCall() {
        if (currentCall) currentCall.close();
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        callingUI.classList.remove('active');
        currentCall = null;
    }

    document.getElementById('end-call-btn').addEventListener('click', endCall);

    // ==== CHAT LOGIC ====
    function loadGlobalChat() {
        chatBody.innerHTML = '';
        document.getElementById('chat-title').textContent = 'Global Community';
        document.getElementById('start-video-call').style.display = 'none';
        
        chatDB.map().on((data, id) => {
            if (data && data.text) {
                appendMessage(data.sender, data.text, data.sender === myName ? 'sent' : 'received');
            }
        });
    }

    function switchChat(type) {
        currentChatType = type;
        if (type === 'global') {
            loadGlobalChat();
        }
        sidebar.classList.remove('open');
    }

    sendBtn.addEventListener('click', sendMessage);
    msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

    function sendMessage() {
        const text = msgInput.value.trim();
        if (!text) return;

        if (currentChatType === 'global') {
            chatDB.set({ sender: myName, text: text, time: Date.now() });
        } else if (activeFriendId) {
            // Private messaging logic (simplified for build)
            appendMessage(myName, text, 'sent');
        }

        msgInput.value = '';
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function appendMessage(sender, text, type) {
        const row = document.createElement('div');
        row.className = `msg-row ${type}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        
        const senderSpan = document.createElement('p');
        senderSpan.style.fontSize = '0.7rem';
        senderSpan.style.opacity = '0.6';
        senderSpan.style.marginBottom = '4px';
        senderSpan.textContent = sender;
        
        const textP = document.createElement('p');
        textP.textContent = text;
        
        bubble.appendChild(senderSpan);
        bubble.appendChild(textP);
        row.appendChild(bubble);
        chatBody.appendChild(row);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function renderContacts() {
        // Mock contacts for now, can be expanded to storage
    }

    function idTruncate(id) {
        return id.substring(0, 6) + '...';
    }

    // Copy ID Helper
    document.getElementById('copy-id-btn').addEventListener('click', () => {
        const id = document.getElementById('my-peer-id').textContent;
        navigator.clipboard.writeText(id);
        alert("ID Copied!");
    });

});
