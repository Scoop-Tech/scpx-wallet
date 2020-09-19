// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const _ = require('lodash')

const { userData_SaveAll } = require('../actions/user-data')
const { getUserData_FromEncryptedJson } = require('../actions/user-data-helpers')
const { USERDATA_SET_FROM_SERVER, USERDATA_UPDATE_LASTLOAD, USERDATA_UPDATE_TOTP_SECRET,
        USERDATA_UPDATE_OPTION,
        USERDATA_UPDATE_FBASE,
        USERDATA_UPDATE_AUTOCONVERT,
} = require('../actions')
    
const {
    XS_SET_EXCHANGE_ASSET, XS_SET_RECEIVE_ASSET, 
    XS_SET_MINMAX_AMOUNT,
    XS_SET_EST_RECEIVE_AMOUNT, XS_SET_FIXED_RECEIVE_AMOUNT,
    XS_UPDATE_EXCHANGE_TX,
    XS_SET_CURRENCIES
} = require('../actions')

const utilsWallet = require('../utils')

const { createReducer } = require('./utils')

const initialState = {
    t_f3: "42-def1",
    t_f4: "42-def2",

    // exchange autoconvert settings
    autoConvertSettings: {
        // e.g.
        // ZEC: { 
        //     fromBlockNo: undefined,
        //     toSymbol: undefined,
        // }
    },

    // ndx 0 - current login
    // ndx 1 - previous login
    loadHistory: [ 
        { browser: false, server: false, datetime: undefined }, 
        { browser: false, server: false, datetime: undefined }  
    ],

    // random 32 char entropy - completely uncorrelated with all other account identifiers
    totpSecret: undefined,

    fbaseCloudLoginSaved: {
    email: null,
        photoURL: null,
    },

    // user app settings
    options: [
        { key: "OPT_CLOUD_PWD",   value: false },
        { key: "OPT_AUTOLOGOUT",  value: true },
        { key: "OPT_NIGHTSHIFT",  value: true },
        { key: "OPT_NOPATCH_MPK", value: true },
        { key: "OPT_BETA_TESTER", value: true },
        { key: "OPT_TOTP",        value: false },
    ],

    // exchange service - current and history records
    exchange: {
        // UI "active" - really should be state in Exchange screen
        cur_fromSymbol: undefined,
        cur_toSymbol: undefined,
        cur_minAmount: 0.00,
        cur_maxAmount: 0.00,
        cur_fixedRateId: undefined,
        cur_estReceiveAmount: 0.00,
        
        // transient - 3PXS current states
        currencies: [],

        // current XS data
        cur_xsTx: { 
            // e.g.
            // ZEC: { txid: 'bafd224be48a65d2b87dc7bc67dbd297831fd1437fd7edad1833b20cf9070f82',
            //        sentAt: 1581854132982,
            //        xs:
            //         { id: '9giaknetruwxndp4',
            //           createdAt: 1581854078,
            //           type: 'fixed',
            //           moneyReceived: 1581854171,
            //           moneySent: 1581855179,
            //           rate: '0.00635068',
            //           payinConfirmations: '0',
            //           status: 'finished',
            //           currencyFrom: 'zec',
            //           currencyTo: 'btc',
            //           payinAddress: 't1estHVAkNYPzvcARRj5zRWNN3FYowKev7H',
            //           payinExtraId: null,
            //           payinExtraIdName: null,
            //           payinHash:
            //            'bafd224be48a65d2b87dc7bc67dbd297831fd1437fd7edad1833b20cf9070f82',
            //           payoutHashLink:
            //            'https://www.blockchain.com/btc/tx/13332ddb2848dcdeea7330b748d3d820b5bfacf8aaa9d893fec38414fa630ea7',
            //           refundHashLink: null,
            //           amountExpectedFrom: '0.715',
            //           payoutAddress: '1NGwcdq26vDRT3kErPN83Zx2AwW9UBFffN',
            //           payoutExtraId: null,
            //           payoutExtraIdName: null,
            //           payoutHash:
            //            '13332ddb2848dcdeea7330b748d3d820b5bfacf8aaa9d893fec38414fa630ea7',
            //           refundHash: null,
            //           amountFrom: '0.715',
            //           amountTo: '0.00454074',
            //           amountExpectedTo: '0.00454074',
            //           networkFee: '0.00025',
            //           changellyFee: '0.5',
            //           apiExtraFee: '0.50',
            //           totalFee: '0.00025',
            //           fiatProviderId: null,
            //           fiatProvider: null,
            //           fiatProviderRedirect: null },
            //        fromSymbol: 'ZEC',
            //        toSymbol: 'BTC',
            //        amountSent: 0.715,
            //        cur_estReceiveAmount: 0.0045407483192499995,
            //        fixedRateId:
            //         'ebcc48106d63b65b898e5f0c38274ecc940d89c5fcb5a95e08d52b7b903f1775',
            //        cur_xsTxStatus: 'done',
            //        finalized: true },  
            // }
            //...
        }, 
        // todo? -> cur_xsTx.eth -> cur_xsTx.eth[] -- i.e. current *and* history combined?
        // * creating new --> append only (not replace) ...
        // * updating     --> find, update in place
        // * removing     --> nop
    }
}

const handlers = {

    // assign state from server
    [USERDATA_SET_FROM_SERVER]: (state, action) => { 
        var dataJson = action.dataJson
        if (dataJson !== undefined && dataJson !== "" && dataJson.length > 0) {
            var serverUserData = getUserData_FromEncryptedJson(dataJson)
            if (!serverUserData) { // sanity check -- have seen corrupted settings saved to server during dev cycles; ignore if so
                return state
            }

            // don't nuke local options from server, instead merge
            var mergedOptions = {...state.options, ...serverUserData.options} // server wins on conflict (right hand side of spread operator)
            var mergedOptionsArray = Array.from(Object.values(mergedOptions))

            // also merge top level fields of settings, so we can add new fields anytime on client and they get preserved on server
            var newUserData = {...state, ...serverUserData} // server wins on conflict

            newUserData.options = mergedOptionsArray 

            //userData_SaveAll({ userData: newUserData, hideToast: action.hideToast || false })
            return newUserData
        }
    },

    // set TOTP secret key
    [USERDATA_UPDATE_TOTP_SECRET]: (state, action) => {
        if (action.payload.owner === utilsWallet.getStorageContext().owner) { 
            var newState = _.cloneDeep(state)
            newState.totpSecret = action.payload.newValue
            //userData_SaveAll({ userData: newState, hideToast: false })
            return newState
        }
    },
    
    // set load history
    [USERDATA_UPDATE_LASTLOAD]: (state, action) => {
        if (action.payload.owner === utilsWallet.getStorageContext().owner) { 
            var newState = _.cloneDeep(state)
            newState.loadHistory[1] = newState.loadHistory[0] // assign previous login (old current)
            newState.loadHistory[0] = action.payload.newValue // assign current login
            //userData_SaveAll({ userData: newState, hideToast: true })
            return newState
        }
    },

    // user settings - options
    [USERDATA_UPDATE_OPTION]: (state, action) => {
        var ndx = state.options.findIndex((p) => p.key === action.key)

        // disregard actions that originate from a different logged on user (this action is propagated by redux-state-sync)
        if (action.payload.owner === utilsWallet.getStorageContext().owner) { 
            var newState = _.cloneDeep(state)
            newState.options[ndx].value = action.payload.newValue
            if (action.payload.save) {
                userData_SaveAll({ userData: newState, hideToast: false })
            }
            return newState
        }
    },

    // user settings - autoconvert
    [USERDATA_UPDATE_AUTOCONVERT]: (state, action) => {
        // disregard actions that originate from a different logged on user (this action is propagated by redux-state-sync)
        if (action.payload.owner === utilsWallet.getStorageContext().owner) { 
            var newState = _.cloneDeep(state)

            // validate
            if (!action.payload.fromSymbol || !action.payload.fromSyncInfo) {
                console.error('USERDATA_UPDATE_AUTOCONVERT - invalid params')
                return newState
            }
            if (action.payload.fromSyncInfo.receivedBlockNo <= 0) {
                console.error('USERDATA_UPDATE_AUTOCONVERT - invalid params (receivedBlockNo)', action.payload.fromSyncInfo)
                return newState
            }

            // update
            if (newState.autoConvertSettings[action.payload.fromSymbol] === undefined) {
                newState.autoConvertSettings[action.payload.fromSymbol] = {}
            }
            newState.autoConvertSettings[action.payload.fromSymbol].toSymbol = action.payload.toSymbol
            newState.autoConvertSettings[action.payload.fromSymbol].fromBlockNo =
                action.payload.toSymbol !== undefined 
                    ? action.payload.fromSyncInfo.receivedBlockNo
                    : undefined

            utilsWallet.logMajor('orange','black', `USERDATA_UPDATE_AUTOCONVERT`, newState, { logServerConsole: true })

            userData_SaveAll({ userData: newState, hideToast: false })
            return newState
        }
    },

    // fbase logged-in status
    [USERDATA_UPDATE_FBASE]: (state, action) => {
        var newState = _.cloneDeep(state)
        newState.fbaseCloudLoginSaved = { 
              email: action.payload.email,
           photoURL: action.payload.photoURL
        }
        userData_SaveAll({ userData: newState, hideToast: false })
        return newState 
    },

    //
    // exchange service (XS)
    //
    [XS_SET_EXCHANGE_ASSET]: (state, action) => {
        utilsWallet.logMajor('orange','black', `XS_SET_EXCHANGE_ASSET`, action.payload, { logServerConsole: true })
        return {...state, exchange: {...state.exchange, cur_fromSymbol: action.payload } }
    },
    [XS_SET_RECEIVE_ASSET]: (state, action) => {
        utilsWallet.logMajor('orange','black', `XS_SET_RECEIVE_ASSET`, action.payload, { logServerConsole: true })
        return {...state, exchange: {...state.exchange, cur_toSymbol: action.payload } }
    },

    [XS_SET_MINMAX_AMOUNT]: (state, action) => {
        utilsWallet.logMajor('orange','black', `XS_SET_MINMAX_AMOUNT`, action.payload, { logServerConsole: true })
        return {...state, exchange: {...state.exchange, 
            cur_minAmount: action.payload.min,
            cur_maxAmount: action.payload.max,
         cur_minAmountErr: undefined
        } }
    },

    [XS_SET_EST_RECEIVE_AMOUNT]: (state, action) => {
        utilsWallet.logMajor('orange','black', `XS_SET_EST_RECEIVE_AMOUNT`, action.payload, { logServerConsole: true })
        return {...state, exchange: {...state.exchange, 
            cur_estReceiveAmount: action.payload.result,
                 cur_fixedRateId: undefined
        } }
    },
    [XS_SET_FIXED_RECEIVE_AMOUNT]: (state, action) => {
        utilsWallet.logMajor('orange','black', `XS_SET_FIXED_RECEIVE_AMOUNT`, action.payload, { logServerConsole: true })
        return {...state, exchange: {...state.exchange, 
            cur_estReceiveAmount: action.payload.derivedExpected, 
                 cur_fixedRateId: action.payload.rateId
        }}
    },

    [XS_UPDATE_EXCHANGE_TX]: (state, action) => {
        if (action.payload.owner === utilsWallet.getStorageContext().owner) { // redux-state-sync
            const asset = Object.keys(action.payload.data)[0]
            var newUserData = _.cloneDeep(state)

            // skip update and DSC save unless actually changed - avoids intermittent DSC "duplicate transaction" exceptions
            if (_.isEqual(state.exchange.cur_xsTx[asset], action.payload.data[asset]) == false) { 
                utilsWallet.logMajor('orange','black', `XS_UPDATE_EXCHANGE_TX`, action.payload, { logServerConsole: true })
                newUserData.exchange.cur_xsTx[asset] = {...newUserData.exchange.cur_xsTx[asset], ...action.payload.data[asset] }
                userData_SaveAll({ userData: newUserData, hideToast: true })
            }
            return newUserData
        }
    },

    [XS_SET_CURRENCIES]: (state, action) => {
        utilsWallet.logMajor('orange','black', `XS_SET_CURRENCIES`, action.payload.length, { logServerConsole: true })
        return {...state, exchange: {...state.exchange, 
            currencies: action.payload
        } }
    },
}

//export default 
module.exports = { 
    userData: createReducer(initialState, handlers),
    initialState
}


