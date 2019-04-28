const redux = require('redux')

const wallet = require('./wallet')
const syncInfo = require('./sync-info')
const prices = require('./prices')

const appReducers = redux.combineReducers({
    wallet,
    syncInfo,
    prices
})

//export default 
module.exports = (state, action) => {
    return appReducers(state, action)
}
