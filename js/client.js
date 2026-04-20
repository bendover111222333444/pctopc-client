const sendButton = document.getElementById("sendBtn");
const closeButton = document.getElementById("closeBtn");
const txtInput = document.getElementById("textInput");
const videoEle = document.getElementById("videoPlayer");
const scaleEle = document.getElementById("scale");
const setScaleEle = document.getElementById("setScaleBtn");
const errorEle = document.getElementById("errorBox");
const pointerBtn = document.getElementById("pointerBtn");
const fullScreenBtn = document.getElementById("fullScreenBtn");
const pointScreenBtn = document.getElementById("pointScreenBtn");

const mousePollRate = 10; // in ms
const errorClearTime = 60_000; // ms
const websocketPing = 20_000; // also ms

const fullScreenStyle = "fullscreen-thing"

let serverSocket;
let decoder;
let pConn;
let inputChannel;
let videoChannel;
let started = false;
let allowExit = false;

let mxPos = 0;
let myPos = 0;
let pmxPos = 0;
let pmyPos = 0;

let totalScroll = 0;

let screenSizeX = 3840;
let screenSizeY = 2160;
let videoAspect = screenSizeX / screenSizeY

const decoderSettings = {

    codec: 'avc1.640033',
    optimizeForLatency: true,
    hardwareAcceleration: 'prefer-hardware',
    avc: { format: 'annexb' }

}

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
// fps counter
// add cookies to renember user
// fix random disconnects (maybe fixed)
// add back the origin thing
// fix fullscreen and pointer

// Commented out shiz is depricated stuff

async function connectToCapture(roomId) {

    try {

        pConn = new RTCPeerConnection(config)

        serverSocket = new WebSocket(`wss://pctopc.sigmasigmaonthewallwhoisthe2.workers.dev?room=${roomId}`)
        
        await new Promise(resolve => serverSocket.onopen = resolve);

        pConn.ontrack = evt => {

            if (evt.track.kind === 'audio') {

                const audio = new Audio()
                audio.srcObject = new MediaStream([evt.track])
                audio.play()

            }

        }

        pConn.ondatachannel = event => {
            
           if (event.channel.label === 'video') {

            if (decoder && decoder.state !== 'closed') {
                decoder.close()
                decoder = null
            }

            videoChannel = event.channel
            videoChannel.binaryType = 'arraybuffer'

            const generator = new MediaStreamTrackGenerator({ kind: 'video' })
            const writer = generator.writable.getWriter()

            videoEle.srcObject = new MediaStream([generator])

            decoder = new VideoDecoder({

                output: (frame) => {

                    writer.write(frame)
                    frame.close()

                },

                error: (err) => errorEle.value += err + '\n'

            })

            decoder.configure(decoderSettings)

            let pendingHeader = null
            let frameBuffer = null

            let frameOffset = 0

            let gotKeyframe = false

            videoChannel.onmessage = msg => {

                if (msg.data instanceof ArrayBuffer) {

                    if (!pendingHeader) {

                        const view = new DataView(msg.data)

                        pendingHeader = {

                            isKey: view.getUint8(0) === 1,
                            timestamp: view.getFloat64(1),
                            totalSize: view.getUint32(9)

                        }
                        
                        frameBuffer = new Uint8Array(pendingHeader.totalSize)
                        frameOffset = 0

                    } else {

                        const chunk = new Uint8Array(msg.data)

                        frameBuffer.set(chunk, frameOffset)
                        frameOffset += chunk.byteLength

                        if (frameOffset >= pendingHeader.totalSize) {

                            if (!pendingHeader.isKey && !gotKeyframe) {

                                pendingHeader = null
                                frameBuffer = null
                                frameOffset = 0
                                return

                            }

                            if (pendingHeader.isKey) gotKeyframe = true

                            try {

                                decoder.decode(new EncodedVideoChunk({

                                    type: pendingHeader.isKey ? 'key' : 'delta',
                                    timestamp: pendingHeader.timestamp,
                                    data: frameBuffer

                                }))

                            } catch(err) {

                                errorEle.value += err + '\n'

                            }

                            pendingHeader = null
                            frameBuffer = null
                            frameOffset = 0

                        }

                    }

                }

            }

        } else if (event.channel.label === 'input') {

                inputChannel = event.channel;
                
                inputChannel.onmessage = msg => {
                    
                    const data = JSON.parse(msg.data);

                    if (data.type == "screen-size") {
                        
                        screenSizeX = data.width;
                        screenSizeY = data.height;
                        videoAspect = screenSizeX / screenSizeY

                    } else {

                        errorEle.value += "Wrong data type\n";

                    }

                }

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

            } else {

                errorEle.value += "Wrong data types and actual data\n";

            }

        };

        pConn.onicecandidate = iceCandidate => {

            if (iceCandidate.candidate) {
            
                serverSocket.send(JSON.stringify({type: "ICE", actualData: iceCandidate.candidate}));

            }

        };

        setInterval(() => {

            if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
                
                serverSocket.send(JSON.stringify({ type: "ping" }));
            
            }
        
        }, websocketPing);

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

        if (decoder) { decoder.close(); decoder = null }

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

        if (event.key == "-") {

            allowExit = true
            videoEle.classList.remove(fullScreenStyle)

        } else if (event.key !== "CapsLock") {

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

    if (document.pointerLockElement == videoEle) {

        mxPos = Math.max(0, Math.min(screenSizeX, mxPos + event.movementX));
        myPos = Math.max(0, Math.min(screenSizeY, myPos + event.movementY));

    } else {

        const rect = videoEle.getBoundingClientRect()
        const elementAspect = rect.width / rect.height

        let renderWidth, renderHeight, offsetX, offsetY

        if (videoAspect > elementAspect) {

            renderWidth = rect.width
            renderHeight = rect.width / videoAspect

            offsetX = 0
            offsetY = (rect.height - renderHeight) / 2

        } else {

            renderHeight = rect.height
            renderWidth = rect.height * videoAspect

            offsetX = (rect.width - renderWidth) / 2
            offsetY = 0

        }

        const scaleX = screenSizeX / renderWidth
        const scaleY = screenSizeY / renderHeight

        mxPos = Math.max(0, Math.min(screenSizeX, (event.clientX - rect.left - offsetX) * scaleX))
        myPos = Math.max(0, Math.min(screenSizeY, (event.clientY - rect.top - offsetY) * scaleY))

    }

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

pointerBtn.addEventListener("click", () => {

    if (!document.pointerLockElement) {

        videoEle.requestPointerLock();
    
    } else {

        document.exitPointerLock()

    }

});

fullScreenBtn.addEventListener("click", () => {
    
    if (!videoEle.classList.contains(fullScreenStyle)) {
        
        videoEle.classList.add(fullScreenStyle)
    
    } else {
        
        videoEle.classList.remove(fullScreenStyle)
    
    }

});

pointScreenBtn.addEventListener("click", () => {

    if (!videoEle.classList.contains(fullScreenStyle)) {
        
        videoEle.requestPointerLock();
        videoEle.classList.add(fullScreenStyle)
        
    } else {
        
        document.exitPointerLock()
        videoEle.classList.remove(fullScreenStyle)
    
    }

});

document.addEventListener('pointerlockchange', () => {

    if (!document.pointerLockElement) {       

        if (allowExit) {
        
            allowExit = false
        
        } else {
        
            videoEle.requestPointerLock()
        
        }
  
    }

})

videoEle.addEventListener("wheel", (event) => {

    totalScroll += event.deltaY;

});

setInterval(() => {

    mousePacket();

}, mousePollRate);

setInterval(() => {
    
   errorEle.value = "";

}, errorClearTime)