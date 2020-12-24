// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.
const { Worker, isMainThread, parentPort } = require('worker_threads')

const configWallet = require('./config/wallet')
const utilsWallet = require('./utils')

const appWorkerCallbacks = require('./actions/appWorkerCallbacks')

const log = require('./sw-cli-log')

module.exports = {

    // setup cpuWorkers and singleton appWorker
    init: async (store) => {
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

                // StMaster - override postMessage to append common global data
                worker.postMessageWrapped = function(msg) {
                    if (msg !== undefined && msg.data !== undefined) {
                        msg.data.stm_ApiPayload = configWallet.get_stm_ApiPayload() // StMaster - pass through config/wallet.js::stm_ApiPayload
                    }
                    //console.log('cpuWorker.postMessageWrapped...', msg)
                    return this.postMessage(msg)
                }

                globalScope.cpuWorkers.push(worker)
            }
            globalScope.nextCpuWorker = 0
        }

        // create singleton app worker
        if (globalScope.appWorker === undefined) {
            function createAppWorker() {
                const appWorker = new Worker(`${__dirname}/app-worker/worker.js`)
                appWorker.setMaxListeners(40) 
                appWorker.removeEventListener = appWorker.removeListener 
                appWorker.addEventListener = appWorker.on
                appWorker.on('message', event => {
                    appWorkerCallbacks.appWorkerHandler(store, event) // handle common core app worker callbacks
                    const postback = event.data
                    const msg = event.msg
                    const status = event.status
                    if (postback && msg === 'NOTIFY_USER') {
                        utilsWallet.logMajor(postback.type == 'error' ? 'red' : 'green', 'white',
                            `${postback.type ? postback.type.toUpperCase() : ''}` + 
                            `${postback.headline ? ' [' + postback.headline + ']' : ''}` + 
                            `${postback.info ? ' [' + postback.info + ']': ''}` + 
                            `${postback.desc1 ? ' [' +postback.desc1 + ']': ''}` + 
                            `${postback.desc2 ? ' [' +postback.desc2 + ']' : ''}` + 
                            `${postback.txid ? (' txid: ' + postback.txid + '') : ''}`,
                            null, { logServerConsole: true })
                    }
                })

                // StMaster - override postMessage to append common global data
                appWorker.postMessageWrapped = function(msg) {
                    if (msg !== undefined && msg.data !== undefined) {
                        msg.data.stm_ApiPayload = configWallet.get_stm_ApiPayload() // StMaster - pass through config/wallet.js::stm_ApiPayload
                    }
                    //console.log('appWorker.postMessageWrapped...', msg)
                    return this.postMessage(msg)
                }
                return appWorker
            }
            globalScope.appWorker = createAppWorker()

            // test - create appworkers for loading concurrently
            // globalScope.loaderWorkers = []
            // globalScope.loaderWorkers.push(createAppWorker())
            // globalScope.loaderWorkers.push(createAppWorker())
            // globalScope.loaderWorkers.push(createAppWorker())
            // globalScope.loaderWorkers.push(createAppWorker())

            await txdb_init()
        }

        // ping all workers
        const pongs = globalScope.cpuWorkers.concat([globalScope.appWorker]).map(worker => {
            return new Promise((resolve) => {
                worker.once('message', (data) => { resolve(true) })
                worker.postMessageWrapped({ msg: 'DIAG_PING', data: {} })
            })
        })
        return Promise.all(pongs)
    },

    txdb_init: () => { 
        txdb_init()
    },

    terminate: () => {
        const globalScope = utilsWallet.getMainThreadGlobalScope()
        
        if (globalScope.volatileSockets_intId) {
            log.info(`Clearing volatile sockets reconnector...`)
            clearInterval(globalScope.volatileSockets_intId)
        }

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
        const globalScope = utilsWallet.getMainThreadGlobalScope()
        const appWorker = utilsWallet.getAppWorker()

        //utilsWallet.getAppWorker()
        appWorker.postMessageWrapped({ msg: 'SERVER_INIT_TX_DB', data: {} })
    })
    return txDbSetup
}
