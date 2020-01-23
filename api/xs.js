import axios from 'axios'
//import axiosRetry from 'axios-retry'

import { axiosApi } from './api'

//import * as CONST from '../constants'
//import * as utils from '../utils'

export function xs_changelly_Sign(rpcParams) {
    const req = { rpc_params: rpcParams }

    //console.log('xs_changelly_Sign POST: ' + JSON.stringify(req, 2, null))
    
    //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
    return axiosApi.post(`xs/c/sign`, req)
    .then(res => {
        //console.log('xs_changelly_Sign POST, ret=' + JSON.stringify(res, 2, null))
        if (res && res.data) {
            return res.data
        }
        else  {
            console.error('## xs_changelly_Sign POST, no data')
            return null
        }
    })
    .catch(err => {
        utils.logErr(err)
        console.error('## xs_changelly_Sign POST, err= ', err)
        return null
    })
}