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

