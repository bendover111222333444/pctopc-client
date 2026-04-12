const sendButton = document.getElementById("sendBtn");
const txtInput = document.getElementById("textInput")
const videoEle = document.getElementById("videoPlayer");

let config = {
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
                urls: creds.urls,
                username: creds.username,
                credential: creds.credential
            }
        ]
    }

}

generateCreds();

const mousePollRate = 1 / 10;

let pConn = new RTCPeerConnection(config);
let started = false;
let fps = 60;

let mxPos = 0;
let myPos = 0;
let pmxPos = 0;
let pmyPos = 0;

let screenSizeX = 1920;
let screenSizeY = 1080;

// todo:
// add mac support
// fix screen changing and breaking mouse pos
// make reconnection work
// add good ui
// add shut down button / key
// add stun then if not work switch to turn

async function connectToCapture(roomId) {

    try {

        const serverSocket = new WebSocket(`wss://pctopc.sigmasigmaonthewallwhoisthe2.workers.dev?room=${roomId}`)

        await new Promise(resolve => serverSocket.onopen = resolve);

        pConn.ontrack = evt => {

            evt.receiver.jitterBufferTarget = 0

            const stream = evt.streams[0];

            videoEle.srcObject = stream

            const track = stream.getVideoTracks()[0];
            const settings = track.getSettings();

            screenSizeX = settings.width;
            screenSizeY = settings.height;

        }

        pConn.ondatachannel = evt => {

            const inputChannel = evt.channel;

            inputChannel.onopen = () => {

                document.addEventListener("keydown", (event) => {

                    inputChannel.send(JSON.stringify({inputType: "key", release: false, keyType: event.key}))

                });

                document.addEventListener("keyup", (event) => {

                    inputChannel.send(JSON.stringify({inputType: "key", release: true, keyType: event.key}))

                });
                
                videoEle.addEventListener("mousemove", (event) => {

                    mxPos = event.offsetX;
                    myPos = event.offsetY;

                });

                videoEle.addEventListener("mousedown", (event) => {

                    inputChannel.send(JSON.stringify({inputType: "moveMouse", xPos: (mxPos / videoEle.offsetWidth) * screenSizeX, yPos: (myPos / videoEle.offsetHeight) * screenSizeY}))
                    inputChannel.send(JSON.stringify({inputType: "click", clickType: event.button, release: false}))

                });

                videoEle.addEventListener("mouseup", (event) => {

                    inputChannel.send(JSON.stringify({inputType: "click", clickType: event.button, release: true}))

                });

                setInterval(() => {
                    
                    if ((pmxPos !== mxPos) || (pmyPos !== myPos)) {
                        
                        pmxPos = mxPos;
                        pmyPos = myPos;

                        console.log("moving mice")

                        inputChannel.send(JSON.stringify({inputType: "moveMouse", xPos: (mxPos / videoEle.offsetWidth) * screenSizeX, yPos: (myPos / videoEle.offsetHeight) * screenSizeY}))

                    }


                }, mousePollRate);

            }

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