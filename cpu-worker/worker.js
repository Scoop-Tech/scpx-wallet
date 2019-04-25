const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const walletAccount = require('../actions/wallet-account')

const utilsWallet = require('../utils')

var workerThreads = undefined
try {
    workerThreads = require('worker_threads') 
} catch(err) {} // expected - when running in browser
const workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId

var outbound = undefined
if (workerThreads) { // server
    workerThreads.parentPort.onmessage = handler
    outbound = workerThreads.parentPort
    self = global //... for app-worker
}
else { // browser
    onmessage = handler
    outbound = self
}

self.test = '42'
utilsWallet.logWorker(` ... cpuWorker - ${self.test} ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV}) >> ${workerId} - init ... `)

function handler(e) {
    //if (!e || !e.data || !e.data.msg) { utilsWallet.error(`cpuWorker >> ${workerId} bad event, e=`, e); return }

    if (!e) { utilsWallet.error(`cpuWorker >> ${workerId} no event data`); return }

    const eventData = !workerThreads ? e.data : e
    if (!eventData.msg || !eventData.data) { utilsWallet.error(`cpuWorker >> ${workerId} bad event, e=`, e); return }

    const msg = eventData.msg
    const data = eventData.data
    switch (msg) {
        case 'TEST_WEB3': {
            walletAccount.test_web3()
            outbound.postMessage({ msg: 'DIAG_TEST_WEB3', status: 'RES', data: { ok: true } })
        }

        case 'DIAG_PING': {
            const pongTime = new Date().getTime()
            outbound.postMessage({ msg: 'DIAG_PONG', status: 'RES', data: { pongTime } })
            break
        }

        case 'WALLET_ADDR_FROM_PRIVKEY': {
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
                outbound.postMessage({ msg: 'WALLET_ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, reqId, totalReqCount } })
            }
            else {
                utilsWallet.error(`## cpuWorker >> ${workerId} - WALLET_ADDR_FROM_PRIVKEY - no data`)
            }
        }
        break

        case 'ADDR_FROM_PRIVKEY': {
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
                outbound.postMessage({ msg: 'ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, inputParams: params, reqId, totalReqCount } })
            }
        }
        break
    }
}

