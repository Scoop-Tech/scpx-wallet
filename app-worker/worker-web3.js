
const configWS = require('../config/websockets')

const utilsWallet = require('../utils')

module.exports = {
    // maintains a single websocket web3 provider for lighter/faster eth & erc20 balance updates
    web3_Setup_SingletonSocketProvider: () => {
        if (self.ws_web3 === undefined) {
            utilsWallet.log(`appWorker >> ${self.workerId} WEB3(WS) - SocketProvider SETUP...`)
            
            try {

                // geth: fails on geth v 1.8.2 w/ large web3 getTransactionDetail return packets (large ~= 16kb ?) -- gets EOF and hard-disconnects the WS from server
                const Web3 = require('web3')
                const web3 = new Web3(new Web3.providers.WebsocketProvider(configWS.geth_ws_config['ETH'].url))

                // parity: try-fix - https://github.com/ethereum/go-ethereum/issues/16846 ...
                //const web3 = new Web3(new Web3.providers.WebsocketProvider(configWS.parityPubSub_ws_config['ETH'].url))
                
                const provider = web3.currentProvider
                self.ws_web3 = web3

                // these error/end handlers are *not* firing on the geth WS disconnect issue above ("unexpected EOF" from geth in WS response frame)
                // if (provider) { 
                //     provider.on("connect", data => { utilsWallet.log(`appWorker >> ${self.workerId} WEB3(WS) - socket connect, data=`, data) })
                    
                //     // set disconnect/error handlers
                //     provider.on("error", socketErr => { 
                //         debugger
                //         utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - socket error callback, socketErr=`, socketErr)
                //         self.ws_web3 = undefined 
                //     })
                //     provider.on("end", socketErr => {
                //         debugger
                //         utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - socket end, socketErr=`, socketErr)
                //         self.ws_web3 = undefined
                //     })
                // }
            }
            catch(err) {
                utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - err=`, err)
            }
        }
    }

}
