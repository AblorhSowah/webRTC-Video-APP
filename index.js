 const express = require('express');
const socket = require('socket.io');


var app = express();
const server = app.listen(9000, function(){
console.log('listing to port 9000');node
})

//indexing the first page in the public folder
app.use(express.static('public'));


const io = socket(server);

const users = {};

io.on('connection', function(socket){
console.log("New user logged: With id {" + socket.id + "}" );

 socket.on('UserStart', function(data){

      //switching type of the user message 
      switch (data.type) { 
         //when a user tries to login
         case "login": 
            console.log("Username", data.name); 
				
            //if anyone is logged in with this username then refuse 
            if(users[data.name]) { 
            	socket.emit('message', {
				  type: "login", 
                  success: false 
            	});
              
            } else { 
	               //save user connection on the server 
		              users[data.name] = socket; 
		              socket.name = data.name; 
						
					  socket.emit('message', {
					  type: "login", 
	                  success: true 

            	});
              
                } 

               break;

     case "offer": 

            //if UserB exists then send him offer details 
            var conn = users[data.name]; 
				
            if(conn != null) { 
              console.log("Sending offer to: ", data.name);
               //setting that UserA connected with UserB 
              
              
            }else{
           socket.emit('message', {
                type: "invalid"
           });

            }
				
            break;

        case "leave":

         console.log("Disconnecting from", data.name); 
            var conn = users[data.name]; 
     
        
            //notify the other user so he can disconnect his peer connection 
            if(conn != null) {
              socket.emit('message', {
                type: "leave" 

              });
            }
        
            break;
        

         default: 
			        socket.emit('message', {
				    type: "errr", 
		        message: "Command no found: " + data.type 

            	});
			
         break;

    }  
});
 
  socket.on('msg', function(message){
     console.log(message);
       socket.emit('offer', message);

   });
        

socket.on('answer', function(answer){
  console.log('answer');

  socket.emit('Reanswer', answer);

});

});