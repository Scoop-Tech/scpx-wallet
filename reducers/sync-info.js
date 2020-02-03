// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const _ = require('lodash')

const { createReducer } = require('./utils')
const { SET_ASSET_BLOCK_INFO } = require('../actions')

const initialState = {}

const handlers = {
    [SET_ASSET_BLOCK_INFO]: (state, action) => {

        // update syncinfo for asset
        var newState = _.cloneDeep(state)

        newState[action.payload.symbol] = action.payload

        return newState
    },
}

module.exports = createReducer(initialState, handlers)

