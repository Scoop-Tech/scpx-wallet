// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

module.exports = {
    createReducer: (initialState, handlers) => {
        return (state = initialState, action) => {
            const handler = handlers[action.type]
            if (!handler) return state
            return { ...state, ...handler(state, action) }
        }
    }
}
