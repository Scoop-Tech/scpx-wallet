const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const walletAccount = require('../actions/wallet-account')

const utilsWallet = require('../utils')

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

// error handlers
if (configWallet.WALLET_ENV === "SERVER") {
    process.on('unhandledRejection', (reason, promise) => {
        utilsWallet.error(`## unhandledRejection (cpuWorker) - ${reason}`, promise, { logServerConsole: true })
    })
    process.on('uncaughtException', (err, origin) => {
        utilsWallet.error(`## uncaughtException (cpuWorker) - ${reason}`, promise, { logServerConsole: true })
    })
}

utilsWallet.logMajor('magenta','white', `... cpuWorker - ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV}) >> ${workerId} - init ...`, null, { logServerConsole: true })

function handler(e) {
    if (!e) { utilsWallet.error(`cpuWorker >> ${workerId} no event data`); return }

    const eventData = !workerThreads ? e.data : e
    if (!eventData.msg || !eventData.data) { utilsWallet.error(`cpuWorker >> ${workerId} bad event, e=`, e); return }
    const msg = eventData.msg
    const data = eventData.data
    switch (msg) {
        // case 'TEST_TXDB':
        //     utilsWallet.txdb_setItem('TEST_TXDB', { test: 42, test2: "42" })
        //     .then(() => {
        //         utilsWallet.log(`** TEST_TXDB - added to cache ok`)
        //         self.postMessage({ msg: 'TEST_TXDB', status: 'RES', data: { ok: true } })
        //     })
        //     .catch((err) => {
        //         utilsWallet.error(`## TEST_TXDB - error writing cache=`, err)
        //         self.postMessage({ msg: 'TEST_TXDB', status: 'RES', data: { ok: false } })
        //     })
        //     break

        // case 'TEST_WEB3':
        //     walletAccount.test_web3()
        //     self.postMessage({ msg: 'DIAG_TEST_WEB3', status: 'RES', data: { ok: true } })
        //     break

        case 'DIAG_PING':
            utilsWallet.debug(`cpuWorker >> ${workerId} DIAG_PING...`)
            const pongTime = new Date().getTime()
            self.postMessage({ msg: 'DIAG_PONG', status: 'RES', data: { pongTime } })
            break

        case 'WALLET_ADDR_FROM_PRIVKEY':
            if (data) {
                const params = data.params
                const reqId = data.reqId
                const totalReqCount = data.totalReqCount

                var ret = null
                try {
                    ret = walletActions.newWalletAddressFromPrivKey(params)
                    ret.symbol = params.symbol
                }
                catch(err) {
                    utilsWallet.error(`## cpuWorker >> ${workerId} - WALLET_ADDR_FROM_PRIVKEY, e=`, err)
                }
                
                //utilsWallet.log(`cpuWorker >> ${workerId} WALLET_ADDR_FROM_PRIVKEY - DONE: reqId=`, reqId)
                self.postMessage({ msg: 'WALLET_ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, reqId, totalReqCount } })
            }
            else {
                utilsWallet.error(`## cpuWorker >> ${workerId} - WALLET_ADDR_FROM_PRIVKEY - no data`)
            }
            break

        case 'ADDR_FROM_PRIVKEY':
            if (data) {
                const params = data.params
                const reqId = data.reqId
                const totalReqCount = data.totalReqCount

                var ret = null
                try {
                    ret = walletActions.getAddressFromPrivateKey(params)
                    //ret.symbol = params.symbol
                }
                catch(err) {
                    utilsWallet.error(`## cpuWorker >> ${workerId} - ADDR_FROM_PRIVKEY, err=`, err)
                }
                
                //utilsWallet.log(`cpuWorker >> ${workerId} ADDR_FROM_PRIVKEY - DONE: reqId,params,ret=`, reqId, params, ret)
                self.postMessage({ msg: 'ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, inputParams: params, reqId, totalReqCount } })
            }
            break
    }
}

