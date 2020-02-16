// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const _ = require('lodash')

const { userData_SaveAll } = require('../actions/user-data')
const { getUserData_FromEncryptedJson } = require('../actions/user-data-helpers')
const { USERDATA_SET_FROM_SERVER, USERDATA_UPDATE_LASTLOAD, 
        USERDATA_UPDATE_OPTION,
        USERDATA_UPDATE_FBASE,
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

    loadHistory: [ 
        { browser: false, server: false, datetime: undefined }, // ndx 0 - current login
        { browser: false, server: false, datetime: undefined }  // ndx 1 - previous login
    ],

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

        cur_xsTx: {
            //...
        }, 
        // todo: -> cur_xsTx.eth -> cur_xsTx.eth[] -- i.e. functions as current and history
        // * creating new --> append only (not replace) ...
        // * updating     --> find, update in place
        // * removing     --> nop

        //cur_xsTxStatus: {}, // todo: -> either remove, or couple into cur_xsTx[asset][i].cur_xsTxStatus
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

    // user settings (options)
    [USERDATA_UPDATE_OPTION]: (state, action) => {
        var ndx = state.options.findIndex((p) => p.key === action.key)

        // disregard actions that originate from a different logged on user (this action is propagated by redux-state-sync)
        if (action.payload.owner === utilsWallet.getStorageContext().owner) { 
            var newState = _.cloneDeep(state)
            newState.options[ndx].value = action.payload.newValue
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


