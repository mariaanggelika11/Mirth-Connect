// Send an HL7 file to a local test destination: node server/send-hl7.js path/to/message.hl7
import { readFile } from 'node:fs/promises';
import { sendTcp } from './dist/utils/transport.js';
try {if(!process.argv[2])throw new Error();const payload=await readFile(process.argv[2],'utf8');await sendTcp(process.env.TEST_RECEIVER_ENDPOINT||'127.0.0.1:2576',payload);console.info('ACK_ACCEPTED');}catch{console.error('TEST_DELIVERY_FAILED');process.exitCode=1;}
