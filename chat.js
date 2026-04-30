document.addEventListener('DOMContentLoaded', () => {
    
    // ==== PWA INSTALL LOGIC ====
    let deferredPrompt;
    const installBtn = document.getElementById('install-pwa-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.style.display = 'block';
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installBtn.style.display = 'none';
        }
        deferredPrompt = null;
    });

    // ==== ONBOARDING SCREEN LOGIC ====
    const onboardScreen = document.getElementById('onboarding-screen');
    const nameInput = document.getElementById('onboard-name');
    const notifyBtn = document.getElementById('onboard-notify-btn');
    const mediaBtn = document.getElementById('onboard-media-btn');
    const finishBtn = document.getElementById('finish-onboard-btn');
    
    let myName = localStorage.getItem('my_chat_name');
    let hasCompletedOnboarding = localStorage.getItem('onboarding_complete');

    if (!hasCompletedOnboarding) {
        onboardScreen.classList.remove('hidden');
    }

    nameInput.addEventListener('input', () => {
        finishBtn.disabled = nameInput.value.trim().length === 0;
    });

    notifyBtn.addEventListener('click', () => {
        Notification.requestPermission().then(perm => {
            if(perm === 'granted') {
                notifyBtn.textContent = 'Granted ✅';
                notifyBtn.classList.add('btn-granted');
            } else {
                notifyBtn.textContent = 'Denied ❌';
            }
        });
    });

    mediaBtn.addEventListener('click', async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("Camera/Mic permission requires HTTPS. Skip this if on local IP.");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            stream.getTracks().forEach(track => track.stop());
            mediaBtn.textContent = 'Granted ✅';
            mediaBtn.classList.add('btn-granted');
        } catch (e) {
            mediaBtn.textContent = 'Denied ❌';
        }
    });

    finishBtn.addEventListener('click', () => {
        myName = nameInput.value.trim();
        localStorage.setItem('my_chat_name', myName);
        localStorage.setItem('onboarding_complete', 'true');
        onboardScreen.classList.add('hidden');
    });

    // ==== GLOBAL CHAT (GUN.JS) ====
    const gun = Gun(['https://gun-manhattan.herokuapp.com/gun']);
    const communityRoom = gun.get('ultimate-chat-global-room-v3'); // Version bump for clean slate
    let communityMessagesRendered = new Set();
    let activeMode = 'community';
    let activeFriendId = null;

    function loadCommunity() {
        activeMode = 'community';
        activeFriendId = null;
        document.getElementById('chat-title').textContent = 'Global Community';
        document.getElementById('connection-status').textContent = 'Online';
        document.getElementById('connection-status').classList.add('online');
        document.getElementById('header-avatar').innerHTML = '🌍';
        document.getElementById('header-avatar').style.background = '#8b5cf6';
        document.getElementById('video-call-btn').style.display = 'none';
        messagesContainer.innerHTML = '';
        addSystemMessage("Welcome to the Global Community! Messages here are public.");
        communityMessagesRendered.clear();
        
        communityRoom.map().once((data, id) => {
            if (data && data.content && !communityMessagesRendered.has(id)) {
                communityMessagesRendered.add(id);
                const isMine = data.sender === myPeerId;
                renderMessageToDOM(JSON.parse(data.content), isMine ? 'sent' : 'received', id, data.timeStr, data.quoted, null, false, data.senderName);
            }
        });
    }

    // ==== PRIVATE CHAT (PEERJS) ====
    const peer = new Peer();
    let activeConnection = null;
    let myPeerId = '';
    let contacts = JSON.parse(localStorage.getItem('p2p_contacts')) || {};
    let chatHistory = JSON.parse(localStorage.getItem('p2p_history')) || {};
    
    peer.on('open', (id) => {
        myPeerId = id;
        document.getElementById('my-peer-id').textContent = id;
        renderContacts();
        loadCommunity();
    });

    peer.on('connection', (conn) => {
        if(!contacts[conn.peer]) saveContact(conn.peer, 'New Contact');
        setupConnection(conn);
    });

    document.getElementById('connect-btn').addEventListener('click', () => {
        const name = document.getElementById('friend-name-input').value.trim();
        const friendId = document.getElementById('friend-id-input').value.trim();
        if(friendId) {
            saveContact(friendId, name || 'Friend');
            connectToPeer(friendId);
            document.getElementById('friend-name-input').value = '';
            document.getElementById('friend-id-input').value = '';
        }
    });

    function connectToPeer(friendId) {
        const conn = peer.connect(friendId);
        setupConnection(conn);
    }

    function saveContact(id, name) {
        contacts[id] = name;
        localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
        renderContacts();
    }

    function renderContacts() {
        const list = document.getElementById('contact-list');
        list.innerHTML = '';
        Object.keys(contacts).forEach(id => {
            const div = document.createElement('div');
            div.className = `contact-item ${activeFriendId === id ? 'active' : ''}`;
            div.innerHTML = `
                <div class="c-avatar">${contacts[id].charAt(0).toUpperCase()}</div>
                <div class="c-info">
                    <h4>${contacts[id]}</h4>
                    <p>${id}</p>
                </div>
            `;
            div.addEventListener('click', () => {
                document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                connectToPeer(id);
                document.getElementById('contacts-sidebar').classList.remove('open');
            });
            list.appendChild(div);
        });
    }

    function setupConnection(conn) {
        activeConnection = conn;
        activeFriendId = conn.peer;
        activeMode = 'private';
        
        conn.on('open', () => {
            document.getElementById('connection-status').textContent = 'Securely Connected';
            document.getElementById('chat-title').textContent = contacts[conn.peer] || conn.peer;
            document.getElementById('header-avatar').innerHTML = (contacts[conn.peer] || '?').charAt(0).toUpperCase();
            document.getElementById('header-avatar').style.background = '#10b981';
            document.getElementById('video-call-btn').style.display = 'block';
            loadHistory(conn.peer);
        });

        conn.on('data', (data) => {
            if (data.type === 'message') {
                renderMessageToDOM(data.content, 'received', data.id, data.time, data.quoted, data.expiresAt, true);
                saveMessage(activeFriendId, { id: data.id, type: 'received', content: data.content, time: data.time, quoted: data.quoted, expiresAt: data.expiresAt });
            }
        });
    }

    function loadHistory(friendId) {
        messagesContainer.innerHTML = '';
        addSystemMessage("Secure End-to-End Encrypted Chat");
        const history = chatHistory[friendId] || [];
        history.forEach(msg => renderMessageToDOM(msg.content, msg.type, msg.id, msg.time, msg.quoted, msg.expiresAt, false));
    }

    function saveMessage(friendId, msgObj) {
        if(!chatHistory[friendId]) chatHistory[friendId] = [];
        if(!msgObj.expiresAt) {
            chatHistory[friendId].push(msgObj);
            localStorage.setItem('p2p_history', JSON.stringify(chatHistory));
        }
    }

    // ==== DESIGN STUDIO (THEMING) ====
    const themeColors = [
        '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#ef4444', '#f97316',
        '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
        '#06b6d4', '#0ea5e9', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af',
        '#7c3aed', '#c026d3', '#db2777', '#dc2626', '#ea580c', '#ca8a04',
        '#65a30d', '#16a34a', '#0d9488', '#0891b2', '#0284c7', '#2563eb'
    ];

    const paletteGrid = document.getElementById('theme-palette');
    const savedSettings = JSON.parse(localStorage.getItem('chat_advanced_settings')) || {};

    themeColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        if(savedSettings.sentColor === color) swatch.classList.add('active');
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            document.getElementById('color-sent').value = color;
            document.documentElement.style.setProperty('--sent-bg', color);
            savedSettings.sentColor = color;
        });
        paletteGrid.appendChild(swatch);
    });

    function applySettings() {
        if(savedSettings.font) document.documentElement.style.setProperty('--app-font', savedSettings.font);
        if(savedSettings.fontSize) document.documentElement.style.setProperty('--app-font-size', savedSettings.fontSize + 'px');
        if(savedSettings.bubbleRadius) document.documentElement.style.setProperty('--bubble-radius', savedSettings.bubbleRadius + 'px');
        if(savedSettings.glassBlur) document.documentElement.style.setProperty('--glass-blur', savedSettings.glassBlur + 'px');
        if(savedSettings.headerColor) document.documentElement.style.setProperty('--header-bg', savedSettings.headerColor);
        if(savedSettings.sentColor) document.documentElement.style.setProperty('--sent-bg', savedSettings.sentColor);
        if(savedSettings.receivedColor) document.documentElement.style.setProperty('--received-bg', savedSettings.receivedColor);
        if(savedSettings.textColor) document.documentElement.style.setProperty('--text-color', savedSettings.textColor);
        if(savedSettings.bgImage) document.documentElement.style.setProperty('--bg-image', savedSettings.bgImage);
    }
    applySettings();

    document.getElementById('save-settings-btn').addEventListener('click', () => {
        savedSettings.font = document.getElementById('font-select').value;
        savedSettings.fontSize = document.getElementById('font-size').value;
        savedSettings.bubbleRadius = document.getElementById('bubble-radius').value;
        savedSettings.glassBlur = document.getElementById('glass-blur').value;
        savedSettings.headerColor = document.getElementById('color-header').value;
        savedSettings.sentColor = document.getElementById('color-sent').value;
        savedSettings.receivedColor = document.getElementById('color-received').value;
        savedSettings.textColor = document.getElementById('color-text').value;
        localStorage.setItem('chat_advanced_settings', JSON.stringify(savedSettings));
        applySettings();
        document.getElementById('settings-modal').classList.remove('show');
    });

    document.getElementById('reset-settings-btn').addEventListener('click', () => {
        localStorage.removeItem('chat_advanced_settings');
        location.reload();
    });

    // Background Image
    document.getElementById('modal-bg-btn').addEventListener('click', () => document.getElementById('bg-input').click());
    document.getElementById('bg-input').addEventListener('change', (e) => {
        if (e.target.files[0]) {
            const r = new FileReader();
            r.onload = ev => {
                savedSettings.bgImage = `url(${ev.target.result})`;
                document.documentElement.style.setProperty('--bg-image', savedSettings.bgImage);
            };
            r.readAsDataURL(e.target.files[0]);
        }
    });

    // UI Listeners
    const messagesContainer = document.getElementById('chat-messages');
    const msgInput = document.getElementById('msg-input');
    const sendBtn = document.getElementById('send-btn');
    const modal = document.getElementById('settings-modal');

    document.getElementById('settings-btn').addEventListener('click', () => modal.classList.add('show'));
    document.querySelector('.modal .close-btn').addEventListener('click', () => modal.classList.remove('show'));
    document.getElementById('open-sidebar').addEventListener('click', () => document.getElementById('contacts-sidebar').classList.add('open'));
    document.querySelector('.close-sidebar').addEventListener('click', () => document.getElementById('contacts-sidebar').classList.remove('open'));
    document.getElementById('global-community-btn').addEventListener('click', () => {
        document.getElementById('contacts-sidebar').classList.remove('open');
        loadCommunity();
    });

    // Sending Logic
    function formatTime() {
        const now = new Date();
        return now.getHours() + ':' + (now.getMinutes() < 10 ? '0'+now.getMinutes() : now.getMinutes());
    }

    function addSystemMessage(text) {
        const div = document.createElement('div');
        div.classList.add('system-msg');
        div.textContent = text;
        messagesContainer.appendChild(div);
    }

    function renderMessageToDOM(content, type, id, timeStr, quotedText, expiresAt, isNew = false, senderName = null) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${type}-wrap`;
        
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', type);
        msgDiv.id = `msg-${id}`;
        
        if(senderName && type === 'received' && activeMode === 'community') {
            const nameDiv = document.createElement('div');
            nameDiv.className = 'sender-name';
            nameDiv.textContent = senderName;
            msgDiv.appendChild(nameDiv);
        }

        if (quotedText) {
            const quoteDiv = document.createElement('div');
            quoteDiv.className = 'quoted-msg';
            quoteDiv.textContent = quotedText;
            msgDiv.appendChild(quoteDiv);
        }
        
        if (content.text) {
            const textSpan = document.createElement('span');
            textSpan.textContent = content.text;
            msgDiv.appendChild(textSpan);
        }
        if (content.image) {
            const img = document.createElement('img');
            img.src = content.image;
            msgDiv.appendChild(img);
        }
        if (content.audio) {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = content.audio;
            msgDiv.appendChild(audio);
        }

        const metaDiv = document.createElement('div');
        metaDiv.classList.add('msg-meta');
        metaDiv.innerHTML = `<span class="msg-time">${timeStr}</span>`;
        if (type === 'sent' && activeMode === 'private') {
            metaDiv.innerHTML += `<span class="ticks" id="ticks-${id}">✓✓</span>`;
        }
        
        msgDiv.appendChild(metaDiv);
        wrapper.appendChild(msgDiv);
        messagesContainer.appendChild(wrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function handleSendClick() {
        const text = msgInput.value.trim();
        if (text) {
            const time = formatTime();
            const tempId = Date.now().toString();
            const msgObj = { text: text };
            
            if (activeMode === 'private' && activeConnection) {
                renderMessageToDOM(msgObj, 'sent', tempId, time, null, null, true);
                saveMessage(activeFriendId, { id: tempId, type: 'sent', content: msgObj, time: time });
                activeConnection.send({ type: 'message', content: msgObj, id: tempId, time: time });
            } else if(activeMode === 'community') {
                renderMessageToDOM(msgObj, 'sent', tempId, time, null, null, true);
                communityRoom.get(tempId).put({ content: JSON.stringify(msgObj), timeStr: time, sender: myPeerId, senderName: myName || 'Anonymous' });
            }
            msgInput.value = '';
            msgInput.dispatchEvent(new Event('input'));
        }
    }

    sendBtn.addEventListener('click', handleSendClick);
    msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSendClick(); });

    // Voice Notes (Mic Icon Logic)
    msgInput.addEventListener('input', () => {
        const mic = document.getElementById('mic-icon'), send = document.getElementById('send-icon');
        if (msgInput.value.trim().length > 0) { sendBtn.classList.remove('mic-mode'); mic.style.display = 'none'; send.style.display = 'block'; } 
        else { sendBtn.classList.add('mic-mode'); mic.style.display = 'block'; send.style.display = 'none'; }
    });
});
