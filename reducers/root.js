import { combineReducers } from 'redux'

import wallet from './wallet'
import syncInfo from './sync-info'
import prices from './prices'

const appReducers = combineReducers({
    wallet,
    syncInfo,
    prices
})

export default (state, action) => {
    // if (action.type === ...) {
    //     state = undefined
    // }
    return appReducers(state, action)
}
