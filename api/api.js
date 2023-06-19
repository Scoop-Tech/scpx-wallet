// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const configWallet = require('../config/wallet')

const axios = require('axios')
const axiosApi = axios.create({ baseURL: configWallet.API_URL })

//const axiosRetry = require('axios-retry')
//axiosRetry(axiosApi, configWallet.AXIOS_RETRY_API)

// const rax = require('retry-axios');
// axiosApi.defaults.raxConfig = { 
//     instance: axiosApi,
//     retry: 3,
//     httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT', 'POST'],
//     statusCodesToRetry: [[100, 199], [400, 429], [500, 599]],
// };
// const interceptorId = rax.attach(axiosApi);

// function retryFailedRequest(err) {
//     if (err.status === 400 && err.config && !err.config.__isRetryRequest) {
//         err.config.__isRetryRequest = true;
//         return axios(err.config);
//     }
//     throw err;
// }
// axiosApi.interceptors.response.use(undefined, retryFailedRequest);

module.exports = {
    axiosApi
}

