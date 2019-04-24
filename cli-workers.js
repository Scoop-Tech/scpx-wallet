const chalk = require('chalk')

const { Worker, isMainThread, parentPort } = require('worker_threads')

import * as configWallet from './config/wallet'
import * as utilsWallet from './utils'

// setup cpuWorkers
export async function workers_init() {
    console.log(chalk.green(`isMainThread=${isMainThread}`))

    // create workers
    const globalScope = utilsWallet.getGlobal()
    if (globalScope.cpuWorkers === undefined || globalScope.cpuWorkers.length == 0) { 
        globalScope.cpuWorkers = []
        globalScope.CPU_WORKERS = 2
        for (var i=0 ; i < globalScope.CPU_WORKERS ; i++) {
            globalScope.cpuWorkers.push(new Worker('./cpu-worker/worker.js'))
        }
        globalScope.nextCpuWorker = 0
    }

    // ping workers
    const pongs = globalScope.cpuWorkers.map(worker => {
        return new Promise((resolve) => {
            worker.on('message', (data) => {
                console.log('PONG')
                resolve()
            })
            worker.postMessage({ msg: 'DIAG_PING', data: {} })
        })
    })
    await Promise.all(pongs)
}