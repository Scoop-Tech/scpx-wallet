import { combineReducers } from 'redux'

import wallet from './wallet'

const appReducers = combineReducers({
    wallet,
})

export default (state, action) => {
    // if (action.type === ...) {
    //     state = undefined
    // }
    return appReducers(state, action)
}
