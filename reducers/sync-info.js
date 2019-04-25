'use strict';

const _ = require('lodash')

import { createReducer } from './utils'
import { SET_ASSET_BLOCK_INFO } from '../actions'

export const initialState = {}

const handlers = {

    [SET_ASSET_BLOCK_INFO]: (state, action) => {

        // update syncinfo for asset
        var newState = _.cloneDeep(state)

        newState[action.payload.symbol] = action.payload

        return newState
    },

}

export default createReducer(initialState, handlers)

