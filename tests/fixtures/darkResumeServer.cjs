// Private child process used solely by the durable combat restart test.
if(process.env.NODE_ENV!=='test'||process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test server required');
const http=require('node:http'),express=require('express'),{Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../../server/http/routes'));io.use(require('../../server/http/authMiddleware').authenticateSocket);require('../../server/realtime/socketHandler')(io);
server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('message',async message=>{if(message!=='stop')return;require('../../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../../server/realtime/accountConnection').waitForAccountConnections(io);await require('../../server/config/database').dbPool.end();process.exit(0);});
