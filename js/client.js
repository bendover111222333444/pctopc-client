const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const videoEle = document.getElementById("videoPlayer");

async function startCapture() {

    try {

        const capture = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});

        videoEle.srcObject = capture;

        capture.getVideoTracks()[0].onended(function () {
           
            stopCapturing(capture);
            
        });


    } catch (err) {

        console.log(err);
    
    }

}

function stopCapturing(capture) {
            
    capture.getTracks().forEach(function(track){
               
        track.stop();
                
    });

    videoEle.srcObject = null;
        
}

startBtn.addEventListener("click", function(){
    
    startCapture();

});

stopBtn.addEventListener("click", function(){
    
    stopCapture();

});