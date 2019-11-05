import { equal } from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult } from 'slpjs';
import * as zmq from 'zeromq';
import { BITBOX } from 'bitbox-sdk';
import BigNumber from 'bignumber.js';

const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// connect to bitcoin regtest network JSON-RPC
const rpcClient = require('bitcoin-rpc-promise-retry');
const connectionStringNode1_miner = 'http://bitcoin:password@0.0.0.0:18443';  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });

// connect to SLPDB ZMQ notifications
const slpdbTxnNotifications = [];
const slpdbBlockNotifications = [];
const sock: any = zmq.socket('sub');
sock.connect('tcp://0.0.0.0:27339');
sock.subscribe('mempool');
sock.subscribe('block');
sock.on('message', async function(topic: string, message: Buffer) {
    if (topic.toString() === 'mempool') {
        let obj = JSON.parse(message.toString('utf8'));
        slpdbTxnNotifications.unshift(obj);
    } else if (topic.toString() === 'block') {
        let obj = JSON.parse(message.toString('utf8'));
        slpdbBlockNotifications.unshift(obj);    
    }
});

// setup the SLP validator
const validator = new LocalValidator(bitbox, async (txids) => { 
    let txn;
    try {
        txn = <string>await rpcNode1_miner.getRawTransaction(txids[0]);
    } catch(err) {
        throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`)
    }
    return [ txn ];
}, console);

let receiver: string;
let nonSlpUtxos: SlpAddressUtxoResult[];

describe("1-Genesis-Token-Type", () => {
    it("setup", async () => {
        // (optional) connect miner node to a full node that is connected to slpdb
        // try {
        //     await rpcNode1_miner.addNode("bitcoin2", "onetry");
        // } catch(err) { }
        
        // generate coins to use in tests
        let balance = await rpcNode1_miner.getBalance();
        while (balance === 0) {
            await rpcNode1_miner.generate(1);
            balance = await rpcNode1_miner.getBalance();
        }

        // put all the funds on the receiver's address
        receiver = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiver, balance, "", "", true);

        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        nonSlpUtxos = utxos.nonSlpUtxos;

        equal(nonSlpUtxos.length > 0, true);
    });

    it("produces ZMQ output", async () => {
        // create and broadcast SLP genesis transaction
        receiver = Utils.toSlpAddress(receiver);
        let genesisTxnHex = txnHelpers.simpleTokenGenesis(
                                    "unit-test-1", "ut1", new BigNumber(10), null, null, 
                                    1, receiver, receiver, receiver, nonSlpUtxos);
        let txid = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);

        // give slpdb time to process
        while(slpdbTxnNotifications.length === 0) {
            console.log("Waiting...");
            await sleep(50);
        }

        // check that SLPDB made proper outgoing ZMQ messages for 
        equal(slpdbTxnNotifications.length > 0, true);
    });
});
