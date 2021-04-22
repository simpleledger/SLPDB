import * as assert from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult } from 'slpjs';
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
const connectionStringNode1_miner = `http://bitcoin:password@${process.env.RPC1_HOST}:${process.env.RPC1_PORT}`;  // node IS connected to SLPDB
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });
const connectionStringNode2_miner = `http://bitcoin:password@${process.env.RPC2_HOST}:${process.env.RPC2_PORT}`;  // node IS NOT connected to SLPDB
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
let db = new Db({ dbUrl: `mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`, dbName: "slpdb_test", config: Config.db });

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

let genesisTxnHex: string;

let startingBlockCount: number;
let intendedBlockCount: number;

let originalBlockHashHex: string;

describe("5a-Reorg-Removes-Data", () => {

    step("BR-2: Initial setup for all tests", async () => {

        startingBlockCount = await rpcNode1_miner.getBlockCount();
        intendedBlockCount = startingBlockCount;

        // generate a block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        intendedBlockCount++;

        // connect miner node to a full node that is not connected to slpdb
        try {
            await rpcNode1_miner.addNode("bitcoin2", "onetry");
        } catch(err) { }
        let peerInfo: any[] = await rpcNode1_miner.getPeerInfo();
        while (peerInfo.length < 1) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length, 1);

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

        // give time for txn to propogate
        let mempool = await rpcNode2_miner.getRawMemPool();
        while (mempool.length === 0) {
            await sleep(50);
            mempool = await rpcNode2_miner.getRawMemPool();
        }
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        intendedBlockCount++;

        // check both nodes are on the same block
        let node1Hash = await rpcNode1_miner.getbestblockhash();
        let node2Hash = await rpcNode2_miner.getbestblockhash();  
        while (node1Hash !== node2Hash) {
            await sleep(50);
            node1Hash = await rpcNode1_miner.getbestblockhash();
            node2Hash = await rpcNode2_miner.getbestblockhash();
        }
        assert.strictEqual(node1Hash, node2Hash);

        // disconnect nodes
        peerInfo = await rpcNode1_miner.getPeerInfo();
        await rpcNode1_miner.disconnectNode("bitcoin2");
        while(peerInfo.length > 0) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length === 0, true);

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
        genesisTxnHex = txnHelpers.simpleTokenGenesis({
            tokenName: "unit-test-5a",
            tokenTicker: "ut5a", 
            tokenAmount: new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS), 
            documentUri: null,
            documentHash: null, 
            decimals: TOKEN_DECIMALS, 
            tokenReceiverAddress: receiverSlptest, 
            batonReceiverAddress: receiverSlptest, 
            bchChangeReceiverAddress: receiverSlptest, 
            inputUtxos: txnInputs
        });

        // broadcast to node1
        tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);

        while (slpdbTxnNotifications.filter(t => t.tx.h === tokenId).length === 0) {
            await sleep(100);
        }
    });

    step("BR-2: Produces ZMQ output at block", async () => {
        // clear ZMQ cache
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        lastBlockHash = invalidatedBlockHash = (await rpcNode1_miner.generate(1))[0];
        intendedBlockCount++;
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        while (slpdbBlockNotifications.filter(b => b.hash === lastBlockHash).length === 0) {
            await sleep(50);
        }
        let notification = slpdbBlockNotifications.filter(b => b.hash === lastBlockHash)[0];
        assert.strictEqual(notification.txns.length, 1);
        assert.strictEqual(notification.txns[0]!.txid, tokenId);
        assert.strictEqual(notification.txns[0]!.slp.detail!.tokenIdHex, tokenId);
        assert.strictEqual(notification.txns[0]!.slp.detail!.name, "unit-test-5a");
        assert.strictEqual(notification.txns[0]!.slp.detail!.symbol, "ut5a");
        // @ts-ignore
        assert.strictEqual(notification.txns[0]!.slp!.detail!.outputs![0].amount!, TOKEN_GENESIS_QTY.toFixed());
        
        // Check block hash with block zmq notification
        assert.strictEqual(typeof slpdbBlockNotifications[0]!.hash, "string");
        assert.strictEqual(slpdbBlockNotifications[0]!.hash.length, 64);
        originalBlockHashHex = slpdbBlockNotifications[0]!.hash;
        assert.strictEqual(lastBlockHash, originalBlockHashHex);
    });

    step("BR-2: Make sure the token exists in the tokens collection (after block)", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while (!t || t!.tokenStats!.block_created === null || typeof t!.tokenDetails.timestamp !== "string") { // || t!.tokenStats!.qty_token_burned.toString() !== "0" || typeof t!.tokenDetails.timestamp !== "string") {
            console.log(t!.tokenDetails.timestamp);
            await sleep(50);
            t = await db.tokenFetch(tokenId);
        }
        assert.strictEqual(typeof t!.tokenDetails.timestamp, "string");
        assert.strictEqual(t!.tokenDetails.timestamp_unix! > 0, true);
        assert.strictEqual(t!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(t!.mintBatonUtxo, tokenId + ":2");
        assert.strictEqual(t!.tokenStats!.block_created!, lastBlockIndex);
        assert.strictEqual(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("BR-2: Mine a longer chain on node 2 and broadcast txn into the mempool.", async () => {
        // let newBlockHash = (await rpcNode2_miner.generate(1))[0];
        // console.log(`[INFO] New block hash to be reorg'd: ${newBlockHash}`);

        // broadcast to node2
        await rpcNode2_miner.generate(1);
        // intendedBlockCount++;  we don't count this as one as it will replace block already counted w/ original genesis txn
        await rpcNode2_miner.generate(10);
        intendedBlockCount+=10;
        tokenId = await rpcNode2_miner.sendRawTransaction(genesisTxnHex, true);
        // genesis txn should be in the mempool on node 2, what about node 1?

        // make sure token genesis is in node #2 mempool
        let mempool = await rpcNode2_miner.getRawMemPool();
        while (mempool.length === 0) {
            await sleep(50);
            mempool = await rpcNode2_miner.getRawMemPool();
        }

        // confirm node 1 mempool is 0 length
        mempool = await rpcNode1_miner.getRawMemPool();
        while (mempool.length > 0) {
            await sleep(50);
            mempool = await rpcNode1_miner.getRawMemPool();
        }

        // invalidate node 1 last block
        try {
            console.log(`Invalidating: ${lastBlockHash} for height ${intendedBlockCount}`);
            await rpcNode1_miner.invalidateBlock(invalidatedBlockHash);
        } catch (_) { }

        // reconnect the 2 nodes
        try {
            await rpcNode1_miner.addNode("bitcoin2", "onetry");
        } catch(err) { }
        let peerInfo: any[] = await rpcNode1_miner.getPeerInfo();
        while (peerInfo.length < 1) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length, 1);

        // check both nodes are on the same block
        let node1Hash = await rpcNode1_miner.getbestblockhash();
        let node2Hash = await rpcNode2_miner.getbestblockhash();  
        while (node1Hash !== node2Hash) {
            await sleep(50);
            node1Hash = await rpcNode1_miner.getbestblockhash();
            node2Hash = await rpcNode2_miner.getbestblockhash();
        }
        assert.strictEqual(node1Hash, node2Hash);
        // lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        // intendedBlockCount++;

        // make sure token genesis is back in the node #1 mempool
        mempool = await rpcNode1_miner.getRawMemPool();
        while (mempool.length === 0) {
            await sleep(50);
            mempool = await rpcNode1_miner.getRawMemPool();
        }
    });

    step("BR-2: Check updated graph txn block hash (tokenId should be removed everywhere until it is added in a block)", async () => {

        // NOTE: We aren't able to keep the tokenId txn in the already seen unconfirmed transaction after the reorg, 
        //       the transaction will get added to all collections after it is mined.  This is not a major issue, as it
        //       is only a brief period during reorg where unconfirmed collection might be missing txns
        let t = await db.tokenFetch(tokenId);
        let g = await db.graphTxnFetch(tokenId);
        let c = await db.confirmedFetch(tokenId);
        let u = await db.unconfirmedFetch(tokenId);
        while (t || g || c || u) {
            await sleep(50);
            t = await db.tokenFetch(tokenId);
            g = await db.graphTxnFetch(tokenId);
            c = await db.confirmedFetch(tokenId);
            u = await db.unconfirmedFetch(tokenId);
        }

        // now we'll mine the tokenId transaction into a block
        let blockhash = (await rpcNode1_miner.generate(1))[0];

        t = await db.tokenFetch(tokenId);
        g = await db.graphTxnFetch(tokenId);
        c = await db.confirmedFetch(tokenId);
        //u = await db.unconfirmedFetch(tokenId);
        while (!t || !g || !c || !g.graphTxn._blockHash) { // || u) {
            await sleep(50);
            t = await db.tokenFetch(tokenId);
            g = await db.graphTxnFetch(tokenId);
            c = await db.confirmedFetch(tokenId);
            //u = await db.unconfirmedFetch(tokenId);
        }
        assert.strictEqual(t.tokenStats.approx_txns_since_genesis, 0);
        let height = await rpcNode1_miner.getBlockCount();
        assert.strictEqual(t.tokenStats.block_created, height);
        assert.strictEqual(g.graphTxn._blockHash!.toString("hex"), blockhash);
        assert.notEqual(c, null);
        //assert.strictEqual(u, null);
    });

    step("Clean up", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        sock.disconnect('tcp://0.0.0.0:27339');
    });
});
