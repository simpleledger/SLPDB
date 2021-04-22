import * as assert from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult, SlpTransactionType } from 'slpjs';
import * as zmq from 'zeromq';
import { BITBOX } from 'bitbox-sdk';
import BigNumber from 'bignumber.js';
import { step } from 'mocha-steps';

import { Config } from "../config";
import { Db } from '../db';
import { TNATxn, TNATxnSlpDetails } from "../tna";
import { TokenBatonStatus } from "../interfaces";
import { TokenDBObject } from "../interfaces";

const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TOKEN_DECIMALS = 1;
const TOKEN_GENESIS_QTY = 100;
const TOKEN_SEND_QTY = 1;

// connect to bitcoin regtest network JSON-RPC
const rpcClient = require('bitcoin-rpc-promise-retry');
const connectionStringNode1_miner = `http://bitcoin:password@${process.env.RPC1_HOST}:${process.env.RPC1_PORT}`;  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });

// setup a new local SLP validator instance
const validator = new LocalValidator(bitbox, async (txids) => { 
    let txn;
    try {
        txn = <string>await rpcNode1_miner.getRawTransaction(txids[0]);
    } catch(err) {
        throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`)
    }
    return [ txn ];
}, console);

// connect to SLPDB ZMQ notifications
let slpdbTxnNotifications: TNATxn[] = [];
let slpdbBlockNotifications: { txns: { slp: TNATxnSlpDetails, txid: string }[], hash: string }[] = [];
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

// connect to the regtest mongoDB
let db = new Db({ dbUrl: `mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`, dbName: "slpdb_test", config: Config.db });

// produced and shared between tests.
let receiverRegtest: string;
let receiverSlptest: string; // this is same address as receiverRegtest, converted to slptest format
let txnInputs: SlpAddressUtxoResult[];
let tokenId: string;
let sendTxid: string;
let lastBlockHash: string;
let lastBlockIndex: number;
let genesisBlockIndex: number;

describe("6-Burn-with-invalid-txn", () => {

    step("Initial setup for all tests", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        
        // make sure we have coins to use in tests
        let balance = await rpcNode1_miner.getBalance();
        while (balance < 1) {
            await rpcNode1_miner.generate(1);
            balance = await rpcNode1_miner.getBalance();
        }

        // put all the funds on the receiver's address
        receiverRegtest = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiverRegtest, 1, "", "", true);
    });

    step("GENESIS: setup for the txn tests", async () => {
        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        txnInputs = utxos.nonSlpUtxos;

        assert.strictEqual(txnInputs.length > 0, true);
    });

    step("GENESIS: produces ZMQ output for the transaction", async () => {
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        // create and broadcast SLP genesis transaction
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);
        let genesisTxnHex = txnHelpers.simpleTokenGenesis({
            tokenName: "unit-test-6",
            tokenTicker: "ut6",
            tokenAmount: new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS),
            documentUri: null,
            documentHash: null, 
            decimals: TOKEN_DECIMALS,
            tokenReceiverAddress: receiverSlptest,
            batonReceiverAddress: receiverSlptest,
            bchChangeReceiverAddress: receiverSlptest, 
            inputUtxos: txnInputs
        });

        tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);

        // give slpdb time to process
        while(slpdbTxnNotifications.length === 0) {
            await sleep(50);
        }

        // check that SLPDB made proper outgoing ZMQ messages for 
        assert.strictEqual(slpdbTxnNotifications.length, 1);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.valid, true);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.name, "unit-test-6");
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.symbol, "ut6");
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.tokenIdHex, tokenId);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].address, receiverSlptest);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.transactionType, SlpTransactionType.GENESIS);
        // @ts-ignore
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!, TOKEN_GENESIS_QTY.toFixed());
        assert.strictEqual(slpdbTxnNotifications[0]!.blk === undefined, true);
        assert.strictEqual(typeof slpdbTxnNotifications[0]!.in, "object");
        assert.strictEqual(typeof slpdbTxnNotifications[0]!.out, "object");
        assert.strictEqual(typeof slpdbTxnNotifications[0]!.tx, "object");
    });

    step("GENESIS: stores in confirmed collection (after block)", async () => {
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        let txn = await db.confirmedFetch(tokenId);
        while(!txn) {
            await sleep(50);
            txn = await db.confirmedFetch(tokenId);
        }
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        genesisBlockIndex = lastBlockIndex;
        assert.strictEqual(txn!.slp!.valid, true);
        assert.strictEqual(txn!.slp!.detail!.name, "unit-test-6");
        assert.strictEqual(txn!.slp!.detail!.symbol, "ut6");
        // @ts-ignore
        assert.strictEqual(txn!.slp!.detail!.outputs![0].amount!.toString(), TOKEN_GENESIS_QTY.toFixed());        
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, txn!.tx.h);
    });

    step("SEND: setup for the txn tests", async () => {
        // get current address UTXOs
        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // process raw UTXOs
        let utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // select the inputs for transaction
        txnInputs = [ ...utxos.nonSlpUtxos, ...utxos.slpTokenUtxos[tokenId] ];

        assert.strictEqual(txnInputs.length > 1, true);
    });

    step("SEND: produces ZMQ output for the transaction", async () => {
        // clear ZMQ cache
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        // create a SEND Transaction
        let sendTxnHex = txnHelpers.simpleTokenSend({
            tokenId,
            sendAmounts: new BigNumber(TOKEN_SEND_QTY).times(10**TOKEN_DECIMALS),
            inputUtxos: txnInputs,
            tokenReceiverAddresses: receiverSlptest,
            changeReceiverAddress: receiverSlptest
        });

        sendTxid = await rpcNode1_miner.sendRawTransaction(sendTxnHex, true);

        while(slpdbTxnNotifications.length === 0) {
            await sleep(50);
        }

        // check that SLPDB made proper outgoing ZMQ messages for 
        assert.strictEqual(slpdbTxnNotifications.length, 1);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.valid, true);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.name, "unit-test-6");
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.symbol, "ut6");
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.tokenIdHex, tokenId);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].address, receiverSlptest);
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.transactionType, SlpTransactionType.SEND);
        // @ts-ignore
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!, (new BigNumber(TOKEN_SEND_QTY)).toFixed());
        let change = (new BigNumber(TOKEN_GENESIS_QTY)).minus(TOKEN_SEND_QTY).toFixed();
        // @ts-ignore
        assert.strictEqual(slpdbTxnNotifications[0]!.slp!.detail!.outputs![1].amount!, change);
        assert.strictEqual(slpdbTxnNotifications[0]!.blk === undefined, true);
        assert.strictEqual(typeof slpdbTxnNotifications[0]!.in, "object");
        assert.strictEqual(typeof slpdbTxnNotifications[0]!.out, "object");
        assert.strictEqual(typeof slpdbTxnNotifications[0]!.tx, "object");
    });

    step("SEND: stores in confirmed collection (after block)", async () => {
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        let txn = await db.confirmedFetch(sendTxid);
        while (!txn) {
            await sleep(50);
            txn = await db.confirmedFetch(sendTxid);
        }
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        assert.strictEqual(txn!.slp!.valid, true);
        assert.strictEqual(txn!.slp!.detail!.name, "unit-test-6");
        assert.strictEqual(txn!.slp!.detail!.symbol, "ut6");
        // @ts-ignore
        assert.strictEqual(txn!.slp!.detail!.outputs![0].amount!.toString(), TOKEN_SEND_QTY.toFixed());    
        // @ts-ignore
        assert.strictEqual(txn!.slp!.detail!.outputs![1].amount!.toString(), (TOKEN_GENESIS_QTY-TOKEN_SEND_QTY).toFixed());     
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, tokenId);
        assert.strictEqual(txn!.tx.h, sendTxid);
    });

    step("BURN: make an invalid SLP transaction that burns all SLP coins", async () => {
        let balance = await rpcNode1_miner.getBalance();
        await rpcNode1_miner.sendToAddress(receiverRegtest, balance, "", "", true);
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
    });

    step("BURN: check that tokens collection records correct circulating supply", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while (!t || t!.tokenStats!.block_created === null || t!.mintBatonUtxo !== "") {
            await sleep(50);
            t = await db.tokenFetch(tokenId);
        }
        assert.strictEqual(typeof t!.tokenDetails.timestamp, "string");
        assert.strictEqual(t!.tokenDetails.timestamp_unix! > 0, true);
        assert.strictEqual(t!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(t!.mintBatonUtxo, "");
        assert.strictEqual(t!.tokenStats!.block_created!, genesisBlockIndex);
        assert.strictEqual(t!.mintBatonStatus, TokenBatonStatus.DEAD_BURNED);
    });

    step("Cleanup after tests", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        sock.disconnect('tcp://0.0.0.0:27339');
    });
});
