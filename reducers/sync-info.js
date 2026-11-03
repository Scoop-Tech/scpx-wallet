// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const _ = require('lodash')

const { createReducer } = require('./utils')
const { SET_ASSET_BLOCK_INFO } = require('../actions')

const initialState = {}

const handlers = {
    [SET_ASSET_BLOCK_INFO]: (state, action) => {

        // update syncinfo for asset
        var newState = _.cloneDeep(state)

        // merge: keep fields a given update doesn't carry (e.g. medianTimePast, only computed for PROTECT_OP assets)
        newState[action.payload.symbol] = Object.assign({}, state[action.payload.symbol], action.payload)

        return newState
    },
}

module.exports = createReducer(initialState, handlers)

