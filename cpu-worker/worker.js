const BigNumber = require('bignumber.js')
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')

var workerThreads = undefined
try {
    workerThreads = require('worker_threads') 
} catch(err) { // expected - when running in browser
}

const workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId

console.log(` ... cpuWorker - (WALLET) v-${configWallet.WALLET_VER} >> ${workerId} - init ... `)

var outbound = undefined
if (workerThreads) { // server
    workerThreads.parentPort.onmessage = handler
    outbound = workerThreads.parentPort
}
else { // browser
    onmessage = handler
    outbound = self
}

function handler(e) {
    //if (!e || !e.data || !e.data.msg) { console.error(`cpuWorker >> ${workerId} bad event, e=`, e); return }

    if (!e) { console.error(`cpuWorker >> ${workerId} no event data`); return }

    const eventData = !workerThreads ? e.data : e
    if (!eventData.msg || !eventData.data) { console.error(`cpuWorker >> ${workerId} bad event, e=`, e); return }

    const msg = eventData.msg
    const data = eventData.data
    switch (msg) {
        case 'DIAG_PING': {
            console.log(`cpuWorker >> ${workerId} DIAG_PING`)
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
                    console.error(`## cpuWorker >> ${workerId} - WALLET_ADDR_FROM_PRIVKEY, e=`, err)
                }
                
                //console.log(`cpuWorker >> ${workerId} WALLET_ADDR_FROM_PRIVKEY - DONE: reqId,params,ret=`, reqId, params, ret)
                outbound.postMessage({ msg: 'WALLET_ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, reqId, totalReqCount } })
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
                    console.error(`## cpuWorker >> ${workerId} - ADDR_FROM_PRIVKEY, err=`, err)
                }
                
                //console.log(`cpuWorker >> ${workerId} ADDR_FROM_PRIVKEY - DONE: reqId,params,ret=`, reqId, params, ret)
                outbound.postMessage({ msg: 'ADDR_FROM_PRIVKEY', status: `RES_${reqId}`, data: { ret, inputParams: params, reqId, totalReqCount } })
            }
        }
        break
    }
}

