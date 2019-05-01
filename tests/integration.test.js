// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const appStore = require('../store')

const cliRepl = require('../cli-repl')
const cliWorkers = require('../svr-workers')
const swCreate = require('../svr-wallet/sw-create')
const swWallet = require('../svr-wallet/sw-wallet')
const swPersist = require('../svr-wallet/sw-persist')
const log = require('../cli-log')
const npmPackage = require('../package.json')


beforeAll(async () => {
    await cliWorkers.workers_init(appStore.store)
})

test('wallet-new', () => {

    const ret = swCreate.walletNew(appStore.store).then(res => {
        console.log(ret)
        expect((1 == 1)).toBe(true)
    })

})

