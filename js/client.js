const sendButton = document.getElementById("sendBtn");
const closeButton = document.getElementById("closeBtn");
const txtInput = document.getElementById("textInput");
const videoEle = document.getElementById("videoPlayer");

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

function mouseClick(event) {
    
    let xPos = 0;
    let yPos = 0;

    if ((pmxPos !== mxPos) || (pmyPos !== myPos)) {

        mxPos = event.offsetX;
        myPos = event.offsetY;
                    
        pmxPos = mxPos;
        pmyPos = myPos;

        if (mxPos !== 0) {
            xPos = (mxPos / videoEle.offsetWidth) * screenSizeX;
        }

        if (myPos !== 0) {
            yPos = (myPos / videoEle.offsetHeight) * screenSizeY;
        }
                    
    } else {

        xPos = pmxPos;
        yPos = pmyPos;

    }

    if (inputChannel.readyState === "open") {

        inputChannel.send(JSON.stringify({inputType: "moveMouse", xPos: xPos, yPos: yPos}))

    }

}

generateCreds();

let pConn;

(async () => {

    await generateCreds();
    pConn = new RTCPeerConnection(config);

})();

const mousePollRate = 1 / 10;

let serverSocket;
let started = false;
let fps = 60;

let mxPos = 0;
let myPos = 0;
let pmxPos = 0;
let pmyPos = 0;

let totalScroll = 0;

let screenSizeX = 1920;
let screenSizeY = 1080;

// todo:
// add mac support
// fix screen changing and breaking mouse pos
// add good ui
// add shut down button key binds and generally key binds
// add mobile full support
// add proper error messages
// get best decoding method
// add toggle capture here

async function connectToCapture(roomId) {

    try {

        serverSocket = new WebSocket(`wss://pctopc.sigmasigmaonthewallwhoisthe2.workers.dev?room=${roomId}`)

        await new Promise(resolve => serverSocket.onopen = resolve);

        console.log("socket connected")

        pConn.ontrack = evt => {

            evt.receiver.jitterBufferTarget = 0

            const stream = evt.streams[0];

            videoEle.srcObject = stream

            videoEle.addEventListener('loadedmetadata', () => {

                screenSizeX = videoEle.videoWidth;
                screenSizeY = videoEle.videoHeight;

            });

        }

        pConn.ondatachannel = evt => {

            const inputChannel = evt.channel;

            inputChannel.onopen = () => {

                document.addEventListener("keydown", (event) => {

                    if (inputChannel.readyState === "open") {

                        inputChannel.send(JSON.stringify({inputType: "key", release: false, keyType: event.key}))

                    }

                });

                document.addEventListener("keyup", (event) => {

                    if (inputChannel.readyState === "open") {

                        inputChannel.send(JSON.stringify({inputType: "key", release: true, keyType: event.key}))

                    }
                    
                });
                
                videoEle.addEventListener("mousemove", (event) => {

                    mxPos = event.offsetX;
                    myPos = event.offsetY;

                });

                videoEle.addEventListener("mousedown", (event) => {
                                            
                    mouseClick(event);

                    if (inputChannel.readyState === "open") {

                        inputChannel.send(JSON.stringify({inputType: "click", clickType: event.button, release: false}))

                    }

                });

                videoEle.addEventListener("mouseup", (event) => {

                    mouseClick(event);

                    if (inputChannel.readyState === "open") {

                        inputChannel.send(JSON.stringify({inputType: "click", clickType: event.button, release: true}))

                    }

                });

                videoEle.addEventListener("wheel", (event) => {

                    totalScroll += event.deltaY;

                });

                setInterval(() => {
                    
                    if ((pmxPos !== mxPos) || (pmyPos !== myPos)) {
                        
                        pmxPos = mxPos;
                        pmyPos = myPos;

                        let xPos = 0;
                        let yPos = 0;

                        if (mxPos !== 0) {
                            xPos = (mxPos / videoEle.offsetWidth) * screenSizeX;
                        }

                        if (myPos !== 0) {
                            yPos = (myPos / videoEle.offsetHeight) * screenSizeY;
                        }

                        if (inputChannel.readyState === "open") {

                            inputChannel.send(JSON.stringify({inputType: "moveMouse", xPos: xPos, yPos: yPos}))

                        }

                    } 
                    
                    if (totalScroll !== 0){

                        const finalScroll = totalScroll;

                        totalScroll = 0;

                        if (inputChannel.readyState === "open") {

                            inputChannel.send(JSON.stringify({inputType: "click", clickType: 3, scrollDistance: finalScroll}))

                        }

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

        serverSocket.onclose = () => {
            
            stopCapture();

        }

    } catch (err) {

        console.log(err);
    
    }

}

async function stopCapture() {
    
    if (started == true) {

        started = false;

        if (pConn) {

            pConn.close();
            pConn = null;

            pConn = new RTCPeerConnection(config)

        }

        if (serverSocket) {

            serverSocket.close();
            serverSocket = null;

        }

        videoEle.srcObject = null;

    }

}

function startCapture() {

    const roomId = (txtInput.value).trim();

    if (roomId && started == false) {

        started = true;

        connectToCapture(roomId);

    }

    txtInput.value = "";

}

sendButton.addEventListener("click", () => {

    startCapture();
    
});

closeButton.addEventListener("click", () => {

    stopCapture();

});