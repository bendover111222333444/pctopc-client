const sendButton = document.getElementById("sendBtn");
const closeButton = document.getElementById("closeBtn");
const txtInput = document.getElementById("textInput");
const videoEle = document.getElementById("videoPlayer");
const setScaleEle = document.getElementById("setScaleBtn");
const errorEle = document.getElementById("errorBox");
const pointerBtn = document.getElementById("pointerBtn");
const fullScreenBtn = document.getElementById("fullScreenBtn");
const pointScreenBtn = document.getElementById("pointScreenBtn");
const volumeLabel = document.getElementById("volumeLabel");
const volumeSlider = document.getElementById("volumeSlider");
const fpsCounterLabel = document.getElementById("fpsCounterLabel");

const mousePollRate = 10; // in ms
const errorClearTime = 300_000; // ms
const websocketPing = 120_000; // also ms
const maxHeaderSize = 10_000_000 // mb or something
const maxDecodeQueue = 30; // frames
const stalledInterval = 3000 // ms

const fullScreenStyle = "fullscreen-thing"

let serverSocket;
let decoder;
let pConn;
let inputChannel;
let videoChannel;
let audioEle;
let started = false;
let allowExit = false;
let remoteDescSet = false;

let fps = 0
let fpsCounter = 0

let mxPos = 0;
let myPos = 0;
let pmxPos = 0;
let pmyPos = 0;

let healthInterval = null
let pendingHeader = null
let frameBuffer = null

let lastFrameTime = Date.now()
let frameOffset = 0
let gotKeyframe = false
let intentionalRestart = false

let frameCount = 0

let screenVolume = 1;
let totalScroll = 0;

let screenSizeX = 3840;
let screenSizeY = 2160;
let videoAspect = screenSizeX / screenSizeY

let iceCandidateQueue = [];

const signalingWorker = "signaling.bendover111222333444.great-site.net" // change this to your own if you are forking or it wont work

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

    const response = await fetch(`https://${signalingWorker}/turn-creds`) // this could break in the future if it becomes deprecated and also dont use it just use there offical service its just because im poor and i dont have access to a offical credit card
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
// add mac and linux support
// add good ui
// add shut down button key binds and generally key binds
// add cookies to renember user
// fix random disconnects (maybe fixed)
// add back the origin thing
// fix pointer
// add switch between gpu and cpu 

// Commented out shiz is depricated stuff

async function restartDecoder() {

    intentionalRestart = true
    lastFrameTime = Date.now()

    if (decoder && decoder.state !== 'closed') {

        decoder.close()
        decoder = null

    }

    gotKeyframe = false
    pendingHeader = null
    frameBuffer = null
    frameOffset = 0
    frameCount = 0

    const generator = new MediaStreamTrackGenerator({ kind: 'video' })
    const writer = generator.writable.getWriter()
    videoEle.srcObject = new MediaStream([generator])

    writer.closed.then(() => {

        if (!intentionalRestart) errorEle.value += 'Writer closed\n'
        intentionalRestart = false

    }).catch(err => {

        errorEle.value += 'Writer error: ' + err + '\n'

    })

    generator.addEventListener('ended', () => {

        errorEle.value += 'Generator track ended\n'

    })

    decoder = new VideoDecoder({

        output: (frame) => {

            fpsCounter++
            lastFrameTime = Date.now()

            if (writer.desiredSize === null) {

                frame.close()
                errorEle.value += 'Writer dead\n'
                restartDecoder()
                return

            }
            if (writer.desiredSize > 0) {

                writer.write(frame)

            } else {

                frame.close()

            }

        },

        error: (err) => {

            errorEle.value += 'Decoder error: ' + err + '\n'
            restartDecoder()

        }
        
    })

    decoder.configure(decoderSettings)

}

async function connectToCapture(roomId) {

    try {

        pConn = new RTCPeerConnection(config)

        serverSocket = new WebSocket(`wss://${signalingWorker}?room=${roomId}`);
        
        await new Promise(resolve => serverSocket.onopen = resolve);

        pConn.onicecandidate = iceCandidate => {

            if (iceCandidate.candidate) {
                
                serverSocket.send(JSON.stringify({type: "ICE", actualData: iceCandidate.candidate}));

            }

        };

        serverSocket.onerror = (err) => errorEle.value += `WS Error: ${JSON.stringify(err)}\n`

        pConn.ontrack = evt => {

            if (evt.track.kind === 'audio') {

                audioEle = new Audio()
                audioEle.srcObject = new MediaStream([evt.track])
                audioEle.volume = screenVolume
                audioEle.play()

            }

        }

        pConn.ondatachannel = event => {
            
           if (event.channel.label === 'video') {

            videoChannel = event.channel
            videoChannel.binaryType = 'arraybuffer'

            lastFrameTime = Date.now()
            restartDecoder();

            videoChannel.onmessage = msg => {

                if (msg.data instanceof ArrayBuffer) {
                    
                    if (!pendingHeader) {

                        if (msg.data.byteLength !== 13) {

                            return

                        }

                        const view = new DataView(msg.data)
                        const totalSize = view.getUint32(9)
                        
                        if (totalSize === 0 || totalSize > maxHeaderSize) {

                            return

                        }

                        pendingHeader = {

                            isKey: view.getUint8(0) === 1,
                            timestamp: frameCount++ * (1_000_000 / 60),
                            totalSize

                        }

                        frameBuffer = new Uint8Array(totalSize)
                        frameOffset = 0
                    
                    } else {
                        
                        const chunk = new Uint8Array(msg.data)
                        
                        if (frameOffset + chunk.byteLength > frameBuffer.byteLength) {
                            
                            pendingHeader = null
                            frameBuffer = null
                            frameOffset = 0
                            return
                        
                        }
                        
                        frameBuffer.set(chunk, frameOffset)
                        frameOffset += chunk.byteLength
                        
                        if (frameOffset === pendingHeader.totalSize) {
                            
                            if (!pendingHeader.isKey && !gotKeyframe) {

                                pendingHeader = null; frameBuffer = null; frameOffset = 0; return

                            }

                            if (decoder.decodeQueueSize > maxDecodeQueue && !pendingHeader.isKey) {

                                pendingHeader = null; frameBuffer = null; frameOffset = 0; return

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

                    remoteDescSet = true;

                    for (const cand of iceCandidateQueue) {

                        try { await pConn.addIceCandidate(cand) } catch(err) {}

                    }

                    iceCandidateQueue = [];

                    const answer = await pConn.createAnswer();
                    await pConn.setLocalDescription(answer);

                    await new Promise(resolve => {

                        if (pConn.iceGatheringState === 'complete') return resolve()

                        pConn.onicegatheringstatechange = () => {

                            if (pConn.iceGatheringState === 'complete') resolve()

                        }

                        setTimeout(resolve, 2000)

                    })


                    serverSocket.send(JSON.stringify({type: "answer", actualData: answer}));

                } else if (data.type == "ICE") {

                    if (remoteDescSet) {

                        try { await pConn.addIceCandidate(data.actualData) } catch(err) {}

                    } else {

                        iceCandidateQueue.push(data.actualData)

                    }
                
                }

            } else {

                errorEle.value += "Wrong data types and actual data\n";

            }

        };

        healthInterval = setInterval(() => {

            if (decoder && decoder.state === 'closed') {

                errorEle.value += 'Decoder died, restarting...\n'
                restartDecoder()

            }

            if (decoder && decoder.state === 'configured') {

                const stalledMs = Date.now() - lastFrameTime

                if (stalledMs > stalledInterval) {
                    errorEle.value += `Decoder stalled (${stalledMs}ms), restarting...\n`
                    restartDecoder()
                    lastFrameTime = Date.now()
                }

            }

        }, stalledInterval)

        serverSocket.onclose = async(err) => {
            
            errorEle.value += `WS Closed: ${err.code} ${err.reason}\n`
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

        clearInterval(healthInterval)
        healthInterval = null;

        if (audioEle) {

            audioEle.pause()
            audioEle.srcObject = null
            audioEle = null
        
        }

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

        if (event.key == "Escape") {

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

volumeSlider.addEventListener("input", () => {

    const flooredVolume = Math.floor(volumeSlider.value)

    screenVolume = (flooredVolume / volumeSlider.max);

    volumeLabel.textContent = `${flooredVolume}%`

    if (audioEle) {
    
        audioEle.volume = screenVolume
    
    } else {

        errorEle.value += "Video Connection has not been intialized yet" + '\n'

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

setInterval(() => {
    
    fps = fpsCounter
    fpsCounter = 0
    
    fpsCounterLabel.textContent = `Fps: ${fps}`

}, 1000)