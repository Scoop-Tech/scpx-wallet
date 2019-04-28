'use strict';

const { createStore, applyMiddleware } = require('redux')
const { thunk } = require('redux-thunk')
const reduxPersist = require('redux-persist')

const reduxBatchedActions = require('redux-batched-actions')

const root = require('./reducers/root')

const rootReducer = (state, action) => {
    return root(state, action)
}

const store = createStore(
    reduxBatchedActions.enableBatching(
        rootReducer // no persistence
    )
    //applyMiddleware(thunk), 
)

const persistor = reduxPersist.persistStore(store)

module.exports = {
    store,
    persistor
}