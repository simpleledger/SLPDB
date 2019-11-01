import { Slp, LocalValidator, TransactionHelpers, Utils } from 'slpjs';
import { BITBOX } from 'bitbox-sdk';
import BigNumber from 'bignumber.js';
const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// connect to regtest network full nodes via JSON-RPC
const rpcClient = require('bitcoin-rpc-promise-retry');
const connectionStringNode1_miner = 'http://bitcoin:password@0.0.0.0:18444';  // 18444 is the miner's rpc
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });
// const connectionStringNode2_slpdb = 'http://bitcoin:password@0.0.0.0:18443';  // 18443 is the full node's serving SLPDB
// const rpcNode2_slpdb = new rpcClient(connectionStringNode2_slpdb, { maxRetries: 0 });

// setup SLP validator
const validator = new LocalValidator(bitbox, async (txids) => { 
    let txn;
    try {
        txn = <string>await rpcNode1_miner.getRawTransaction(txids[0]);
    } catch(err) {
        throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`)
    }
    return [ txn ];
}, console);

(async () => {
    // connect to miner to full node that is serving slpdb
    try {
        await rpcNode1_miner.addNode("bitcoin2", "onetry");
    } catch(err) { }
    
    // generate enough blocks to have mature coins
    await rpcNode1_miner.generate(101);

    // prepare and validate utxos for SLP
    let unspent = await rpcNode1_miner.listUnspent();
    unspent.map((txo: any) => txo.cashAddress = txo.address);
    unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
    await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));
    let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
    let receiver = Utils.toSlpAddress(await rpcNode1_miner.getNewAddress("0"));

    // create and broadcast SLP genesis transaction
    let genesisTxnHex = txnHelpers.simpleTokenGenesis(
                                "unit-test-1", "ut1", new BigNumber(10), null, null, 
                                1, receiver, receiver, receiver, utxos.nonSlpUtxos);
    let txid = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);

    // give slpdb time to process
    await sleep(1000);

    // check that SLPDB/mongoDB was updated properly
    
})();
