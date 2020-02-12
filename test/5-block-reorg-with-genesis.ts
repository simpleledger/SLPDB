import * as assert from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult, SlpTransactionType } from 'slpjs';
import * as zmq from 'zeromq';
import { BITBOX } from 'bitbox-sdk';
import BigNumber from 'bignumber.js';
import { step } from 'mocha-steps';

import { Config } from "../config";
import { Db } from '../db';
import { TNATxn, TNATxnSlpDetails } from "../tna";
import { CacheMap } from "../cache";
import { TokenDBObject, TokenBatonStatus } from "../interfaces";

const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TOKEN_DECIMALS = 9;
const TOKEN_GENESIS_QTY = 1000000;

const rawTxnCache = new CacheMap<string, string>(10000);

// connect to bitcoin regtest network JSON-RPC
const rpcClient = require('bitcoin-rpc-promise-retry');
const connectionStringNode1_miner = 'http://bitcoin:password@0.0.0.0:18443';  // node IS connected to SLPDB
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });
const connectionStringNode2_miner = 'http://bitcoin:password@0.0.0.0:18444';  // node IS NOT connected to SLPDB
const rpcNode2_miner = new rpcClient(connectionStringNode2_miner, { maxRetries: 0 });

// setup a new local SLP validator instance
const validator = new LocalValidator(bitbox, async (txids: string[]) => { 
    let txn;
    if (rawTxnCache.has(txids[0])) {
        return [ rawTxnCache.get(txids[0]) as string ];
    }
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
let db = new Db({ dbUrl: "mongodb://0.0.0.0:26017", dbName: "slpdb_test", config: Config.db });

// produced and shared between tests.
let receiverRegtest: string;
let receiverSlptest: string; // this is same address as receiverRegtest, converted to slptest format
let txnInputs: SlpAddressUtxoResult[];

let invalidatedBlockHash: string;
let invalidatedBlockHeight: number;

let tokenId: string;
let txid1: string;
let txid2: string;

let lastBlockHash: string;
let lastBlockIndex: number;
let perInputAmount: BigNumber;
let actualInputsCreated: number;
let privKey: string;
let inputTxnCount: number;

let startingBlockCount: number;
let intendedBlockCount: number;

describe("5-Reorg-Removes-Data", () => {

    step("BR-1: Initial setup for all tests", async () => {

        startingBlockCount = await rpcNode1_miner.getBlockCount();
        intendedBlockCount = startingBlockCount;

        // generate a block to clear the mempool (may be dirty from previous tests)
        invalidatedBlockHash = (await rpcNode1_miner.generate(1))[0];
        intendedBlockCount++;
        //console.log((await rpcNode1_miner.getBlock(invalidatedBlockHash, true)).height);

        // connect miner node to a full node that is not connected to slpdb (to )
        try {
            await rpcNode1_miner.addNode("bitcoin1", "onetry");
        } catch(err) { }

        // make sure we have coins to use in tests
        let balance = await rpcNode1_miner.getBalance();
        while (balance < 1) {
            lastBlockHash = (await rpcNode1_miner.generate(1))[0];
            intendedBlockCount++;
            //console.log((await rpcNode1_miner.getBlock(lastBlockHash, true)).height);
            balance = await rpcNode1_miner.getBalance();
        }

        // put all the funds on the receiver's address
        receiverRegtest = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiverRegtest, 1, "", "", true);
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        intendedBlockCount++;
        //console.log((await rpcNode1_miner.getBlock(lastBlockHash, true)).height);

        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        txnInputs = utxos.nonSlpUtxos;

        // create a new token
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);
        let genesisTxnHex = txnHelpers.simpleTokenGenesis(
                                                        "unit-test-5", "ut5", 
                                                        new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS), 
                                                        null, null, 
                                                        TOKEN_DECIMALS, receiverSlptest, receiverSlptest, 
                                                        receiverSlptest, txnInputs
                                                        );
        tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);
    });

    step("BR-1: produces ZMQ output at block", async () => {
        // clear ZMQ cache
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        intendedBlockCount++;
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        while (slpdbBlockNotifications.filter(b => b.hash === lastBlockHash).length === 0) {
            await sleep(50);
        }
        let notification = slpdbBlockNotifications.filter(b => b.hash === lastBlockHash)[0];
        assert.equal(notification.txns.length, 1);
        assert.equal(notification.txns[0]!.txid, tokenId);
        assert.equal(notification.txns[0]!.slp.detail!.tokenIdHex, tokenId);
        assert.equal(notification.txns[0]!.slp.detail!.name, "unit-test-5");
        assert.equal(notification.txns[0]!.slp.detail!.symbol, "ut5");
        // @ts-ignore
        assert.equal(notification.txns[0]!.slp!.detail!.outputs![0].amount!, TOKEN_GENESIS_QTY.toFixed());  // this type is not consistent with txn notification
        // TODO: There is not block hash with block zmq notification!
        // assert.equal(typeof slpdbBlockNotifications[0]!.hash, "string");
        // assert.equal(slpdbBlockNotifications[0]!.hash.length, 64);
    });

    step("BR-1: Make sure the token exists in the tokens collection (after block)", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while (!t || t!.tokenStats!.block_created === null || typeof t!.tokenDetails.timestamp !== "string") { // || t!.tokenStats!.qty_token_burned.toString() !== "0" || typeof t!.tokenDetails.timestamp !== "string") {
            console.log(t!.tokenDetails.timestamp);
            await sleep(50);
            t = await db.tokenFetch(tokenId);
        }
        assert.equal(typeof t!.tokenDetails.timestamp, "string");
        assert.equal(t!.tokenDetails.timestamp_unix! > 0, true);
        assert.equal(t!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(t!.mintBatonUtxo, tokenId + ":2");
        assert.equal(t!.tokenStats!.block_created!, lastBlockIndex);
        // assert.equal(t!.tokenStats!.block_last_active_mint, null);
        // assert.equal(t!.tokenStats!.block_last_active_send, null);
        // assert.equal(t!.tokenStats!.qty_token_burned.toString() === "0", true);
        // assert.equal(t!.tokenStats!.qty_token_circulating_supply.toString(), TOKEN_GENESIS_QTY.toFixed());
        // assert.equal(t!.tokenStats!.qty_token_minted.toString(), TOKEN_GENESIS_QTY.toFixed());
        assert.equal(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("BR-1: Invalidate initial block and generate block to cause SLPDB reorg detection", async () => {
        await sleep(100);
        try {
            await rpcNode1_miner.invalidateBlock(lastBlockHash);
            await rpcNode2_miner.invalidateBlock(lastBlockHash);
        } catch (_) { } finally {
            intendedBlockCount--;
        }

        // add one block that we'll keep
        await rpcNode1_miner.generate(1);
        intendedBlockCount++;

        // add some blocks that we'll invalidate (so don't add to intendedBlockCount).
        let hashes = await rpcNode1_miner.generate(10);
        await sleep(100);
        try {
            await rpcNode1_miner.invalidateBlock(hashes[0]);
            await rpcNode2_miner.invalidateBlock(hashes[0]);
        } catch(_) { }

        await rpcNode1_miner.generate(1);
        intendedBlockCount++;

        assert.equal((await rpcNode1_miner.getBlockCount()), intendedBlockCount);
    });

    // SHOULD THIS TEST BE DELETED?
    // step("BR-1: Make sure the token genesis txn in the reorg has been removed everywhere", async () => {
    //     //let t: TokenDBObject | null = await db.tokenFetch(tokenId);
    //     let x: UtxoDbo[] = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
    //     let a: AddressBalancesDbo[] = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
    //     let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": tokenId });
    //     let txn_u = await db.unconfirmedFetch(tokenId);
    //     let txn_c = await db.confirmedFetch(tokenId);
    //     while(x.length !== 0 || a.length !== 0 || g || txn_u || txn_c) {
    //         await sleep(50);
    //         //t = await db.tokenFetch(txid1);
    //         x = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
    //         a = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
    //         g = await db.db.collection("graphs").findOne({ "graphTxn.txid": tokenId });
    //         txn_u = await db.unconfirmedFetch(tokenId);
    //         txn_c = await db.confirmedFetch(tokenId);
    //     }
    //     //assert.equal(t, null);
    //     assert.equal(x.length === 0, true);
    //     assert.equal(a.length === 0, true);
    //     assert.equal(g, null);
    //     assert.equal(txn_c, null);
    //     assert.equal(txn_u, null);
    // });

    step("Clean up", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        sock.disconnect('tcp://0.0.0.0:27339');
    });
});
