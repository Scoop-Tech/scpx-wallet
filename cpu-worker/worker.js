// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const _ = require('lodash')
const configWallet = require('../config/wallet')
const opsWallet = require('../actions/wallet')
const walletAccount = require('../actions/wallet-account')
const utilsWallet = require('../utils')

// setup
var workerThreads = undefined
try {
    workerThreads = require('worker_threads')
} catch(err) {
    console.warn(`Failed to require(worker_threads): browser-env assumed...`)
}
const workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId
if (workerThreads) { // server
    workerThreads.parentPort.onmessage = handler
    self = global
    self.postMessage = (msg) => { return workerThreads.parentPort.postMessage(msg) }
}
else { // browser
    onmessage = handler
}

self.window = self // for utilsWallet.getMainThreadGlobalScope in web worker context

// error handlers
if (configWallet.WALLET_ENV === "SERVER") {
    if (!configWallet.IS_DEV) {
        process.on('unhandledRejection', (reason, promise) => {
            utilsWallet.error(`## unhandledRejection (cpuWorker) - ${reason}`, promise, { logServerConsole: true })
        })
        process.on('uncaughtException', (err, origin) => {
            utilsWallet.error(`## uncaughtException (cpuWorker) - ${err.toString()}`, origin, { logServerConsole: true })
        })
    }
}

utilsWallet.logMajor('magenta','white', `... cpuWorker - ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV}) >> ${workerId} - workerThreads(node): ${workerThreads !== undefined} - init ...`, null, { logServerConsole: true })

//
// handler: for main-thread postMessage ==> cpu-worker
//
async function handler(e) {
    if (!e) { utilsWallet.error(`cpuWorker >> ${workerId} no event data`); return Promise.resolve() }
    const eventData = e.data !== undefined && e.data.data !== undefined ? e.data : e // node 10 experimental worker threads vs node 13 / brower env
    if (!eventData.msg || !eventData.data) { utilsWallet.error(`cpuWorker >> ${workerId} bad event, workerThreads=${workerThreads} e=`, e); return Promise.resolve() }

    const msg = eventData.msg
    const data = eventData.data
    
    // StMaster - read & apply passed stm payload (i.e. dynamic add to walletConfig et al...)
    //utilsWallet.log(`StMaster - (cpu-worker) got data... >> ${workerId} - workerThreads(node): ${workerThreads !== undefined}`, data)
    if (data !== undefined) {
        if (data.stm_ApiPayload !== undefined) {
            if (configWallet.get_stm_ApiPayload() === undefined) {
                utilsWallet.log(`StMaster - (cpu-worker) setting stm_ApiPayload... >> ${workerId} - workerThreads(node): ${workerThreads !== undefined}`, data.stm_ApiPayload)
                configWallet.set_stm_ApiPayload(data.stm_ApiPayload)
                utilsWallet.log(`StMaster - (cpu-worker) set stm_ApiPayload... >> ${workerId} - configWallet.get_stm_ApiPayload()=`, configWallet.get_stm_ApiPayload())
                await configWallet.getSupportedWalletTypes()
            }
        }
    }

    switch (msg) {
        case 'DIAG_PING':
            utilsWallet.log(`cpuWorker >> ${workerId} DIAG_PING...`)
            const pongTime = new Date().getTime()
            self.postMessage({ msg: 'DIAG_PONG', status: 'RES', data: { pongTime } })
            break

        case 'WALLET_ADDR_FROM_PRIVKEY':
            //utilsWallet.debug(`cpuWorker >> ${workerId} WALLET_ADDR_FROM_PRIVKEY...`)
            if (data) {
                const params = data.params
                const reqId = data.reqId
                const totalReqCount = data.totalReqCount

                var ret = null
                try {
                    ret = opsWallet.newWalletAddressFromPrivKey(params)
                    ret.symbol = params.symbol
                }
                catch(err) {
                    utilsWallet.error(`## cpuWorker >> ${workerId} - WALLET_ADDR_FROM_PRIVKEY, e=`, err)
                }
                
                //utilsWallet.debug(`cpuWorker >> ${workerId} WALLET_ADDR_FROM_PRIVKEY - DONE: reqId=`, reqId)
                self.postMessage({ msg: 'WALLET_ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, reqId, totalReqCount } })
            }
            else {
                utilsWallet.error(`## cpuWorker >> ${workerId} - WALLET_ADDR_FROM_PRIVKEY - no data`)
            }
            break

        case 'ADDR_FROM_PRIVKEY':
            //utilsWallet.debug(`cpuWorker >> ${workerId} ADDR_FROM_PRIVKEY...`)
            if (data) {
                const params = data.params
                const reqId = data.reqId
                const totalReqCount = data.totalReqCount

                var ret = null
                try {
                    ret = opsWallet.getAddressFromPrivateKey(params)
                }
                catch(err) {
                    debugger
                    utilsWallet.error(`## cpuWorker >> ${workerId} - ADDR_FROM_PRIVKEY, err=`, err)
                }
                
                //utilsWallet.debug(`cpuWorker >> ${workerId} ADDR_FROM_PRIVKEY - DONE: reqId=`, reqId)
                self.postMessage({ msg: 'ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, inputParams: params, reqId, totalReqCount } })
            }
            break
    }
    return Promise.resolve()
}
