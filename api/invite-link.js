// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const API = require('./api').axiosApi
const BigDecimal = require('js-big-decimal')

const utilsWallet = require('../utils')

module.exports = {
    send: (req) => { 
        console.log(`POST invite_link - owner=${req.owner}`)
        return API.post(`invite_link`, req)
        .then(res => {
            return res.data
        })
        .catch(err => {
            const msg = e.response && e.response.data ? e.response.data.toString() : e.toString()
            utilsWallet.reportErr(msg)
            utilsWallet.error(`Failed: Send Invite`, err)
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Failed: Send Invite', info: err.toString() }})
        })
    },

    getByOwner: (req) =>  {
        console.log(`POST invite_links (getByOwner) - owner=${req.owner}`)
        return API.post(`invite_links`, req)
        .then(res => {
            return res.data
        })
        .catch(err => {
            utilsWallet.reportErr(err)
            utilsWallet.error(err.toString())
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Failed: Get Invites', info: err.toString() }})
        })
    },

    getByInviteId: (req) =>  {
        console.log(`POST invite_links (getByInviteId) - invite_id=${req.invite_id}`)
        return API.get(`invite_link/${req.invite_id}`)
        .then(res => {
            return res.data
        }) // let caller catch; special (redirect) handling needed
    },

    accept: (req) =>  {
        console.log(`PUT invite_link (accept) - invite_id=${req.invite_id}`)
        return API.put(`invite_link`, req)
        .then(res => {
            return res.data
        }).catch(err => {
            utilsWallet.reportErr(err)
            utilsWallet.error(err.toString())
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Failed: Accept Invite', info: err.toString() }})
        })
    },
}


