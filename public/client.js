const socket = io.connect('localhost:9000'); 
const peerConnection = new RTCPeerConnection();


let  usernameInput = document.querySelector('#usernameInput'); 
let  loginBtn = document.querySelector('#loginBtn'); 

let  callPage = document.querySelector('#callPage');

let  callToUsernameInput = document.querySelector('#callToUsernameInput');
let  callBtn = document.querySelector('#callBtn'); 

let  hangUpBtn = document.querySelector('#hangUpBtn');
  
let  video = document.querySelector('#localVideo'); 
let  remoteVideo = document.querySelector('#remoteVideo'); 
 


let stream;
callPage.style.display = "none";

socket.on('message', function(data){
switch(data.type) {
     case "login": 
         handleLogin(data.success); 
         break; 
     case "errr":
       alert("check data " + data.message);
       break;  
     case "invalid":
       Invalid();
     case "leave": 
     handleLeave(); 
    default: 
         break; 
   }
});

	
loginBtn.addEventListener("click", function () { 
var name = usernameInput.value;
   if (name.length > 0) { 
      socket.emit('UserStart', { 
      	type: 'login',
      	name: name 
             });
   }	else{
alert("please anter username");

 } 
});


function handleLogin(success) { 
  if (success === false) { 
  	Swal.fire('Ooops...username already taken! Try a different username');
      
   } else { 
      loginPage.style.display = "none"; 
      callPage.style.display = "block";

}

};

  
//initiating a call 
callBtn.addEventListener("click", function () { 

let CallUser = callToUsernameInput.value
alert(usernameInput.value);
	
   if (CallUser != null || CallUser!= '') { 
Swal.fire("calling  " + callToUsernameInput.value);


navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia
 || navigator.mozGetUserMedia;


navigator.mediaDevices.getUserMedia({ audio: true, video: true })
.then(function(stream) {
video.srcObject = stream;
  peerConnection.addStream(stream);
  peerConnection.createOffer()
  .then(sdp => peerConnection.setLocalDescription(new RTCSessionDescription(sdp)))
  .then(function(){

socket.emit('msg', peerConnection.localDescription);

 socket.emit('UserStart', {
           type:"offer",
           name:callToUsernameInput.value  
      });
 })
	
   })
}else{
  alert('please user is not available or chack user name');
}
});



socket.on('offer', function (message){
 alert('offer received');
	peerConnection.setRemoteDescription(message)
	.then(() => peerConnection.createAnswer())
	.then(sdp => peerConnection.setLocalDescription(new RTCSessionDescription(sdp)))
	.then(function(){
		socket.emit('answer', peerConnection.localDescription);
	});


peerConnection.onaddstream = function(event){
	remoteVideo.srcObject = event.stream;
};

});

socket.on('Reanswer', function(answer){
	console.log("sending answer back");
 peerConnection.setRemoteDescription(new RTCSessionDescription(answer));


});


hangUpBtn.addEventListener("click", function () { 
  socket.emit('UserStart', {
  type: "leave",
  name: callToUsernameInput.value
  });
  handleLeave(); 
});

function handleLeave() { 
    
   remoteVideo.src = null;
   peerConnection.ontrack = null; 
};

function Invalid(){
Swal.fire("username name not found on the server");


};

