// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const redux = require('redux')

const wallet = require('./wallet')
const syncInfo = require('./sync-info')
const prices = require('./prices')
const { userData } = require('./user-data')

const appReducers = redux.combineReducers({
    wallet,
    syncInfo,
    prices,
    userData
})

module.exports = (state, action) => {
    return appReducers(state, action)
}
