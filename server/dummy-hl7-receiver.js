// Local test harness only. Build first. Never use as the hospital ingress.
import net from 'node:net';
import { MllpDecoder,frame } from './dist/utils/mllp.js';
import { buildAck,parseSegments } from './dist/utils/hl7Converer.js';
const server=net.createServer(socket=>{
  const decoder=new MllpDecoder();socket.setTimeout(10000,()=>socket.destroy());socket.on('error',()=>console.error('TEST_SOCKET_ERROR'));
  socket.on('data',chunk=>{try{for(const raw of decoder.push(chunk)){let code='AA';try{parseSegments(raw);}catch{code='AR';}socket.write(frame(buildAck(raw,code)));console.log(JSON.stringify({event:'TEST_ACK',code}));}}catch{socket.destroy();}});
});
server.listen(Number(process.env.TEST_RECEIVER_PORT||2576),'127.0.0.1',()=>console.info('Local MLLP test receiver ready'));
