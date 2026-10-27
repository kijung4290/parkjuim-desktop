const {parentPort,workerData}=require('node:worker_threads');
const {parseOffice}=require('./file-parser.cjs');
parseOffice(Buffer.from(workerData.buffer),workerData.extension)
  .then(text=>parentPort.postMessage({text}))
  .catch(error=>parentPort.postMessage({error:error.message}));
