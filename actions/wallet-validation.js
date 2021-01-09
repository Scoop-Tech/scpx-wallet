// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const Buffer = require('buffer').Buffer
const _ = require('lodash')
const WAValidator = require('scp-address-validator').validate
const bchAddr = require('bchaddrjs')

module.exports = { 

    validateAssetAddress: (p) => {
        var { testSymbol, testAddressType, validateAddr } = p
        if (!testSymbol || testSymbol.length == 0) throw 'testSymbol is required'
        if (!testAddressType || testAddressType.length == 0) throw 'testAddressType is required'
        if (testAddressType === 'BECH32') testAddressType = 'BTC'

        if (testSymbol === 'BCHABC') { // BCH: to legacy addr for validation
            if (validateAddr && validateAddr.length > 0) {
                try {
                    if (bchAddr.isCashAddress(validateAddr) || bchAddr.isBitpayAddress(validateAddr)) {
                        validateAddr = bchAddr.toLegacyAddress(validateAddr)
                    }
                }
                catch(err) {
                    console.warn(`## bchAddr.toLegacyAddress, err=`, err)
                }
            }
        }

        const isValid = WAValidator(validateAddr, testAddressType, testSymbol.includes('TEST') ? 'testnet' : 'prod')

        // fixed in scp-address-validator
        // if (testSymbol === 'VTC') { // WAValidator doesnt' recognize VTC 3-addresses
        //     if (!isValid) {
        //         if (validateAddr.startsWith('3') && validateAddr.length == 34) { // gross hack -- need to do this properly
        //             return true
        //         }
        //     }
        // }

        return isValid
    }
}
