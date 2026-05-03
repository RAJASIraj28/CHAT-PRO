const Gun = require('gun');

const gun = Gun({
    peers: [
        'https://gun-rs.iris.to/gun',
        'https://hub.bugout.link/gun',
        'https://gun.hashbase.io/gun',
        'https://gun.glitch.me/gun'
    ]
});

console.log("Listening on prochat_global_room_final_v1...");
const globalChat = gun.get('prochat_global_room_final_v1');

globalChat.map().on((data, id) => {
    if (data && data.text) {
        console.log(`\n>>> [MESSAGE RECEIVED ACROSS THE INTERNET] <<<`);
        console.log(`Sender: ${data.sender}`);
        console.log(`Message: ${data.text}`);
        console.log(`-----------------------------------------------\n`);
    }
});

// keep alive
setInterval(() => {}, 1000);
