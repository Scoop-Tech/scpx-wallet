// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const axios = require('axios')
const axiosRetry = require('axios-retry')

const configWallet = require('../config/wallet')

const axiosApi = axios.create({ baseURL: configWallet.API_URL })
axiosRetry(axiosApi, configWallet.AXIOS_RETRY_API)

module.exports = {
    axiosApi
}

