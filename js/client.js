const sendButton = document.getElementById("sendBtn");
const txtInput = document.getElementById("textInput")
const videoEle = document.getElementById("videoPlayer");

const config = {
    iceServers: [
         { urls: "stun:stun.l.google.com:19302" },
    ]
}

async function generateCreds() {

    const response = await fetch("https://pctopc.sigmasigmaonthewallwhoisthe2.workers.dev/turn-creds") // this could break in the future if it becomes deprecated.
    const creds = await response.json()

    config = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            {
                urls: creds.iceServers.urls,
                username: creds.iceServers.username,
                credential: creds.iceServers.credential
            }
        ]
    }

}

generateCreds();

let pConn = new RTCPeerConnection(config);
let started = false;

async function connectToCapture(roomId) {

    try {

        const serverSocket = new WebSocket(`wss://pctopc.sigmasigmaonthewallwhoisthe2.workers.dev?room=${roomId}`)

        await new Promise(resolve => serverSocket.onopen = resolve);

        pConn.ontrack = evt => {

            evt.receiver.jitterBufferTarget = 0
            videoEle.srcObject = evt.streams[0]
        
        }

        serverSocket.onmessage = async msg => {
            
            const data = JSON.parse(msg.data);
            if (data.type && data.actualData) {

                if ( data.type == "offer") {

                    await pConn.setRemoteDescription(data.actualData);

                    const answer = await pConn.createAnswer();
                    await pConn.setLocalDescription(answer);

                    serverSocket.send(JSON.stringify({type: "answer", actualData: answer}));

                } else if (data.type == "ICE") {

                    data.actualData.forEach(candidate => pConn.addIceCandidate(candidate))
                
                }

            }

        };

        pConn.onicecandidate = iceCandidate => {

            if (iceCandidate.candidate) {
            
                serverSocket.send(JSON.stringify({type: "ICE", actualData: iceCandidate.candidate}));

            }

        };

    } catch (err) {

        console.log(err);
    
    }

}

sendButton.addEventListener("click", () => {
   
    const roomId = txtInput.value;

    if (roomId) {

        connectToCapture(roomId);

    }

})