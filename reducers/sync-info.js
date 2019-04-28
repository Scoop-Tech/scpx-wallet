'use strict';

const _ = require('lodash')

const { createReducer } = require('./utils')
const { SET_ASSET_BLOCK_INFO } = require('../actions')

//export
const initialState = {}

const handlers = {

    [SET_ASSET_BLOCK_INFO]: (state, action) => {

        // update syncinfo for asset
        var newState = _.cloneDeep(state)

        newState[action.payload.symbol] = action.payload

        return newState
    },

}

//export default
module.exports = 
createReducer(initialState, handlers)

