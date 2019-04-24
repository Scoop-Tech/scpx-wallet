const chalk = require('chalk')

const { Worker, isMainThread, parentPort } = require('worker_threads')

import * as configWallet from './config/wallet'
import * as utilsWallet from './utils'

// setup cpuWorkers
export function workers_init() {
    console.log(chalk.green(`isMainThread=${isMainThread}`))
    const globalScope = utilsWallet.getGlobal()
    if (globalScope.cpuWorkers === undefined || globalScope.cpuWorkers.length == 0) { 
        globalScope.cpuWorkers = []
        globalScope.CPU_WORKERS = 2
        for (var i=0 ; i < globalScope.CPU_WORKERS ; i++) {
            globalScope.cpuWorkers.push(new Worker('./cpu-worker/worker.js'))
        }
        globalScope.nextCpuWorker = 0
    }
}