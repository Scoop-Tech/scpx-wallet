const chalk = require('chalk')

const { Worker, isMainThread, parentPort } = require('worker_threads')

import * as configWallet from './config/wallet'
import * as utilsWallet from './utils'

// setup cpuWorkers
export function workers_init() {
    console.log(chalk.green(`isMainThread=${isMainThread}`))
    if (utilsWallet.cpuWorkers === undefined || utilsWallet.cpuWorkers.length == 0) { 
        utilsWallet.cpuWorkers = []
        utilsWallet.CPU_WORKERS = 2
        for (var i=0 ; i < utilsWallet.CPU_WORKERS ; i++) {
            utilsWallet.cpuWorkers.push(new Worker('./cpu-worker/worker.js'))
        }
        utilsWallet.nextCpuWorker = 0
    }
}