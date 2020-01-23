export const ExchangeStatusEnum = {
    // our statuses:
    created: 'created',     // initial status
    done: 'done',           // set to done when xs tx is finalized, and when user has acknowledged final status
    
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

export function isStatusExchangePending(status) {
    switch(status) {
        case undefined:
        case ExchangeStatusEnum.done:

        case ExchangeStatusEnum.finished:
        case ExchangeStatusEnum.failed:
        case ExchangeStatusEnum.expired:
        case ExchangeStatusEnum.refunded:
        case ExchangeStatusEnum.overdue:
        case ExchangeStatusEnum.hold:
            return false
        
        default:
            return true
    }
}