// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const ExchangeStatus = {
    // our statuses:
       created: 'created',   // initial status
          done: 'done',      // set to done when xs tx is finalized, and when user has acknowledged final status
    
    // changelly statuses:
       waiting: 'waiting',
    confirming: 'confirming',
    exchanging: 'exchanging',
     receiving: 'receiving', // = sending in changelly docs
    
      finished: 'finished',
        failed: 'failed',
       expired: 'expired',
      refunded: 'refunded',
       overdue: 'overdue',
          hold: 'hold',
}

module.exports = {
    ExchangeStatusEnum: ExchangeStatus,

    isStatusExchangePending: (status) => {
        switch(status) {
            case undefined:
            case ExchangeStatus.done:
    
            case ExchangeStatus.finished:
            case ExchangeStatus.failed:
            case ExchangeStatus.expired:
            case ExchangeStatus.refunded:
            case ExchangeStatus.overdue:
            case ExchangeStatus.hold:
                return false
            
            default:
                return true
        }
    }
}
