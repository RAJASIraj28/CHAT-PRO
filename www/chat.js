document.addEventListener('DOMContentLoaded', () => {
    
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
        if(nameInput.value.trim().length > 0) {
            finishBtn.disabled = false;
        } else {
            finishBtn.disabled = true;
        }
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
            stream.getTracks().forEach(track => track.stop()); // Immediately stop
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

    // Helper for notifications
    function notifyUser(title, body) {
        if (Notification.permission === 'granted' && document.hidden) {
            new Notification(title, { body });
        }
    }

    let activeMode = 'community';
    
    // ======== STABLE RELAYS & MQTT FALLBACK ========
    const gun = Gun({
        peers: [
            'https://gun-rs.iris.to/gun',
            'https://hub.bugout.link/gun',
            'https://gun.hashbase.io/gun',
            'https://gun.glitch.me/gun'
        ]
    });

    const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');
    const GLOBAL_MQTT_TOPIC = 'prochat_global_mqtt_v3';
    
    mqttClient.on('connect', () => {
        mqttClient.subscribe(GLOBAL_MQTT_TOPIC);
    });

    mqttClient.on('message', (topic, message) => {
        if (topic === GLOBAL_MQTT_TOPIC && activeMode === 'community') {
            try {
                const data = JSON.parse(message.toString());
                if (data && data.msgId && !communityMessagesRendered.has(data.msgId)) {
                    communityMessagesRendered.add(data.msgId);
                    const isMine = data.sender === myPeerId;
                    
                    // Ensure content is an object
                    let msgContent = data.content;
                    if (typeof msgContent === 'string') {
                        try { msgContent = JSON.parse(msgContent); } catch(e){}
                    }
                    
                    renderMessageToDOM(msgContent, isMine ? 'sent' : 'received', data.msgId, data.timeStr, data.quoted, null, true, data.senderName, data.sender);
                }
            } catch(e){}
        } else if (topic.startsWith('prochat/private/') && activeMode === 'private') {
             try {
                const data = JSON.parse(message.toString());
                if (data && data.msgId && data.sender !== myPeerId) {
                    const history = chatHistory[activeFriendId] || [];
                    if (!history.find(m => m.id === data.msgId)) {
                        // Ensure content is an object
                        let msgContent = data.content;
                        if (typeof msgContent === 'string') {
                            try { msgContent = JSON.parse(msgContent); } catch(e){}
                        }
                        renderMessageToDOM(msgContent, 'received', data.msgId, data.time, data.quoted, data.expiresAt, true);
                        saveMessage(activeFriendId, { id: data.msgId, type: 'received', content: msgContent, time: data.time, quoted: data.quoted, expiresAt: data.expiresAt });
                    }
                }
            } catch(e){}
        }
    });

    const communityRoom = gun.get('ultimate-chat-global-room-v3');
    let communityMessagesRendered = new Set();
    
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
        addSystemMessage("Welcome to the Global Community! Messages here are public. Swipe right on any message to reply.");
        communityMessagesRendered.clear();
        
        communityRoom.map().once((data, id) => {
            if (data && data.content && !communityMessagesRendered.has(id)) {
                communityMessagesRendered.add(id);
                const isMine = data.sender === myPeerId;
                renderMessageToDOM(JSON.parse(data.content), isMine ? 'sent' : 'received', id, data.timeStr, data.quoted, null, false, data.senderName, data.sender);
            }
        });
    }

    document.getElementById('global-community-btn').addEventListener('click', () => {
        document.getElementById('contacts-sidebar').classList.remove('open');
        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        document.getElementById('global-community-btn').classList.add('active');
        loadCommunity();
    });

    const peer = new Peer();
    let activeConnection = null;
    let activeFriendId = null;
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
        notifyUser('New Connection', `${contacts[conn.peer] || conn.peer} connected securely.`);
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

    function startPrivateChat(id, name) {
        if (!contacts[id]) {
            saveContact(id, name);
        }
        connectToPeer(id);
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

    function loadHistory(friendId) {
        messagesContainer.innerHTML = '';
        addSystemMessage("Secure End-to-End Encrypted Chat");
        const history = chatHistory[friendId] || [];
        history.forEach(msg => {
            let content = msg.content;
            if (typeof content === 'string') {
                try { content = JSON.parse(content); } catch(e){}
            }
            renderMessageToDOM(content, msg.type, msg.id, msg.time, msg.quoted, msg.expiresAt, false);
        });
    }

    function saveMessage(friendId, msgObj) {
        if(!chatHistory[friendId]) chatHistory[friendId] = [];
        if(!msgObj.expiresAt) {
            chatHistory[friendId].push(msgObj);
            localStorage.setItem('p2p_history', JSON.stringify(chatHistory));
        }
    }

    function setupConnection(conn) {
        activeConnection = conn;
        activeFriendId = conn.peer;
        activeMode = 'private';
        
        conn.on('open', () => {
            document.getElementById('connection-status').textContent = 'Securely Connected';
            document.getElementById('connection-status').classList.add('online');
            document.getElementById('chat-title').textContent = contacts[conn.peer] || conn.peer;
            document.getElementById('header-avatar').innerHTML = (contacts[conn.peer] || '?').charAt(0).toUpperCase();
            document.getElementById('header-avatar').style.background = '#10b981';
            document.getElementById('video-call-btn').style.display = 'block';
            loadHistory(conn.peer);
        });

        conn.on('data', (data) => {
            if (data.type === 'message') {
                if (data.id && !document.getElementById(`msg-${data.id}`)) {
                    renderMessageToDOM(data.content, 'received', data.id, data.time, data.quoted, data.expiresAt, true);
                    saveMessage(activeFriendId, { id: data.id, type: 'received', content: data.content, time: data.time, quoted: data.quoted, expiresAt: data.expiresAt });
                    notifyUser(contacts[conn.peer], 'Sent a message');
                }
            } else if (data.type === 'typing') {
                handleRemoteTyping(data.isTyping);
            } else if (data.type === 'read_receipt') {
                const ticks = document.getElementById(`ticks-${data.id}`);
                if(ticks) { ticks.innerHTML = '✓✓'; ticks.classList.add('read'); }
            }
        });

        // Also subscribe to MQTT for this friend
        const roomId = [myPeerId, activeFriendId].sort().join('-');
        mqttClient.subscribe(`prochat/private/${roomId}`);
    }

    // Video Calling
    const videoBtn = document.getElementById('video-call-btn');
    const videoModal = document.getElementById('video-modal');
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    const endCallBtn = document.getElementById('end-call-btn');
    let currentCall = null;
    let localStream = null;

    videoBtn.addEventListener('click', async () => {
        if(!activeFriendId) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert("Camera access requires HTTPS.");
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            videoModal.classList.remove('hidden');
            const call = peer.call(activeFriendId, localStream);
            currentCall = call;
            call.on('stream', (remoteStream) => { remoteVideo.srcObject = remoteStream; });
            call.on('close', endCall);
        } catch(e) { alert("Camera access denied."); }
    });

    peer.on('call', async (call) => {
        const accept = confirm(`Incoming video call. Accept?`);
        if(accept) {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert("Camera access requires HTTPS.");
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            videoModal.classList.remove('hidden');
            call.answer(localStream);
            currentCall = call;
            call.on('stream', (remoteStream) => { remoteVideo.srcObject = remoteStream; });
            call.on('close', endCall);
        }
    });

    endCallBtn.addEventListener('click', endCall);
    function endCall() {
        if(currentCall) currentCall.close();
        if(localStream) localStream.getTracks().forEach(t => t.stop());
        videoModal.classList.add('hidden');
    }

    // ======== CAMERA & ATTACHMENT LOGIC ========
    const attachBtn = document.getElementById('attach-btn');
    const cameraBtn = document.getElementById('camera-btn');
    const imageUpload = document.getElementById('image-upload');
    const cameraOverlay = document.getElementById('camera-overlay');
    const cameraStream = document.getElementById('camera-stream');
    const captureBtn = document.getElementById('capture-btn');
    const closeCameraBtn = document.getElementById('close-camera-btn');
    const cameraCanvas = document.getElementById('camera-canvas');

    attachBtn.addEventListener('click', () => imageUpload.click());
    
    imageUpload.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = ev => sendImage(ev.target.result);
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    cameraBtn.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            cameraStream.srcObject = stream;
            cameraOverlay.classList.remove('hidden');
        } catch (e) { alert("Camera access denied."); }
    });

    closeCameraBtn.addEventListener('click', () => {
        cameraOverlay.classList.add('hidden');
        if (cameraStream.srcObject) cameraStream.srcObject.getTracks().forEach(t => t.stop());
    });

    captureBtn.addEventListener('click', () => {
        cameraCanvas.width = cameraStream.videoWidth;
        cameraCanvas.height = cameraStream.videoHeight;
        const ctx = cameraCanvas.getContext('2d');
        ctx.drawImage(cameraStream, 0, 0);
        const b64 = cameraCanvas.toDataURL('image/jpeg', 0.7);
        sendImage(b64);
        closeCameraBtn.click();
    });

    function sendImage(b64) {
        const time = formatTime(), tempId = 'img_' + Date.now();
        const msgObj = { image: b64 };
        if (activeMode === 'private') {
            renderMessageToDOM(msgObj, 'sent', tempId, time, replyingToContext, null, true);
            saveMessage(activeFriendId, { id: tempId, type: 'sent', content: msgObj, time: time, quoted: replyingToContext, expiresAt: null });
            activeConnection.send({ type: 'message', content: msgObj, id: tempId, time: time, quoted: replyingToContext, expiresAt: null });
            
            const roomId = [myPeerId, activeFriendId].sort().join('-');
            mqttClient.publish(`prochat/private/${roomId}`, JSON.stringify({ sender: myPeerId, content: msgObj, msgId: tempId, time, quoted: replyingToContext }));
        } else {
            renderMessageToDOM(msgObj, 'sent', tempId, time, replyingToContext, null, true);
            const payload = { content: JSON.stringify(msgObj), timeStr: time, quoted: replyingToContext, sender: myPeerId, senderName: myName || 'Anonymous', msgId: tempId };
            communityRoom.get(tempId).put(payload);
            mqttClient.publish(GLOBAL_MQTT_TOPIC, JSON.stringify(payload));
        }
    }

    // Swipe to Reply
    let replyingToContext = null;
    const replyPreview = document.getElementById('reply-preview');
    const replyTextPreview = document.getElementById('reply-text-preview');
    
    document.getElementById('cancel-reply-btn').addEventListener('click', cancelReply);
    function cancelReply() { replyingToContext = null; replyPreview.classList.add('hidden'); }

    function attachSwipeListener(wrapper, msgDiv, text) {
        let startX = 0, currentX = 0, isDragging = false;
        msgDiv.addEventListener('touchstart', e => { startX = e.touches[0].clientX; isDragging = true; wrapper.style.transition = 'none'; }, {passive: true});
        msgDiv.addEventListener('touchmove', e => {
            if(!isDragging) return;
            currentX = e.touches[0].clientX;
            const diff = currentX - startX;
            if(diff > 0 && diff < 80) {
                wrapper.style.transform = `translateX(${diff}px)`;
                wrapper.querySelector('.reply-icon-reveal').style.opacity = diff / 80;
            }
        }, {passive: true});
        msgDiv.addEventListener('touchend', e => {
            if(!isDragging) return;
            isDragging = false;
            wrapper.style.transition = 'transform 0.2s ease-out';
            wrapper.style.transform = `translateX(0)`;
            wrapper.querySelector('.reply-icon-reveal').style.opacity = 0;
            if (currentX - startX > 50) triggerReply(text);
        });
        msgDiv.addEventListener('dblclick', () => triggerReply(text));
    }

    function triggerReply(text) {
        replyingToContext = text.substring(0, 50) + (text.length>50?'...':'');
        replyTextPreview.textContent = replyingToContext;
        replyPreview.classList.remove('hidden');
        msgInput.focus();
    }

    // Chat Rendering
    const messagesContainer = document.getElementById('chat-messages');
    const msgInput = document.getElementById('msg-input');
    const sendBtn = document.getElementById('send-btn');
    
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

    function renderMessageToDOM(content, type, id, timeStr, quotedText, expiresAt, isNew = false, senderName = null, senderId = null) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${type}-wrap`;
        
        const replyIcon = document.createElement('div');
        replyIcon.className = 'reply-icon-reveal';
        replyIcon.textContent = '↩️';
        wrapper.appendChild(replyIcon);

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', type);
        msgDiv.id = `msg-${id}`;
        
        if(senderName && type === 'received' && activeMode === 'community') {
            const nameDiv = document.createElement('div');
            nameDiv.className = 'sender-name clickable';
            nameDiv.textContent = senderName;
            nameDiv.title = "Click to chat privately";
            nameDiv.addEventListener('click', () => {
                if (senderId && senderId !== myPeerId) {
                    startPrivateChat(senderId, senderName);
                }
            });
            msgDiv.appendChild(nameDiv);
        }

        if(expiresAt) {
            const timeLeft = Math.max(0, expiresAt - Date.now());
            if(timeLeft === 0 && !isNew) return; 
            const notice = document.createElement('span');
            notice.className = 'disappear-notice';
            notice.textContent = `⏱️ Disappears soon...`;
            msgDiv.appendChild(notice);
            setTimeout(() => { msgDiv.style.opacity = '0'; setTimeout(() => wrapper.remove(), 300); }, isNew ? (expiresAt - Date.now()) : timeLeft);
        }

        if (quotedText) {
            const quoteDiv = document.createElement('div');
            quoteDiv.className = 'quoted-msg';
            quoteDiv.textContent = quotedText;
            msgDiv.appendChild(quoteDiv);
        }
        
        let replyableText = "Media";
        if (content.text) {
            const textSpan = document.createElement('span');
            textSpan.textContent = content.text;
            msgDiv.appendChild(textSpan);
            replyableText = content.text;
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
        
        attachSwipeListener(wrapper, msgDiv, replyableText);

        const metaDiv = document.createElement('div');
        metaDiv.classList.add('msg-meta');
        metaDiv.innerHTML = `<span class="msg-time">${timeStr}</span>`;
        if (type === 'sent' && activeMode === 'private') {
            metaDiv.innerHTML += `<span class="ticks" id="ticks-${id}">✓✓</span>`;
        } else if(isNew && activeConnection && activeMode === 'private') {
            activeConnection.send({ type: 'read_receipt', id: id });
        }
        
        msgDiv.appendChild(metaDiv);
        wrapper.appendChild(msgDiv);
        messagesContainer.appendChild(wrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function handleSendClick() {
        if (sendBtn.classList.contains('mic-mode')) return;
        if (activeMode === 'private' && !activeConnection) return alert('Connect to a friend first!');
        
        const text = msgInput.value.trim();
        if (text) {
            const time = formatTime();
            const tempId = Date.now().toString();
            const disappearVal = parseInt(document.getElementById('disappear-select').value);
            const expiresAt = disappearVal > 0 ? Date.now() + disappearVal : null;
            const msgObj = { text: text };
            
            if (activeMode === 'private') {
                renderMessageToDOM(msgObj, 'sent', tempId, time, replyingToContext, expiresAt, true);
                saveMessage(activeFriendId, { id: tempId, type: 'sent', content: msgObj, time: time, quoted: replyingToContext, expiresAt });
                activeConnection.send({ type: 'message', content: msgObj, id: tempId, time: time, quoted: replyingToContext, expiresAt: expiresAt });
                
                const roomId = [myPeerId, activeFriendId].sort().join('-');
                mqttClient.publish(`prochat/private/${roomId}`, JSON.stringify({ sender: myPeerId, content: msgObj, msgId: tempId, time, quoted: replyingToContext, expiresAt }));
            } else {
                renderMessageToDOM(msgObj, 'sent', tempId, time, replyingToContext, null, true);
                const payload = { content: JSON.stringify(msgObj), timeStr: time, quoted: replyingToContext, sender: myPeerId, senderName: myName || 'Anonymous', msgId: tempId };
                communityRoom.get(tempId).put(payload);
                mqttClient.publish(GLOBAL_MQTT_TOPIC, JSON.stringify(payload));
            }
            
            msgInput.value = '';
            msgInput.dispatchEvent(new Event('input'));
            cancelReply();
        }
    }

    sendBtn.addEventListener('click', handleSendClick);
    msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSendClick(); });

    const micIcon = document.getElementById('mic-icon'), sendIcon = document.getElementById('send-icon');
    msgInput.addEventListener('input', () => {
        if (msgInput.value.trim().length > 0) { sendBtn.classList.remove('mic-mode'); micIcon.style.display = 'none'; sendIcon.style.display = 'block'; } 
        else { sendBtn.classList.add('mic-mode'); micIcon.style.display = 'block'; sendIcon.style.display = 'none'; }
    });

    // Voice Notes
    let mediaRecorder, audioChunks = [], isRecording = false;
    sendBtn.addEventListener('mousedown', startRecording);
    sendBtn.addEventListener('touchstart', startRecording);
    sendBtn.addEventListener('mouseup', stopRecording);
    sendBtn.addEventListener('touchend', stopRecording);
    
    async function startRecording(e) {
        if (!sendBtn.classList.contains('mic-mode')) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert("Microphone access requires HTTPS.");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = ev => audioChunks.push(ev.data);
            mediaRecorder.onstop = () => {
                const reader = new FileReader();
                reader.readAsDataURL(new Blob(audioChunks, { type: 'audio/webm' }));
                reader.onloadend = () => {
                    const time = formatTime(), tempId = Date.now().toString();
                    renderMessageToDOM({ audio: reader.result }, 'sent', tempId, time, replyingToContext, null, true);
                    if(activeMode === 'private') {
                        saveMessage(activeFriendId, { id: tempId, type: 'sent', content: { audio: reader.result }, time, quoted: replyingToContext, expiresAt: null });
                        activeConnection.send({ type: 'message', content: { audio: reader.result }, id: tempId, time, quoted: replyingToContext, expiresAt: null });
                    } else {
                        communityRoom.get(tempId).put({ content: JSON.stringify({ audio: reader.result }), timeStr: time, quoted: replyingToContext, sender: myPeerId, senderName: myName || 'Anonymous' });
                    }
                    cancelReply();
                };
            };
            mediaRecorder.start();
            isRecording = true;
            sendBtn.classList.add('recording');
        } catch (err) {}
    }
    function stopRecording() { if (isRecording) { mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()); isRecording = false; sendBtn.classList.remove('recording'); } }

    // Advanced Settings
    const savedSettings = JSON.parse(localStorage.getItem('chat_advanced_settings')) || {};
    function applySavedSettings() {
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
    applySavedSettings();

    document.getElementById('open-sidebar').addEventListener('click', () => document.getElementById('contacts-sidebar').classList.add('open'));
    document.querySelector('.close-sidebar').addEventListener('click', () => document.getElementById('contacts-sidebar').classList.remove('open'));
    
    const modal = document.getElementById('settings-modal');
    document.getElementById('settings-btn').addEventListener('click', () => modal.classList.add('show'));
    document.querySelector('.modal .close-btn').addEventListener('click', () => modal.classList.remove('show'));
    
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
        applySavedSettings();
        modal.classList.remove('show');
    });

    document.getElementById('reset-settings-btn').addEventListener('click', () => {
        localStorage.removeItem('chat_advanced_settings');
        location.reload();
    });

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
});
