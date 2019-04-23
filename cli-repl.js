const repl = require('repl')

import * as appStore from './store'
import * as utilsWallet from './utils'

export function repl_init(walletContext) {

    const colors = { RED: "31", GREEN: "32", YELLOW: "33", BLUE: "34", MAGENTA: "35" }
    const colorize = (color, s) => `\x1b[${color}m${s}\x1b[0m`
    const say = message => () => console.log(message)
    const nodeVersion = colorize(colors.GREEN, `${process.title} ${process.version}`)
    const prompt = repl.start({ 
        useGlobal: true,
        useColors: true,
        terminal: true,
        prompt: `${nodeVersion} SW-CLI > `,
    })
    prompt.context.w = walletContext

    // custom commands
    delete prompt.commands.save
    delete prompt.commands.break
    delete prompt.commands.clear
    delete prompt.commands.load

    // test store dispatch
    prompt.defineCommand("test-dispatch", {
        help: "dispatches WCORE_SET_ASSETS_RAW action",
        action: function(arg) {
            this.clearBufferedCommand()
            say(`dispatching value ${arg}...`)

            appStore.store.dispatch({ type: walletActions.WCORE_SET_ASSETS_RAW, payload: arg })
            console.dir(w.store.getState())
            this.displayPrompt()
        }
    })

    // test cpuworker ping
    prompt.defineCommand("test-cpu-ping", {
        help: "sends DIAG_PING to cpuWorker[0]",
        action: function(arg) {
            this.clearBufferedCommand()
            say(`dispatching value ${arg} to:`, utilsWallet.cpuWorkers[0])

            utilsWallet.cpuWorkers[0].postMessage({ msg: 'DIAG_PING', data: {} })
            utilsWallet.cpuWorkers[0].on('message', (data) => {
                console.log(data)
            })

            this.displayPrompt()
        }
    })

    const sayBye = say(`Goodbye!`)
    prompt.on("exit", sayBye)

}