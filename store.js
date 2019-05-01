// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const { createStore, applyMiddleware } = require('redux')
const thunk = require('redux-thunk').default
const reduxPersist = require('redux-persist')

const reduxBatchedActions = require('redux-batched-actions')

const root = require('./reducers/root')

const rootReducer = (state, action) => {
    return root(state, action)
}

const store = createStore(
    reduxBatchedActions.enableBatching(
        rootReducer // no persistence
    ),
    applyMiddleware(thunk)
)

const persistor = reduxPersist.persistStore(store)

module.exports = {
    store,
    persistor
}