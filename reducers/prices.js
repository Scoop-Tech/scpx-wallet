// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.
const { 
    PRICE_SOCKET_CONNECTED, PRICE_SOCKET_DISCONNECTED,
    
    BTC_PRICE_UPDATE, 
    LTC_PRICE_UPDATE,
    ZEC_PRICE_UPDATE,
    DASH_PRICE_UPDATE,
    VTC_PRICE_UPDATE,
    QTUM_PRICE_UPDATE,
    DGB_PRICE_UPDATE,
    BCH_PRICE_UPDATE,

    ETH_PRICE_UPDATE, 
            ZRX_PRICE_UPDATE, TUSD_PRICE_UPDATE, BNT_PRICE_UPDATE, BAT_PRICE_UPDATE, BNB_PRICE_UPDATE,
            OMG_PRICE_UPDATE, GTO_PRICE_UPDATE, SNT_PRICE_UPDATE, HT_PRICE_UPDATE, //VEN_PRICE_UPDATE, BTM_PRICE_UPDATE, 
            USDT_PRICE_UPDATE, EURT_PRICE_UPDATE,
            LINK_PRICE_UPDATE, ZIL_PRICE_UPDATE, HOT_PRICE_UPDATE, REP_PRICE_UPDATE, MKR_PRICE_UPDATE, 
 
    EOS_PRICE_UPDATE, 

    FIAT_RATES_UPDATE,
} = require('../actions')

const { createReducer } = require('./utils')

const initialState = {
    price : {
        BTC: 0, BTC_TEST: 0, BTC_SEG: 0, EOS: 0, LTC: 0, LTC_TEST: 0,
        ZEC: 0, ZEC_TEST: 0,
        DASH: 0, VTC: 0, QTUM: 0, DGB: 0, BCHABC: 0, 

        ETH: 0, ETH_TEST: 0,
            TUSD: 0, ZRX: 0, BNT: 0, BAT: 0, BNB: 0,
             OMG: 0, GTO: 0, SNT: 0,  HT: 0, //VEN: 0, BTM: 0,
            USDT: 0, EURT: 0,
            LINK: 0, ZIL: 0, HOT: 0, REP: 0, MKR: 0,
    }
}

const handlers = {
    [PRICE_SOCKET_CONNECTED]: (state, action) => {
        return { ...state, price: { ...state.price, isConnected: true } }
    },
    [PRICE_SOCKET_DISCONNECTED]: (state, action) => {
        return { ...state, price: { ...state.price, isConnected: false } }
    },

    // utxo
    [BTC_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, BTC: action.payload.price, BTC_TEST: action.payload.price, BTC_SEG: action.payload.price } }
    },
    [LTC_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, LTC: action.payload.price, LTC_TEST: action.payload.price } }
    },
    [ZEC_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, ZEC: action.payload.price, ZEC_TEST: action.payload.price } }
    },
    [DASH_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, DASH: action.payload.price } }
    },
    [VTC_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, VTC: action.payload.price } }
    },
    [QTUM_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, QTUM: action.payload.price } }
    },
    [DGB_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, DGB: action.payload.price } }
    },
    [BCH_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, BCHABC: action.payload.price } }
    },
    
    // eth
    [ETH_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, ETH: action.payload.price, ETH_TEST: action.payload.price } }
    },

    // erc20
    [TUSD_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, TUSD: action.payload.price } }
    },
    [BNT_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, BNT: action.payload.price } }
    },
    [ZRX_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, ZRX: action.payload.price } }
    },
    [BAT_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, BAT: action.payload.price } }
    },
    [BNB_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, BNB: action.payload.price} }
    },

    [OMG_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, OMG: action.payload.price} }
    },
    [GTO_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, GTO: action.payload.price} }
    },
    [SNT_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, SNT: action.payload.price} }
    },
    [HT_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, HT: action.payload.price} }
    },
    // [BTM_PRICE_UPDATE]: (state, action) => {
    //     return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, BTM: action.payload.price} }
    // },
    // [VEN_PRICE_UPDATE]: (state, action) => {
    //     return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, VEN: action.payload.price} }
    // },

    [USDT_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, USDT: action.payload.price} }
    },
    [EURT_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, EURT: action.payload.price} }
    },

    [LINK_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, LINK: action.payload.price} }
    },
    [ZIL_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, ZIL: action.payload.price} }
    },
    [HOT_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, HOT: action.payload.price} }
    },
    [REP_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, REP: action.payload.price} }
    },
    [MKR_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, MKR: action.payload.price} }
    },
    
    // eos
    [EOS_PRICE_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, price: { ...state.price, EOS: action.payload.price } }
    },

    // fiat rates (multiple) to USD
    [FIAT_RATES_UPDATE]: (state, action) => {
        return { ...state, lastPriceUpdateAt: action.payload.lastPriceUpdateAt, fiatUsdRates: action.payload.fiatUsdRates }
    },
}

//export default 
module.exports = 
createReducer(initialState, handlers)