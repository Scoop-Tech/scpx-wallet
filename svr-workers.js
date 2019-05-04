// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.
const { Worker, isMainThread, parentPort } = require('worker_threads')

const configWallet = require('./config/wallet')
const utilsWallet = require('./utils')

const appWorkerCallbacks = require('./actions/appWorkerCallbacks')

const log = require('./cli-log')

module.exports = {

    // setup cpuWorkers and singleton appWorker
    workers_init: async (store) => {
        const globalScope = utilsWallet.getMainThreadGlobalScope()

        // create cpu workers
        if (globalScope.cpuWorkers === undefined || globalScope.cpuWorkers.length == 0) { 
            globalScope.cpuWorkers = []
            globalScope.CPU_WORKERS = 8
            for (var i=0 ; i < globalScope.CPU_WORKERS ; i++) {
                const worker = new Worker(`${__dirname}/cpu-worker/worker.js`)
                
                worker.setMaxListeners(30) // a reasonable number which if exceeded would indicate a leak
                worker.removeEventListener = worker.removeListener // map same interface as web worker
                worker.addEventListener = worker.on

                globalScope.cpuWorkers.push(worker)
            }
            globalScope.nextCpuWorker = 0
        }

        // create app worker
        if (globalScope.appWorker === undefined) {
            globalScope.appWorker = new Worker(`${__dirname}/app-worker/worker.js`)
            
            globalScope.appWorker.setMaxListeners(30) 
            globalScope.appWorker.removeEventListener = globalScope.appWorker.removeListener 
            globalScope.appWorker.addEventListener = globalScope.appWorker.on

            globalScope.appWorker.on('message', event => {
                
                appWorkerCallbacks.appWorkerHandler(store, event) // handle common core app worker callbacks

                const postback = event.data
                const msg = event.msg
                const status = event.status
                if (msg === 'NOTIFY_USER') {
                    utilsWallet.logMajor('green', 'white',
                        `${postback.type}: ${postback.headline} ${postback.info} ${postback.desc1} ${postback.desc2} ${postback.txid}`,
                        null, { logServerConsole: true })
                }
            })

            await txdb_init()
        }

        // ping workers
        const pongs = globalScope.cpuWorkers.concat([globalScope.appWorker]).map(worker => {
            return new Promise((resolve) => {
                worker.once('message', (data) => { resolve(true) })
                worker.postMessage({ msg: 'DIAG_PING', data: {} })
            })
        })
        return Promise.all(pongs)
    },

    txdb_init: () => { 
        txdb_init()
    },

    workers_terminate: () => {
        const globalScope = utilsWallet.getMainThreadGlobalScope()
        if (globalScope.cpuWorkers !== undefined) {
            log.info(`Terminating ${globalScope.cpuWorkers.length} CPU workers...`)
            globalScope.cpuWorkers.forEach(worker => { 
                worker.unref()
                worker.terminate()
            })
            globalScope.cpuWorkers = undefined
        }

        if (globalScope.appWorker !== undefined) {
            log.info(`Terminating app worker...`)
            globalScope.appWorker.unref()
            globalScope.appWorker.terminate()
            globalScope.appWorker = undefined
        }
    }
}

async function txdb_init() { 
    const txDbSetup = new Promise((resolve) => {
        utilsWallet.getAppWorker().on('message', (event) => { 
            if (event.msg === 'SERVER_INIT_TX_DB_DONE') {
                resolve()
            }
        })
        utilsWallet.getAppWorker().postMessage({ msg: 'SERVER_INIT_TX_DB', data: {} })
    })
    return txDbSetup
}
