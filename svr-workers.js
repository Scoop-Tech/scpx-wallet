'use strict';

const { Worker, isMainThread, parentPort } = require('worker_threads')

import * as configWallet from './config/wallet'
import * as utilsWallet from './utils'

import * as log from './cli-log'

// setup cpuWorkers and singleton appWorker
export async function workers_init() {
    const globalScope = utilsWallet.getMainThreadGlobalScope()

    // create cpu workers
    if (globalScope.cpuWorkers === undefined || globalScope.cpuWorkers.length == 0) { 
        globalScope.cpuWorkers = []
        globalScope.CPU_WORKERS = 8
        for (var i=0 ; i < globalScope.CPU_WORKERS ; i++) {
            globalScope.cpuWorkers.push(new Worker('./cpu-worker/worker.js'))
        }
        globalScope.nextCpuWorker = 0
    }

    // create app worker
    if (globalScope.appWorker === undefined) {
        globalScope.appWorker = new Worker('./app-worker/worker.js')
    }

    // ping workers
    const pongs = globalScope.cpuWorkers.concat([globalScope.appWorker]).map(worker => {
        return new Promise((resolve) => {
            worker.once('message', (data) => { resolve(true) })
            worker.postMessage({ msg: 'DIAG_PING', data: {} })
        })
    })
    return Promise.all(pongs)
}

export function initSockets_LoadAssets() {
    const globalScope = utilsWallet.getMainThreadGlobalScope()
    const appWorker = globalScope.appWorker
    if (!appWorker) throw 'No app worker'

    return new Promise((resolve) => {

        appWorker.postMessage({ msg: 'INIT_WEB3_SOCKET', data: {} })
        appWorker.postMessage({ msg: 'INIT_INSIGHT_SOCKETIO', data: {} })
        
        function blockbookListener(event) {
            if (event && event.data && event.msg) {
                const data = event.data
                const msg = event.msg

                if (msg === 'BLOCKBOOK_ISOSOCKETS_DONE') {
                    console.log(event)

                    log.info(`Received: BLOCKBOOK_ISOSOCKETS_DONE`)

                    //appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet: this.props.wallet } })
                    //...
                    //loadAllAssets() 

                    resolve({ ok: 'Sockets initiated' })
                    appWorker.removeListener('message', blockbookListener)
                    
                }
            }
        }
        appWorker.on('message', blockbookListener)

        appWorker.postMessage({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { timeoutMs: configWallet.VOLATILE_SOCKETS_REINIT_SECS * 0.75 * 1000 } })
        appWorker.postMessage({ msg: 'INIT_GETH_ISOSOCKETS', data: {} }) 
        var volatileReInit_intId = setInterval(() => {
            appWorker.postMessage({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { timeoutMs: configWallet.VOLATILE_SOCKETS_REINIT_SECS * 0.75 * 1000 } })
            appWorker.postMessage({ msg: 'INIT_GETH_ISOSOCKETS', data: {} })
        }, configWallet.VOLATILE_SOCKETS_REINIT_SECS * 1000)

    })

    // return new Promise((resolve) => {
    //     resolve({ ok: 'Sockets initiated' })
    // })
}
