const sendButton = document.getElementById("sendBtn");
const closeButton = document.getElementById("closeBtn");
const txtInput = document.getElementById("textInput");
const videoEle = document.getElementById("videoPlayer");
const scaleEle = document.getElementById("scale");
const setScaleEle = document.getElementById("setScaleBtn");
const errorEle = document.getElementById("errorBox");

const mousePollRate = 10; // in ms
const errorClearTime = 60000; // ms
const videoBufferClear = 100 // ms

const maxBRate = 5000000; // in bytes
const minBRate = 2000000; // in bytes

let serverSocket;
let pConn;
let inputChannel;
let started = false;

let mxPos = 0;
let myPos = 0;
let pmxPos = 0;
let pmyPos = 0;

let totalScroll = 0;

let screenSizeX = 3840;
let screenSizeY = 2160;

let config = {

    iceServers: [

         { urls: "stun:stun.l.google.com:19302" },
    
    ]

}

async function generateCreds() {

    const response = await fetch("https://pctopc.sigmasigmaonthewallwhoisthe2.workers.dev/turn-creds") // this could break in the future if it becomes deprecated and also dont use it just use there offical service its just because im poor and i dont have access to a offical credit card
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

(async () => {

    await generateCreds();

})();

// todo:
// add mac support
// add good ui
// add shut down button key binds and generally key binds
// add custom fps
// add app closing warning
// fix shitty ass h243 or someehting
// add mouse center lock keybind thing
// fps counter

async function connectToCapture(roomId) {

    try {

        pConn = new RTCPeerConnection(config)

        serverSocket = new WebSocket(`wss://pctopc.sigmasigmaonthewallwhoisthe2.workers.dev?room=${roomId}`)
        
        await new Promise(resolve => serverSocket.onopen = resolve);
        
        pConn.ontrack = evt => {

            evt.receiver.jitterBufferTarget = 0

            const stream = evt.streams[0];

            videoEle.srcObject = stream

            setInterval(() => {

                if (videoEle.buffered.length > 0) {
                    
                    const diff = videoEle.buffered.end(0) - videoEle.currentTime;
                    
                    if (diff > 0.1) {
                        videoEle.currentTime = videoEle.buffered.end(0) - 0.05;
                    }

                }

            }, videoBufferClear);

        }

        pConn.ondatachannel = evt => {

            inputChannel = evt.channel;
            
            inputChannel.onmessage = msg => {
                
                const data = JSON.parse(msg.data);

                if (data.type == "screen-size") {
                    
                    screenSizeX = data.width;
                    screenSizeY = data.height;

                } else {

                    errorEle.value += "Wrong data type\n";

                }

            }

        }

        serverSocket.onmessage = async msg => {
            
            const data = JSON.parse(msg.data);

            if (data.type && data.actualData) {

                if ( data.type == "offer") {

                    await pConn.setRemoteDescription(data.actualData);
                    
                    const transceivers = pConn.getTransceivers();

                    transceivers.forEach(transceiver => {
                        
                        if (transceiver.receiver.track?.kind === "video") {
                            
                            const codecs = RTCRtpReceiver.getCapabilities("video").codecs;
                            
                            const preferred = codecs.filter(c => 
                                c.mimeType === "video/H264" && 
                                c.sdpFmtpLine?.includes("profile-level-id=42")
                            );

                            const rest = codecs.filter(c => 
                                !(c.mimeType === "video/H264" && c.sdpFmtpLine?.includes("profile-level-id=42"))
                            );

                            transceiver.setCodecPreferences([...preferred, ...rest]);

                        }
                    
                    });

                    const answer = await pConn.createAnswer();
                    await pConn.setLocalDescription(answer);

                    serverSocket.send(JSON.stringify({type: "answer", actualData: answer}));

                    const sender = pConn.getSenders().find(s => s.track && s.track.kind === "video")
                    
                    if (sender) {

                        const params = sender.getParameters()
                        params.encodings[0].minBitrate = minBRate
                        params.encodings[0].maxBitrate = maxBRate
                        params.encodings[0].networkPriority = "high"
                        params.encodings[0].priority = "high"
                        await sender.setParameters(params)
                    
                    } else {

                        errorEle.value += "Sender doesnt exist\n";

                    }

                } else if (data.type == "ICE") {

                    data.actualData.forEach(candidate => pConn.addIceCandidate(candidate))
                
                }

            } else {

                errorEle.value += "Wrong data types and actual data\n";

            }

        };

        pConn.onicecandidate = iceCandidate => {

            if (iceCandidate.candidate) {
            
                serverSocket.send(JSON.stringify({type: "ICE", actualData: iceCandidate.candidate}));

            }

        };

        serverSocket.onclose = async() => {
            
            await stopCapture();

        }

    } catch (err) {

        errorEle.value += err + "\n";
    
    }

}

function mousePacket() {
        
    if (inputChannel && inputChannel.readyState === "open") {

        if ((pmxPos !== mxPos) || (pmyPos !== myPos)) {
            
            pmxPos = mxPos;
            pmyPos = myPos;

            inputChannel.send(JSON.stringify({inputType: "moveMouse", xPos: mxPos, yPos: myPos}))

        } 
        
        if (totalScroll !== 0){

            const finalScroll = totalScroll;

            totalScroll = 0;

            inputChannel.send(JSON.stringify({inputType: "click", clickType: 3, scrollDistance: finalScroll}))

        }

    }

}

async function stopCapture() {
    
    if (started == true) {

        started = false;

        if (pConn) {

            pConn.close();
            pConn = null;

        }

        if (serverSocket) {

            serverSocket.close();
            serverSocket = null;

        }

        videoEle.srcObject = null;

    }

}

async function startCapture() {

    const roomId = (txtInput.value).trim();

    if (roomId && started == false) {

        started = true;

        await connectToCapture(roomId);

    }

    txtInput.value = "";

}

sendButton.addEventListener("click", async () => {

    await startCapture();
    
});

closeButton.addEventListener("click", async () => {

    await stopCapture();

});

document.addEventListener("keydown", (event) => {

    if (inputChannel && inputChannel.readyState === "open") {

        if (event.key !== "CapsLock") {
            
            inputChannel.send(JSON.stringify({inputType: "key", release: false, keyType: event.key}))

        } else {

            inputChannel.send(JSON.stringify({inputType: "key", release: false, keyType: event.key}))
            inputChannel.send(JSON.stringify({inputType: "key", release: true, keyType: event.key}))

        }


    }

});

document.addEventListener("keyup", (event) => {

    if (inputChannel && inputChannel.readyState === "open" && event.key !== "CapsLock") {

        inputChannel.send(JSON.stringify({inputType: "key", release: true, keyType: event.key}))

    }
    
});

videoEle.addEventListener("mousemove", (event) => {

    const scaleX = screenSizeX / videoEle.clientWidth;
    const scaleY = screenSizeY / videoEle.clientHeight;
    
    mxPos = event.offsetX * scaleX;
    myPos = event.offsetY * scaleY;

});

videoEle.addEventListener("mousedown", (event) => {
                            
    mousePacket();

    if (inputChannel && inputChannel.readyState === "open") {

        inputChannel.send(JSON.stringify({inputType: "click", clickType: event.button, release: false}))

    }

});

videoEle.addEventListener("mouseup", (event) => {

    mousePacket();

    if (inputChannel && inputChannel.readyState === "open") {

        inputChannel.send(JSON.stringify({inputType: "click", clickType: event.button, release: true}))

    }

});

videoEle.addEventListener("wheel", (event) => {

    totalScroll += event.deltaY;

});

setInterval(() => {

    mousePacket();

}, mousePollRate);

setInterval(() => {
    
   errorEle.value = "";

}, errorClearTime)