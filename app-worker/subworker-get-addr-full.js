
const workerAddressMempool = require('./worker-blockbook-mempool')
const workerExternal  = require('./worker-external')
const configWallet = require('../config/wallet')
const utilsWallet = require('../utils')

// CHILD WORKER: BOILERPLATE START
// setup
var workerThreads = undefined
try {
    workerThreads = require('worker_threads') 
} catch(err) {} // expected - when running in browser
const workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId
if (workerThreads) { // server
    workerThreads.parentPort.onmessage = handler
    self = global
    self.postMessage = (msg) => { return workerThreads.parentPort.postMessage(msg) }
}
else { // browser
    onmessage = handler
}
self.window = self // for web3, and utilsWallet.getMainThreadGlobalScope in web worker context
self.workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId
// CHILD WORKER: BOILERPLATE END

workerFn = e => {
    const params = e.data //!workerThreads ? e.data : e
    const { asset, wallet } = params

    //****
    //...
    //****

    //self.postMessage("Yo!");
}
