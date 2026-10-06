// A helper thread of the desktop backend: the same work as the browser's helper Web Workers.
import { parentPort } from 'node:worker_threads';
import { handleHelperMessage } from '../src/workers/helpers.js';

parentPort.on('message', (m) => handleHelperMessage(m, (msg, transfer) => parentPort.postMessage(msg, transfer || [])));
