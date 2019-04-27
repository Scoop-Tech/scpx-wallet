
const io = require('socket.io-client')
const axios = require('axios')
const axiosRetry = require('axios-retry')

const configWS = require('../config/websockets')
const configWallet = require('../config/wallet')

const actionsWallet = require('../actions')

const utilsWallet = require('../utils')

module.exports = {
        
    // rest interface - takes prices from bitfinex & cryptocompare rest api's, per asset config
    fetch: () => {
        const fxApi = 'https://api.exchangeratesapi.io/latest?base=USD'

        utilsWallet.debug('appWorker >> prices fetch...')

        // get cryptocompare prices
        var symbols_cc = Object
        .keys(configWallet.walletsMeta)
        .filter(p => { return p.indexOf("(t)") == -1 && configWallet.walletsMeta[p].priceSource == configWallet.PRICE_SOURCE_CRYPTOCOMPARE })
        .map(p => { return configWallet.walletsMeta[p].priceSource_CC_symbol || 
                        configWallet.walletsMeta[p].displaySymbol })
                        
        symbols_cc = [...new Set(symbols_cc)]
        const csv_symbols_cc = symbols_cc.join()
        
        axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
        axios.get(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${csv_symbols_cc}&tsyms=USD`)
        .then((resCryptocompare) => {
            if (resCryptocompare && resCryptocompare.data) {
                const keys = Object.keys(resCryptocompare.data)
                if (keys) {
                    const actions = []
                    keys.forEach(symbol => {
                        const price = resCryptocompare.data[symbol]
                        if (price && price.USD) {
                            var n_price = price.USD

                            const action = { // crypto/usd - add to batch
                                type: actionsWallet.getPriceUpdateDispatchType(symbol),
                                payload: { price: Number(n_price), lastPriceUpdateAt: new Date() }
                            }
                            actions.push(action)

                        } else utilsWallet.warn('appWorker >> prices fetch - bad price data from cryptocompare')
                    })

                    // get fiat fx to usd
                    axios.get(fxApi)
                    .then((resFx) => {
                        if (resFx && resFx.data) {
                            const ratesToUsd = resFx.data.rates
                            if (ratesToUsd) {

                                // keep track of rates to USD
                                const action = { // fiat/usd (multiple) - add to update batch
                                    type: actionsWallet.FIAT_RATES_UPDATE,
                                    payload: { fiatUsdRates: ratesToUsd, lastPriceUpdateAt: new Date() }
                                }
                                actions.push(action)

                                // hack (eurt) - use eur/usd fiat rate (todo: bitfinex WS)
                                var symbols_synthFiat = Object
                                    .keys(configWallet.walletsMeta)
                                    .filter(p => { return configWallet.walletsMeta[p].priceSource == configWallet.PRICE_SOURCE_SYNTHETIC_FIAT })
                                    .map(p => { return { syntheticFiatCcy: configWallet.walletsMeta[p].syntheticFiatCcy, symbol: configWallet.walletsMeta[p].displaySymbol } })

                                symbols_synthFiat.forEach(p => {
                                    const syntheticFiatCcy = p.syntheticFiatCcy
                                    const symbol = p.symbol
                                    if (ratesToUsd[syntheticFiatCcy] && ratesToUsd[syntheticFiatCcy] != 0) {
                                        const price = 1 / ratesToUsd[syntheticFiatCcy]
                            
                                        const action = { // crypto/usd - add to batch (synthetic price)
                                            type: actionsWallet.getPriceUpdateDispatchType(symbol),
                                            payload: { price: Number(price), lastPriceUpdateAt: new Date() }
                                        }
                                        actions.push(action)
                                    }
                                })
                            }

                            // done
                            // dispatch batch update
                            postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: actions } } ) 

                        } else utilsWallet.warn('appWorker >> fetch - bad fx data')
                    })

                    // get bitfinex prices
                    // #### can't use -- no cors headers on responses
                    // var symbols_bf = Object.keys(configWallet.walletsMeta)
                    //                        .filter(p => configWallet.walletsMeta[p].priceSource == configWallet.PRICE_SOURCE_BITFINEX)
                    //                        .map(p => { return { bitfinexUsdTicker: configWallet.walletsMeta[p].bitfinexUsdTicker,
                    //                                                        symbol: configWallet.walletsMeta[p].symbol } })
                    // symbols_bf = [...new Set(symbols_bf.map(p => p.bitfinexUsdTicker))]
                    // const csv_symbols_bf = symbols_bf.join()
                    // debugger
                    // axios.get(`${bitfinexProxy}/v2/tickers?symbols=${csv_symbols_bf}`)
                    // .then((resBitfinex) => {
                    //     debugger
                    //     if (resBitfinex && resBitfinex.data) {
                    //         const data = resBitfinex.data
                    //         data.forEach(price => {
                    //             debugger
                    //             const ticker = price[0]
                    //             const bid = price[1]
                    //             const bidSize = price[2]
                    //             const ask = price[3]
                    //             const askSize = price[4]
                    //             const dailyChange = price[5]
                    //             const dailyChangePerc = price[6]
                    //             const last = price[7]
                    //             const vol = price[8]
                    //             const high = price[9]
                    //             const low = price[10]

                    //             // add result to update batch
                    //             const symbol = symbols_bf.find(p => p.bitfinexUsdTicker == ticker).symbol
                    //             const action = {
                    //                    type: actionsWallet.getPriceUpdateDispatchType(symbol),
                    //                 payload: { price: Number(last), lastPriceUpdateAt: new Date() }
                    //             }
                    //             actions.push(action)
                    //         })

                    //         postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: actions } } ) 
                    //     }
                    //     else utilsWallet.warn('appWorker >> fetch - no response from bitfinex')
                    // })


                }
                else utilsWallet.warn('appWorker >> fetch - bad response from cryptocompare')
            }
            else utilsWallet.warn('appWorker >> fetch - no response from cryptocompare')
        })
    },

    // not used -- no HT prices on cryptocompare socket (others missing too)
    priceSocket_Disconnect: () => {
        if (self.priceSocket) {
            utilsWallet.debug('appWorker >> priceSocket_Disconnect - DISCONNECTING: socket=', self.priceSocket)
            try {
                self.priceSocket.disconnect()
                postMessage({ msg: 'REQUEST_DISPATCH', status: 'DISPATCH', data: { dispatchType: actionsWallet.PRICE_SOCKET_DISCONNECTED } })
            }
            catch(err) { utilsWallet.error(`### appWorker >> priceSocket_Disconnect, err=`, err) }
        }
    },
    priceSocket_Connect: () => {
        var lastPriceAt = {}

        if (!configWallet.SOCKET_DISABLE_PRICES) {

            if (self.priceSocket !== undefined) {
                if (self.priceSocket.connected === false) {
                    utilsWallet.warn(`appWorker >> ${self.workerId} priceSocket_Connect: got disconnected socket - nuking it!`)
                    self.priceSocket = undefined
                }
            }

            if (self.priceSocket === undefined) {
                try {

                    self.priceSocket = io(configWS.cryptocompare_priceSocketConfig.baseURL)
                    
                    self.priceSocket.on('connect', function() {
                        utilsWallet.log(`appWorker >> ${self.workerId} priceSocket_Connect - socket connect...`)
                        try {
                            self.priceSocket.emit('SubAdd', { subs: configWS.cryptocompare_priceSocketConfig.subAdd })
                            postMessage({ msg: 'REQUEST_DISPATCH', status: 'DISPATCH', data: {
                                dispatchType: actionsWallet.PRICE_SOCKET_CONNECTED } })
                        }
                        catch(err) { utilsWallet.error(`### appWorker >> ${self.workerId} priceSocket_Connect - socket connect, err=`, err) }
                    })
                    
                    self.priceSocket.on('disconnect', function() {
                        utilsWallet.warn(`appWorker >> ${self.workerId} PRICES - disconnect...`)
                        self.priceSocket = undefined
                        try {
                            postMessage({ msg: 'REQUEST_DISPATCH', status: 'DISPATCH', data: { dispatchType: actionsWallet.PRICE_SOCKET_DISCONNECTED } })
                        }
                        catch(err) { utilsWallet.error(`### appWorker >> ${self.workerId} PRICES - disconnect, err=`, err) }
                    })

                    self.priceSocket.on('m', function(data) {
                        if (!configWallet.SOCKET_DISABLE_PRICES) {
                            try {
                                // data set
                                // '{SubscriptionId}~{ExchangeName}~{FromCurrency}~{ToCurrency}~{Flag}~{Price}~{LastUpdate}~{LastVolume}~{LastVolumeTo}~{LastTradeId}~{Volume24h}~{Volume24hTo}~{LastMarket}'
                                const datas = data.split('~')
                                const type = datas[0]
                                const fromCurrency = datas[2]
                                const price = datas[5]

                                if (price) {
                                    if (type === '5') {
                                        if (Number(price) !== NaN) {
                                            const flag = datas[4]
                                            // flag desc
                                            // 1 - price up
                                            // 2 - price down
                                            // 4 - price unchanged (will not include price in data)

                                            // don't push prices too frequently; it's surprisingly expensive
                                            if (lastPriceAt[fromCurrency] === undefined
                                                || (flag != 4 &&  ((new Date().getTime() - lastPriceAt[fromCurrency]) / 1000) > CONST.PRICE_UPDATE_INTERVAL_SECS)) {

                                                utilsWallet.log(`price update ccy=${fromCurrency}, price=${price}`)
                                                
                                                lastPriceAt[fromCurrency] = new Date().getTime()

                                                utilsWallet.log(`dispatch price update - asset=${fromCurrency} price=${price}...`)
                                                
                                                postMessage({ msg: 'REQUEST_DISPATCH', status: 'DISPATCH',
                                                    data: { dispatchType: actionsWallet.getPriceUpdateDispatchType(fromCurrency),
                                                        dispatchPayload: { price: Number(price), lastPriceUpdateAt: new Date() } }
                                                })
                                            }
                                        }
                                    }
                                }
                            }
                            catch(err) { utilsWallet.error(`### appWorker >> ${self.workerId} priceSocket_Connect - on data, err=`, err) }
                        }
                    })
                }
                catch(err) {
                    utilsWallet.error(`appWorker >> ${self.workerId} priceSocket_Connect >> , err=`, err)
                    utilsWallet.trace()
                }
            }
        }
    }    
}
