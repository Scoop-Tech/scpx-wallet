'use strict';

const { Worker, isMainThread, parentPort } = require('worker_threads')

const configWallet = require('./config/wallet')
const utilsWallet = require('./utils')

const appWorkerCallbacks = require('./actions/appWorkerCallbacks')

module.exports = {

    // setup cpuWorkers and singleton appWorker
    workers_init: async (store) => {
        const globalScope = utilsWallet.getMainThreadGlobalScope()

        // create cpu workers
        if (globalScope.cpuWorkers === undefined || globalScope.cpuWorkers.length == 0) { 
            globalScope.cpuWorkers = []
            globalScope.CPU_WORKERS = 8
            for (var i=0 ; i < globalScope.CPU_WORKERS ; i++) {
                globalScope.cpuWorkers.push(new Worker(`${__dirname}/cpu-worker/worker.js`))
            }
            globalScope.nextCpuWorker = 0
        }

        // create app worker
        if (globalScope.appWorker === undefined) {
            globalScope.appWorker = new Worker(`${__dirname}/app-worker/worker.js`)
            globalScope.appWorker.on('message', event => {
                appWorkerCallbacks.appWorkerHandler(store, event)
            })
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
}
