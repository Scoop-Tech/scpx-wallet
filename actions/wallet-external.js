// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
const bitgoUtxoLib = require('bitgo-utxo-lib')
const bchAddr = require('bchaddrjs')
const BigNumber = require('bignumber.js')
const _ = require('lodash')

const actionsWallet = require('.')
const walletUtxo = require('./wallet-utxo')
const walletAccount = require('./wallet-account')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const utilsWallet = require('../utils')

const walletP2shBtc = require('./wallet-btc-p2sh')
const walletP2pkhBtc = require('./wallet-btc-p2pkh')
const walletP2pkhAlts = require('./wallet-alts-p2pkh')

module.exports = {

    //
    // process asset full state updates
    //
    getAddressFull_ProcessResult: (res, asset, addrNdx) => {
        //utilsWallet.debug(`getAddressFull_ProcessResult - ${asset.symbol} addrNdx=${addrNdx}...`)
        
        if (!res || !res.txs) return null
        if (configWallet.TEST_PAD_TXS) testPadTxs(res)
        if (configWallet.TEST_LARGE_BALANCE > 0) res.balance = configWallet.TEST_LARGE_BALANCE 

        const balanceChanged = res.balance != asset.addresses[addrNdx].balance
                            || res.unconfirmedBalance != asset.addresses[addrNdx].unconfirmedBalance

        const firstLoad = asset.addresses[addrNdx].lastAddrFetchAt === undefined

        var testingPaddedTxs = configWallet.TEST_PAD_TXS ? true : false

        const new_txs = res.txs.filter(p => { return !asset.addresses[addrNdx].txs.some(p2 => { return p2.txid === p.txid }) })
        const anyNewTx = new_txs.length > 0
        var new_txs_value 
        if (asset.type === configWallet.WALLET_TYPE_UTXO) {
            new_txs_value = 
                new_txs.reduce((sum,p) => { // utxo vin values that this addr contributed to
                    var txAddrValue = new BigNumber(0)
                    if (p.utxo_vin !== undefined) { // UTXO v2 - skip minimal tx's
                        txAddrValue = p.utxo_vin
                        .filter(p2 => { return p2.addr == asset.addresses[addrNdx] })
                        .map(p2 => { return p2.valueSat })
                        .reduce((sum2,p2) => { return sum2.plus(new BigNumber(p2)) }, new BigNumber(0))
                    }
                    return sum.plus(txAddrValue)
                },
                new BigNumber(0))
        }
        else {
            new_txs_value = 
                new_txs
                .filter(p => { return p.value !== undefined }) // ETH v2 - skip minimal tx's
                .reduce((sum,p) => { 
                    return sum.plus(new BigNumber(utilsWallet.toCalculationUnit(p.value, asset).times(p.isIncoming ? +1 : -1)))
                              .plus(new BigNumber(utilsWallet.toCalculationUnit(p.isIncoming || utilsWallet.isERC20(asset) ? 0 : (new BigNumber(p.fees).times(-1)), asset))) }, new BigNumber(0))
        }
        
        const delta_bal_conf   = new BigNumber(res.balance).minus(new BigNumber(asset.addresses[addrNdx].balance))
        const delta_bal_unconf = new BigNumber(res.unconfirmedBalance).minus(new BigNumber(asset.addresses[addrNdx].unconfirmedBalance))
        const min_accept_delta = asset.addressType === configWallet.ADDRESS_TYPE_ETH ? 1 : configWallet.UTXO_DUST_SAT

        const anyPendingLocalTxs = getAll_local_txs(asset).length > 0

        if (
            // initial load or testing - accept
            firstLoad || testingPaddedTxs                                  
        
            // utxo & account - MAIN ATOMIC UPDATE FILTER -- delta on tx's value and the balance are in sync
            || (balanceChanged && anyNewTx && new_txs_value.minus(delta_bal_conf).abs() <= min_accept_delta)

            // account only (eth) - CASHFLOW TOKENS -- we can get balance updates without *any* transactions!
            //   > this happens when we subscribe to an issuance by sending eth to the CFT contract <
            // in this case, accept a state change on the balance update, but only if there aren't any unconfirmed/pending tx's
            // (the last condition keeps the CFT's working in the normal erc20 receive case [bug otherwise is balance updates to high, then settles to correct value])
            || (asset.isCashflowToken && balanceChanged && anyPendingLocalTxs == false)

            // account - new tx but no balance change -- accept (note we don't accept the inverse)
            // this is to work around blockbook not giving us atomic tx/balance updates;
            //   on receive, get balance update without tx update, which we ignore in favour of our local_tx
            //   accepting the inverse lets us accept the new tx (when BB eventually reports it), in the case where we've just logged in
            //   and are waiting for a lagging BB tx, and firstLoad has already accepted the BB balance
            //|| (asset.type === configWallet.WALLET_TYPE_ACCOUNT && newTx && !balanceChanged)

            //|| (asset.type === configWallet.WALLET_TYPE_ACCOUNT && balanceChanged && newTx)

            //|| (asset.type === configWallet.WALLET_TYPE_ACCOUNT && !delta_bal_conf.eq(0))

            // try BTC send-all issue fix
            // ******
            //|| (asset.type === configWallet.WALLET_TYPE_UTXO)

            // utxo - accept *any* change to confirmed
            //|| (asset.type === configWallet.WALLET_TYPE_UTXO && !delta_bal_conf.eq(0))

            // utxo - accept an unconf change only if it matches tx change
            //|| (asset.type === configWallet.WALLET_TYPE_UTXO && new_txs_value.minus(delta_bal_unconf).abs() <= min_accept_delta) 
        )
        { 
            var newAddr = Object.assign({}, asset.addresses[addrNdx], res)
            newAddr.lastAddrFetchAt = new Date()

            utilsWallet.log(`getAddressFull_ProcessResult - ${asset.symbol} - addrNdx=${addrNdx} - ACCEPTING STATE UPDATE: newTx=${anyNewTx} balanceChanged=${balanceChanged}`) 

            const dispatchAction = { type: actionsWallet.WCORE_SET_ADDRESS_FULL, payload: { updateAt: new Date(), symbol: asset.symbol, newAddr} }
            return dispatchAction
        }
        else {
            //utilsWallet.log(`getAddressFull_ProcessResult - ${asset.symbol} - addrNdx=${addrNdx} - dropping state update! newTx=${newTx}, balanceChanged=${balanceChanged}, new_txs_value=${new_txs_value.toString()}, delta_bal_conf=${delta_bal_conf.toString()}`)
            return null
        }
    },

    // payTo: [ { receiver: 'address', value: 'value'} ... ]
    createAndPushTx: (p, callback) => { 
        const { store, payTo, wallet, asset, feeParams = {}, sendFromAddrNdx = -1, useUtxos, apk, h_mpk, } = p

        console.log('createAndPushTx/payTo.dsigCltvSpenderPubKey', payTo.dsigCltvSpenderPubKey)
        utilsWallet.log(`*** createAndPushTx (wallet-external) ${asset.symbol}... payTo=`, payTo)

        createTxHex({ payTo,
                      asset,
         encryptedAssetsRaw: wallet.assetsRaw,
                  feeParams,
                   sendMode: true,
            sendFromAddrNdx,
                   useUtxos,
                        apk: apk,
                      h_mpk: h_mpk,
        })
        .then(resCreateTxHex => {
            const txHex = resCreateTxHex.hex
            pushTransactionHex(store, payTo, wallet, asset, txHex, (resPushTxHex, err) => {
                if (err) {
                    utilsWallet.error(`## createAndPushTx (wallet-external) ${asset.symbol}, err=`, err)
                    callback(null, err)
                }
                else {
                    utilsWallet.logMajor('green','white', `Broadcast txid=${resPushTxHex.tx.txid}`, txHex, { logServerConsole: true })
                    store.dispatch({ type: actionsWallet.WCORE_PUSH_LOCAL_TX, payload: { symbol: asset.symbol, tx: resPushTxHex.tx } }) 
                    callback({ tx: resPushTxHex.tx, psbt: resCreateTxHex.psbt })
                }
            })
        })
        .catch(err => {
            utilsWallet.error(`### createAndPushTx (wallet-external) createTxHex FAILED - ${asset.symbol} err=`, err)
            try {
                let message = err.response.data.errors[0].error
                callback(null, message)
            } catch (_) {
                callback(null, err.message || err.toString())
            }
        })
    },

    exploreAssetAddress: (asset, addrNdx) => {
        if (configExternal.walletExternal_config[asset.symbol] !== undefined) {
            const a_n = asset.addresses[addrNdx]
            const explorer = configExternal.walletExternal_config[asset.symbol].explorerPath(a_n.addr)
            window.open(explorer, '_blank')
        }
    },

    //
    // Combines all txs and local_txs across all addresses
    //
    getAll_txs: (asset) => { return getAll_txs(asset) },
    getAll_local_txs: (asset) => { return getAll_local_txs(asset) },
    getAll_unconfirmed_txs: (asset) => { return getAll_unconfirmed_txs(asset) },
    getAll_protect_op_txs: (p) => { return getAll_protect_op_txs(p) },

    //
    // Combines local_tx data with tx and balance fields ; two distinct sets of balance data: 
    //
    //    the first (main) set is {conf, unconf, avail, total} - this is top-level "account" data, suitable for main display
    //    for utxo-types, we might be waiting for a change utxo to be returned to us; so we also return { utxo_avail, utxo_changePending } - used by the send screen
    //
    // if no addrNdx supplied, returns aggregated data for all addresses, otherwise restricts to the supplied address index
    //
    get_combinedBalance: (asset, addrNdx = -1) => {
        
        if (asset === undefined || asset.addresses === undefined) return 

        const meta = configWallet.walletsMeta[asset.name.toLowerCase()] 
        var ret = {
                        conf: new BigNumber(0),
                      unconf: new BigNumber(0),
                 pending_out: new BigNumber(0),
                  pending_in: new BigNumber(0),
                 has_pending: false,
                       avail: new BigNumber(0),
                       total: new BigNumber(0),
        unconfirmed_tx_count: 0,
         allAddressesFetched: false,
        }

        // filter all or single address
        var addresses
        if (addrNdx == -1) {
            addresses = asset.addresses
        }
        else {
            addresses = []
            if (asset.addresses[addrNdx])
                addresses.push(asset.addresses[addrNdx])
            else
                return ret
        }

        // confirmed & unconfirmed balances, aggregated over all addresses
        const totalConfirmed = addresses.reduce((sum,p) => { return new BigNumber(p.balance || 0).plus(new BigNumber(sum)) }, 0)
        const totalUnconfirmed = addresses.reduce((sum,p) => { return new BigNumber(p.unconfirmedBalance || 0).plus(new BigNumber(sum)) }, 0)

        if (addresses.some(p => p.balance === undefined || p.unconfirmedBalance === undefined)) {
            ret.allAddressesFetched = false
        }
        else {
            ret.allAddressesFetched = true
        }

        ret.conf = totalConfirmed || new BigNumber(0)
        ret.unconf = totalUnconfirmed || new BigNumber(0)
        
        // we need to supplement address-level unconfirmed data with local_tx data;
        //  (1) eth doesn't give us any concept of unconfirmed
        //  (2) similarly for segwit, our insight node has no knowledge of unconfirmed segwit tx's

        // assign (subtract) sum of pending local txs to unconfirmed balance from external source;
        // see wallet reducer for how local_txs are reconciled/removed as they're fetched from external sources
        var cu_local_txs_pendingOut = 
            asset.local_txs
            .filter(p => p.isIncoming === false || p.sendToSelf === true)
            .filter(p => meta.addressType !== configWallet.ADDRESS_TYPE_ETH || (addresses.some(p2 => p2.addr.toLowerCase() === p.account_from.toLowerCase() )))
            .filter(p => meta.addressType !== configWallet.ADDRESS_TYPE_BTC || (addresses.some(p2 => p2.addr === p.toOrFrom )))
            .reduce((sum,p) => {
                var cu_value = utilsWallet.toCalculationUnit(p.value, asset)
                var cu_fees = utilsWallet.toCalculationUnit(p.fees, asset)
                var bn_total = new BigNumber(cu_value).plus(utilsWallet.isERC20(asset) ? 0 : cu_fees)
                return sum.plus(bn_total.times(-1))
            }, new BigNumber(0))

        var cu_local_txs_pendingIn = 
            asset.local_txs
            .filter(p => p.isIncoming === true || p.sendToSelf === true)
            .filter(p => meta.addressType !== configWallet.ADDRESS_TYPE_ETH || (addresses.some(p2 => p2.addr.toLowerCase() === p.account_to.toLowerCase() )))
            .filter(p => meta.addressType !== configWallet.ADDRESS_TYPE_BTC || (addresses.some(p2 => p2.addr === p.toOrFrom )))
            .reduce((sum,p) => { 
                var cu_value = utilsWallet.toCalculationUnit(p.value, asset)
                return sum.plus(new BigNumber(cu_value))
            }, new BigNumber(0))

        // modify unconfirmed with sum of pending inbound (+ve) and outbound (-ve)
        ret.unconf = ret.unconf.plus(cu_local_txs_pendingOut) // -ve
        ret.unconf = ret.unconf.plus(cu_local_txs_pendingIn)  // +ve

        // the above modified unconf field can net to zero (if pending in and out values are the same in both directions),
        // so we also return summed pending in and out values:
        ret.pending_out = cu_local_txs_pendingOut
        ret.pending_in = cu_local_txs_pendingIn
        ret.has_pending = cu_local_txs_pendingOut.isLessThan(0) || cu_local_txs_pendingIn.isGreaterThan(0) || totalUnconfirmed != 0

        // available balance: deduct any pending out, don't credit any pending in
        ret.avail = ret.conf.minus(cu_local_txs_pendingOut.abs())                                    // net off any pending local_tx out value
                            .minus(totalUnconfirmed < 0 ? new BigNumber(totalUnconfirmed).abs() : 0) // net off any address (3PBP) pending out value

        // available balance: DMS - deduct any balances that arise from protect_op/weAreBeneficiary tx's
        //  (each such utxo needs a different locktime to be spent, so they must be spent one by one...)
        if (asset.type === configWallet.WALLET_TYPE_UTXO) {
            if (asset.symbol === 'BTC_TEST') {
                const p_op_txs = getAll_protect_op_txs({ asset, weAreBeneficiary: true, weAreBenefactor: false })
                if (p_op_txs.length > 0) {
                    const beneficiary_addrs = asset.addresses.filter(p => p_op_txs.some(p2 => p2.p_op_addrNonStd == p.addr))
                    if (beneficiary_addrs.length > 0) {
                        const beneficiaryConfirmed = beneficiary_addrs.reduce((sum,p) => { return new BigNumber(p.balance || 0).plus(new BigNumber(sum)) }, 0)
                        const beneficiaryUnconfirmed = beneficiary_addrs.reduce((sum,p) => { return new BigNumber(p.unconfirmedBalance || 0).plus(new BigNumber(sum)) }, 0)
                        if (beneficiaryConfirmed.isGreaterThan(0) || beneficiaryUnconfirmed.isGreaterThan(0)) {
                            ret.avail = ret.avail.minus(beneficiaryConfirmed).minus(beneficiaryUnconfirmed)
                        }
                    }
                }
            }
        }

        // total balance: confirmed and unconfirmed
        ret.total = ret.conf.plus(ret.unconf)

        // eth - round dust values to zero (all because can't get Geth to accept precise full-send amounts)
        if (asset.symbol === 'ETH' || asset.symbol === 'ETH_TEST') {
            if (configWallet.ETH_COALESCE_DUST_TO_ZERO && ret.avail.isGreaterThan(0) && ret.avail.isLessThanOrEqualTo(configWallet.ETH_DUST_WEI)) { 
                //utilsWallet.log(`get_combinedBalance - rounding dust (avail) wei for ${asset.symbol} (${ret.avail})`)
                ret.avail = new BigNumber(0)
            }
            if (configWallet.ETH_COALESCE_DUST_TO_ZERO && ret.total.isGreaterThan(0) && ret.total.isLessThanOrEqualTo(configWallet.ETH_DUST_WEI)) { 
                //utilsWallet.log(`get_combinedBalance - rounding dust (total) wei for ${asset.symbol} (${ret.total})`)
                ret.total = new BigNumber(0)
            }
        }

        // TODO -- should also be rounding ERC20 dust values - observed (sometimes) - "1e-20" or similar on send all erc20
        //...

        // get total # of pending tx's -- external and local
        const unconfirmed_txs = getAll_unconfirmed_txs(asset)
        ret.unconfirmed_tx_count = asset.local_txs.length + unconfirmed_txs.length 
        return ret
    },

    //
    // Compute a specific tx fee, for the supplied tx details
    //
    computeTxFee: async (p) => { 
        var { asset, receiverAddress, feeData, sendValue, dsigCltvSpenderPubKey, encryptedAssetsRaw, useFastest, useSlowest, useUtxos, apk, h_mpk } = p
        if (!feeData) { throw 'Invalid parameter - feeData' }
        if (!asset) { throw 'Invalid parameter - asset' }
        if (!encryptedAssetsRaw) { throw 'Invalid parameter - encryptedAssetsRaw' }
        if (!apk) { throw 'Invalid parameter - apk' }
        if (!h_mpk) { throw 'Invalid parameter - h_mpk' }

        var ret = {}

        if (asset.type === configWallet.WALLET_TYPE_UTXO) { 

            var cu_satPerKB = useFastest ? feeData.fastest_satPerKB
                            : useSlowest ? feeData.slow_satPerKB
                            :              feeData.fast_satPerKB

            var du_satPerKB = Number(utilsWallet.toDisplayUnit(new BigNumber(cu_satPerKB), asset))
            if (!sendValue) {
                sendValue = 0
            }
            const payTo = [ { receiver: configExternal.walletExternal_config[asset.symbol].donate, value: sendValue, dsigCltvSpenderPubKey } ]
            
            // we need to pass some fee into createTxHex; we only care here though about the returned tx size data
            const feeParams = { txFee: { fee: (du_satPerKB / 4) } }
            const res = await createTxHex({ 
                payTo, asset, encryptedAssetsRaw, feeParams, sendMode: false, sendFromAddrNdx: -1, useUtxos,
                         apk: apk, 
                       h_mpk: h_mpk,
            })
            if (res !== undefined) {
                const cu_fee = new BigNumber(Math.ceil(((res.byteLength / 1024) * cu_satPerKB))) // tx KB size * sat/KB
                const du_fee = Number(utilsWallet.toDisplayUnit(cu_fee, asset))
                ret = { inputsCount: res.inputsCount,
                         utxo_vsize: res.vSize,
                      utxo_satPerKB: cu_satPerKB,
                    utxo_byteLength: res.byteLength,
                                fee: du_fee }
            }
            else {
                utilsWallet.error(`Failed to construct tx hex for ${asset.symbol}, payTo=`, payTo)
                throw 'Failed to construct tx - ensure you have sufficient inputs for the specified value'
            }
        }
        else if (asset.type === configWallet.WALLET_TYPE_ACCOUNT) { 

            if (asset.addressType === configWallet.ADDRESS_TYPE_ETH) {
                var gasPriceToUse = useFastest ? feeData.gasprice_fastest 
                                  : useSlowest ? feeData.gasprice_safeLow 
                                  :              feeData.gasprice_fast 
                
                var gasLimitToUse = feeData.gasLimit // default "estimate" - from wallet/actions.getAssetFeeData()

                // erc20's -- if asset flag set: use estimateGas + a multiplier (override hard-coded erc20_transferGasLimit); 
                // required for complex transfer() functions, e.g. cashflow tokens
                if (asset.erc20_gasEstimateMultiplier) {
                    const dummyTxParams = {
                            from: asset.addresses[0].addr, //configExternal.walletExternal_config[asset.symbol].donate, 
                              to: configExternal.walletExternal_config[asset.symbol].donate,
                           value: sendValue,
                        gasLimit: feeData.gasLimit,
                        gasPrice: gasPriceToUse,
                    }
                    utilsWallet.log(`erc20 - dummyTxParams`, dummyTxParams)
                    const dummyTxHex = await walletAccount.createTxHex_Account({ asset, params: dummyTxParams, privateKey: undefined })
                    if (dummyTxHex && dummyTxHex.txParams) {
                        const gasTxEstimate = await walletAccount.estimateTxGas_Account({ asset, params: dummyTxHex.txParams })
                        utilsWallet.log(`erc20 - gasEstimate`, gasTxEstimate)
                        utilsWallet.log(`erc20 - asset`, asset)
                        utilsWallet.log(`erc20 - asset.erc20_gasEstimateMultiplier`, asset.erc20_gasEstimateMultiplier)
                        if (gasTxEstimate && gasTxEstimate > 0) {
                            // use modified web3 gas estimate
                            gasLimitToUse = Math.max(
                                Math.ceil(gasTxEstimate * asset.erc20_gasEstimateMultiplier),
                                asset.erc20_gasMin
                            )

                            utilsWallet.log(`erc20 - estimatedGas`, gasLimitToUse)
                        }
                    }
                    else utilsWallet.warn(`erc20 - failed to get tx params`)
                }

                // eth -- if receiver addr supplied: use estimateGas to override feeData;
                // required for complex payable functions, e.g. cashflow tokens
                if (receiverAddress) {
                    if (utilsWallet.isERC20(receiverAddress)) {
                        if (asset.symbol === 'ETH_TEST' || asset.symbol === 'ETH') {
                            const dummyTxParams = {
                                    from: asset.addresses[0].addr, // ##? will fail if sending from ndx != 0? will need sending index to be passed?
                                      to: receiverAddress,
                                   value: sendValue,
                                gasLimit: 7000000, //feeData.gasLimit,
                                gasPrice: gasPriceToUse,
                            }
                            utilsWallet.log(`eth(_test) - dummyTxParams`, dummyTxParams)
                            const dummyTxHex = await walletAccount.createTxHex_Account({ asset, params: dummyTxParams, privateKey: undefined })
                            if (dummyTxHex && dummyTxHex.txParams) {
                                const gasTxEstimate = await walletAccount.estimateTxGas_Account({ asset, params: dummyTxHex.txParams })
                                utilsWallet.log(`eth(_test) - gasEstimate`, gasTxEstimate)
                                utilsWallet.log(`eth(_test) - asset`, asset)
                                if (gasTxEstimate && gasTxEstimate > 0) {
                                    // use modified web3 gas estimate
                                    gasLimitToUse = Math.ceil(gasTxEstimate * 1.2)
                                    utilsWallet.log(`eth(_test) - estimatedGas`, gasLimitToUse)
                                }
                            }
                            else utilsWallet.warn(`eth(_test) - failed to get tx params`)
                        }
                    }
                }

                // ret
                var du_ethFee = 
                    new BigNumber(gasLimitToUse)
                    .dividedBy(1000000000)
                    .multipliedBy(new BigNumber(gasPriceToUse))
                    .dividedBy(1000000000)
                    .toString()
                ret = { inputsCount: 1,
                       eth_gasLimit: gasLimitToUse,
                       eth_gasPrice: gasPriceToUse,
                                fee: du_ethFee }
            }
            else throw(`Unknown account address type`)
        }
        else throw(`Unknown asset type`)

        utilsWallet.log(`computeTxFee ${asset.symbol} ${sendValue} - ret=`, ret)
        return ret
    },

    //
    // this is called at validation-time on send screen to determine the total vbytes needed for the TX, as well as at send-time;
    // UTXOs are cached in the asset object and form part of the asset's full fetch payload
    //
    createTxHex: (params) => {
        return createTxHex(params)
    },
}

//
// create tx hex - all assets
//
async function createTxHex(params) {
    const { payTo, asset, encryptedAssetsRaw, feeParams, sendMode = true, sendFromAddrNdx = -1, useUtxos,
            apk, h_mpk } = params

    //console.log('createTxHex/payTo.dsigCltvSpenderPubKey', payTo.dsigCltvSpenderPubKey)

    if (!asset) throw 'Invalid or missing asset'
    if (!payTo || payTo.length == 0 || !payTo[0].receiver) throw 'Invalid or missing payTo'
    if (payTo.length != 1) throw 'send-many is not supported'
    if (payTo[0].dsigCltvSpenderPubKey !== undefined && asset.symbol !== 'BTC_TEST') throw 'Invalid dsigCltvSpenderPubKey for asset'
    if (!feeParams || !feeParams.txFee) throw 'Invalid or missing feeParams'
    if (!encryptedAssetsRaw || encryptedAssetsRaw.length == 0) throw 'Invalid or missing encryptedAssetsRaw'
    if (!apk || apk.length == 0) throw 'Invalid or missing apk'
    if (!h_mpk || h_mpk.length == 0) throw 'Invalid or missing h_mpk'

    utilsWallet.log(`*** createTxHex (wallet-external) ${asset.symbol}...`)
    const validationMode = !sendMode
    const skipSigningOnValidation = true

    // source UTXOs - all utxos, across all wallet addresses
    var utxos = []
    asset.addresses
      //.filter(a_n => a_n.addr !== payTo.dsigCltvReceiver) // todo: (edgecase) - exclude any UTXOs from the dsigCltvReceiverAddr (for same-account testing...)
        .forEach(a_n => utxos.extend(a_n.utxos.map(p => { return Object.assign({}, p, { address: a_n.addr } )})))
    utxos = _.uniqWith(
                utxos.filter(utxo_n => utxo_n.satoshis > 0)                      // required: we don't explicitly prune outputs when they are spent (only a cache-clear drops them)
                     .filter(utxo_n => utxo_n.scriptPubKey.type !== "nulldata"), // exclude OP_RETURN outputs
            _.isEqual)
    if (asset.type === configWallet.WALLET_TYPE_UTXO) {
        if (asset.symbol === 'BTC_TEST') {
            // spending specific UTXOs (e.g. all PROTECT_OPs via CLAIMABLE-CLAIM) - filter out all other UTXOs
            if (useUtxos !== undefined && useUtxos.length > 0) {
                utxos = utxos.filter(p => useUtxos.some(p2 => p2.txid == p.txid && p2.vout == p.vout))
            }   
            // spending across multiple outputs - filter out UTXOs belonging to a PROTECT_OP beneficiary, i.e. those that have a specific locktime (they must be spent specifically, by supplying useUtxos)
            else {
                const p_op_txs = getAll_protect_op_txs({ asset, weAreBeneficiary: true, weAreBenefactor: false })
                utxos = utxos.filter(p => !p_op_txs.some(p2 => p2.txid == p.txid))
            }
        }
        //console.log('utxos', utxos)
        
        if (utxos.length == 0) throw 'Insufficient or invalid UTXO(s)'
    }

    // get private keys
    var pt_AssetsJson = utilsWallet.aesDecryption(apk, h_mpk, encryptedAssetsRaw)
    if (!pt_AssetsJson || pt_AssetsJson === '') throw('Failed decrypting assets')

    var pt_assetsObj = JSON.parse(pt_AssetsJson)
    var pt_asset = pt_assetsObj[asset.name.toLowerCase()]
    utilsWallet.softNuke(pt_assetsObj)
    pt_AssetsJson = null

    // flatten accounts: addr -> privKey
    var addrPrivKeys = []
    pt_asset.accounts.forEach(account => {
        account.privKeys.forEach(privKey => {
            const addrInfo = asset.addresses.find(p => p.path === privKey.path) // lookup the addr (rather than recompute it, faster)
            if (!addrInfo) {
                utilsWallet.error(`failed to lookup addr for path ${privKey.path}`)
            }
            addrPrivKeys.push( { addr: addrInfo.addr, privKey: privKey.privKey } )  
        })
    })
    utilsWallet.softNuke(pt_asset)

    switch (asset.type) {

        case configWallet.WALLET_TYPE_UTXO: {
            // get total receiver output value, for return
            const cu_sendValue = payTo.reduce((sum,p) => { return sum.plus(new BigNumber(p.value).times(100000000)) }, BigNumber(0))

            // get required inputs & outputs
            debugger
            const utxoParams = {
                changeAddress: asset.addresses[0].addr, // send all change to primary address -- todo: address reuse
                      outputs: payTo.map(p => { return { receiver: p.receiver,
                                                            value: new BigNumber(p.value).times(100000000).toString(),
                                            dsigCltvSpenderPubKey: p.dsigCltvSpenderPubKey }}),
                  feeSatoshis: Math.floor(feeParams.txFee.fee * 100000000),
                        utxos,
            }
            var txSkeleton
            try {
                txSkeleton = await walletUtxo.getUtxo_InputsOutputs(asset.symbol, utxoParams) //, true /*sendMode*/) //throwOnInsufficient
            }
            catch (err) {
                if (sendMode) return Promise.reject(err) // we're sending a tx: the error will propagate to client
                else          return undefined           // we're estimating fees for a tx: the error will be handled internally
            }
            if (!txSkeleton) throw 'Failed parsing tx skeleton'
            if (sendMode) {
                console.log('txSkeleton', txSkeleton)
            }

            // construct tx hex - switch on asset
            const opsWallet = require('./wallet')
            const network = opsWallet.getUtxoNetwork(asset.symbol)
            var tx, hex, vSize, byteLength
            if (asset.symbol === 'ZEC' || asset.symbol === 'DASH' || asset.symbol === 'VTC'
             || asset.symbol === 'QTUM' || asset.symbol === 'DGB' || asset.symbol === 'BCHABC'
             || asset.symbol === 'ZEC_TEST'
             || asset.symbol === 'RVN')
            {
                //
                // UTXO - P2PKH - bitgo-utxo tx builder (https://github.com/BitGo/bitgo-utxo-lib/issues/12, https://blog.bitgo.com/how-to-create-a-zcash-sapling-compatible-multisig-transaction-98e45657c48d )
                //
                var { tx, hex, vSize, byteLength } = walletP2pkhAlts.createTxHex_Alts_P2PKH({ asset, validationMode, skipSigningOnValidation, addrPrivKeys, txSkeleton })
            }
            else {
                if (asset.symbol === "BTC_SEG" || asset.symbol === "BTC_TEST") {
                    //
                    // UTXO - P2SH(...) - bitcoin-js PSBT (Partially Signed Bitcoin Transaction Format - BIP174)
                    //
                    var { tx, hex, vSize, byteLength, psbt } = walletP2shBtc.createTxHex_BTC_P2SH({ 
                        asset, validationMode, addrPrivKeys, txSkeleton, 
                        dsigCltvSpenderPubKey: payTo[0].dsigCltvSpenderPubKey
                    })
                }
                else { // BTC || BTC_SEG2
                    //
                    // UTXO - P2PKH || P2WPKH - bitcoin-js tx builder
                    //
                    var { tx, hex, vSize, byteLength } = walletP2pkhBtc.createTxHex_BTC_P2PKH({ asset, validationMode, skipSigningOnValidation, addrPrivKeys, txSkeleton })
                }
            }
            
            utilsWallet.softNuke(addrPrivKeys)
            return new Promise((resolve, reject) => { resolve({ 
                            hex, 
                          vSize,
                     byteLength,
                    inputsCount: txSkeleton.inputs.length, 
                  _cu_sendValue: cu_sendValue.toString(),
              get cu_sendValue() { return this._cu_sendValue },
         set cu_sendValue(value) { this._cu_sendValue = value },
                           psbt,
            }) }) 
        }

        case configWallet.WALLET_TYPE_ACCOUNT: {
            const receiver = payTo[0].receiver
            const value = payTo[0].value

            if (sendFromAddrNdx < 0 || sendFromAddrNdx > asset.addresses.length - 1) {
                utilsWallet.error(`### createTxHex (wallet-external ACCOUNT) ${asset.symbol} - bad addrNdx supplied`)
                return new Promise((resolve, reject) => { reject('Bad addrNdx') })
            }

            const senderAddr = asset.addresses[sendFromAddrNdx].addr
            var wif = addrPrivKeys.find(p => { return p.addr === senderAddr }).privKey

            payTo.senderAddr = senderAddr // record sender -- it's passed through post-tx send and is recorded on the local_tx

            const txParams = {
                from: senderAddr, 
                  to: receiver,
               value: value,
            gasLimit: feeParams.txFee.eth_gasLimit,
            gasPrice: feeParams.txFee.eth_gasPrice,
            }
        
            const walletAccount = require('./wallet-account')
            const txHexAndValue = await walletAccount.createTxHex_Account({ asset, params: txParams, privateKey: wif })

            utilsWallet.softNuke(addrPrivKeys)
            return new Promise((resolve, reject) => { 
                resolve( { hex: txHexAndValue.txhex, 
                  cu_sendValue: txHexAndValue.cu_sendValue.toString() }
                )})
        }

        default:
            utilsWallet.error('Wallet type ' + asset.type + ' not supported!')
            break
    }
}

//
// push tx
// 
function pushTransactionHex(store, payTo, wallet, asset, txHex, callback) {
    utilsWallet.log(`*** pushTransactionHex (wallet-external) ${asset.symbol} txHex=`, txHex)

    switch (asset.type) {
        case configWallet.WALLET_TYPE_UTXO:
            walletUtxo.pushRawTransaction_Utxo(wallet, asset, txHex, (res, err) => {
                callback(res, err)
            })
            break

        case configWallet.WALLET_TYPE_ACCOUNT:
            walletAccount.pushRawTransaction_Account(store, asset, payTo, txHex, (res, err) => {
                callback(res, err)
            })
            break
                
        default:
            throw 'Unsupported asset type'
    }
}

function getAll_txs(asset) {
    return utilsWallet.getAll_txs(asset)
}
function getAll_local_txs(asset) {
    return utilsWallet.getAll_local_txs(asset)
}
function getAll_unconfirmed_txs(asset) {
    return utilsWallet.getAll_unconfirmed_txs(asset)
}
function getAll_protect_op_txs(p) {
    return utilsWallet.getAll_protect_op_txs(p)
}

function testPadTxs(res) {
    for (let i=0 ; i < configWallet.TEST_PAD_TXS ; i++) {
        res.txs.push( { 
            block_no: 1452313,
            sendToSelf: false,
            confirmed: true,
            date: new Date().toString(),
            fees: 0.00001,
            isIncoming: false,
            toOrFrom: "mkjxRwEFtvW7WBVcwodEPNrHKfESdTsNT5",
            txid: `TEST_TX_${i}`,
            value: "0.42424242",
            utxo_vin: [],
            //utxo_vout: [],
        } )
    }
}

Array.prototype.extend = function (other_array) {
    if (other_array) {
        other_array.forEach(function (v) { this.push(v) }, this)
    }
}