import axios from 'axios'
import axiosRetry from 'axios-retry'

import * as configWallet from '../config/wallet'

const axiosApi = axios.create({ baseURL: configWallet.API_URL })

axiosRetry(
    axiosApi, configWallet.AXIOS_RETRY_API 
)

export default axiosApi

