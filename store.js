'use strict';

import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk' 

import { persistStore, persistReducer, autoRehydrate } from 'redux-persist'
import { enableBatching } from 'redux-batched-actions'

import { AsyncNodeStorage } from 'redux-persist-node-storage'
import autoMergeLevel2 from 'redux-persist/lib/stateReconciler/autoMergeLevel2'
import hardSet from 'redux-persist/lib/stateReconciler/hardSet'

import root from './reducers/root'

const rootReducer = (state, action) => {
    return root(state, action)
}

export const store = createStore(

    enableBatching(
        rootReducer // no persistence

        // ## persisted values are overriding/overwriting update in-memory state - reason unknown ##
        // persistReducer({ 
        //     key: 'root', 
        //     stateReconciler: autoMergeLevel2, 
        //     storage: new AsyncNodeStorage('/scpx-w-store'),
        //     blacklist: [],
        //     transforms: [],

        // }, rootReducer)
    ),

    applyMiddleware(thunk), 
)

export const persistor = persistStore(store)
