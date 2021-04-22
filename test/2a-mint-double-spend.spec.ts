import * as assert from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult, SlpTransactionType } from 'slpjs';
import * as zmq from 'zeromq';
import { BITBOX } from 'bitbox-sdk';
import BigNumber from 'bignumber.js';
import { step } from 'mocha-steps';

import { Config } from "../config";
import { Db } from '../db';
import { TNATxn, TNATxnSlpDetails } from "../tna";
import { TokenBatonStatus, TokenUtxoStatus, BatonUtxoStatus } from "../interfaces";
import { GraphTxnDbo, TokenDBObject } from "../interfaces";

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
const connectionStringNode2_miner = `http://bitcoin:password@${process.env.RPC2_HOST}:${process.env.RPC2_PORT}`;  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
const rpcNode2_miner = new rpcClient(connectionStringNode2_miner, { maxRetries: 0 });

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
let mintTxid1: string;
let mintTxid2: string;

let lastBlockHash: string;
let lastBlockIndex: number;

describe("2a-Double-Spend-Mint", () => {

    step("Initial setup for all tests", async () => {

        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);

        // connect miner node to a full node that is connected to slpdb
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
            await rpcNode1_miner.generate(1);
            balance = await rpcNode1_miner.getBalance();
        }

        // put all the funds on the receiver's address
        receiverRegtest = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiverRegtest, 1, "", "", true);
        await rpcNode1_miner.generate(1);

        await sleep(500);
        let unspent: any[] = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract(unspent, validator);
        txnInputs = utxos.nonSlpUtxos;

        // create and broadcast SLP genesis transaction
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);
        let genesisTxnHex1 = txnHelpers.simpleTokenGenesis({
            tokenName: "unit-test-2a-a", 
            tokenTicker: "ut2a-a", 
            tokenAmount: new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS), 
            documentUri: null, 
            documentHash: null, 
            decimals: TOKEN_DECIMALS, 
            tokenReceiverAddress: receiverSlptest, 
            batonReceiverAddress: receiverSlptest, 
            bchChangeReceiverAddress: receiverSlptest, 
            inputUtxos: txnInputs
        });

        tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex1, true);
        await sleep(500);

        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;

        // check both nodes are on the same block
        let node1Hash = await rpcNode1_miner.getbestblockhash();
        let node2Hash = await rpcNode2_miner.getbestblockhash();
        while(node1Hash !== node2Hash) {
            let bb1 = await rpcNode1_miner.getBlockCount();
            let bb2 = await rpcNode2_miner.getBlockCount();
            if (bb1 > bb2) {
                await rpcNode1_miner.invalidateBlock(node1Hash);
            } else if (bb1 < bb2) {
                await rpcNode2_miner.invalidateBlock(node2Hash);
            } else {
                await rpcNode1_miner.invalidateBlock(node1Hash);
                await rpcNode2_miner.invalidateBlock(node2Hash);
            }
            //await rpcNode1_miner.generate(1);
            await sleep(50);
            node1Hash = await rpcNode1_miner.getbestblockhash();
            node2Hash = await rpcNode2_miner.getbestblockhash();
        }
        assert.strictEqual(node1Hash, node2Hash);

        // disconnect nodes now
        peerInfo = await rpcNode1_miner.getPeerInfo();
        await rpcNode1_miner.disconnectNode("bitcoin2");
        while (peerInfo.length > 0) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length === 0, true);
    });

    step("DS-M: Create two different Mint transactions", async () => {

        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract(unspent, validator);
        txnInputs = [ ...utxos.slpBatonUtxos[tokenId], ...utxos.nonSlpUtxos ];

        // create and broadcast SLP mint transaction
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);
        let mintTxnHex1 = txnHelpers.simpleTokenMint({
            tokenId,
            mintAmount: new BigNumber(TOKEN_GENESIS_QTY-1).times(10**TOKEN_DECIMALS), 
            tokenReceiverAddress: receiverSlptest, 
            batonReceiverAddress: receiverSlptest, 
            changeReceiverAddress: receiverSlptest, 
            inputUtxos: txnInputs
        });

        let mintTxnHex2 = txnHelpers.simpleTokenMint({
            tokenId,
            mintAmount: new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS), 
            tokenReceiverAddress: receiverSlptest, 
            batonReceiverAddress: receiverSlptest, 
            changeReceiverAddress: receiverSlptest, 
            inputUtxos: txnInputs
        });

        mintTxid1 = await rpcNode1_miner.sendRawTransaction(mintTxnHex1, true);
        mintTxid2 = await rpcNode2_miner.sendRawTransaction(mintTxnHex2, true);

        assert.strictEqual(mintTxid1.length === 64, true);
        assert.strictEqual(mintTxid2.length === 64, true);
        assert.strictEqual(mintTxid1 !== mintTxid2, true);
    });

    step("DS-M: Check SLPDB has pre-double spent transaction as unconfirmed", async () => {
        let txn = await db.unconfirmedFetch(mintTxid1);
        while (!txn || !txn!.slp) { // NOTE: This is a problem where the unconfirmed item is first saved without the slp property (but ZMQ should happen only after slp is added)
            await sleep(50);
            txn = await db.unconfirmedFetch(mintTxid1);
        }
        let unconfirmed = await db.db.collection("unconfirmed").find({}).toArray();
        assert.strictEqual(txn!.slp!.valid, true);
        // assert.strictEqual(txn!.slp!.detail!.name, "unit-test-2a");
        // assert.strictEqual(txn!.slp!.detail!.symbol, "ut2a");     
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, tokenId);
        assert.strictEqual(txn!.slp!.detail!.transactionType, SlpTransactionType.MINT);
        assert.strictEqual(unconfirmed.length, 1);
    });

    step("DS-M: Check SLPDB has pre-double spent transaction in graphs", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": mintTxid1 });
        while(!g || !g.graphTxn) {
            await sleep(50);
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": mintTxid1 });
        }
        assert.strictEqual(g!.graphTxn.txid, mintTxid1);
        //assert.strictEqual(g!.tokenDetails.tokenIdHex, mintTxid1);
        assert.strictEqual(g!.graphTxn._blockHash, null);

        // Check unspent outputs.
        assert.strictEqual(g!.graphTxn.outputs[0].status, TokenUtxoStatus.UNSPENT);
        assert.strictEqual(g!.graphTxn.outputs[1].status, BatonUtxoStatus.BATON_UNSPENT);
    });

    step("DS-M: Check SLPDB has pre-double spent transaction in tokens", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while (!t) {
            await sleep(50);
            t = await db.tokenFetch(tokenId);
        }
        assert.strictEqual(t!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(t!.mintBatonUtxo, mintTxid1 + ":2");
        assert.strictEqual(t!.tokenStats!.block_created, lastBlockIndex);
        assert.strictEqual(t!.tokenStats.approx_txns_since_genesis, 1);
        // assert.strictEqual(t!.tokenStats!.block_last_active_mint, null);
        // assert.strictEqual(t!.tokenStats!.block_last_active_send, null);
        // assert.strictEqual(t!.tokenStats!.qty_token_burned.toString(), "0");
        // assert.strictEqual(t!.tokenStats!.qty_token_circulating_supply.toString(), TOKEN_GENESIS_QTY.toFixed());
        // assert.strictEqual(t!.tokenStats!.qty_token_minted.toString(), TOKEN_GENESIS_QTY.toFixed());
        assert.strictEqual(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-M: Generate block on node 2 and reconnect the two nodes", async () => {
        // clear ZMQ cache
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        // use 2nd (non-SLPDB connected node) to generate a block, reconnect to cause double spend
        lastBlockHash = (await rpcNode2_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode2_miner.getBlock(lastBlockHash, true)).height;

        // connect miner node to a full node that is connected to slpdb
        try {
            await rpcNode1_miner.addNode("bitcoin2", "onetry");
        } catch(err) { }

        // reconnect nodes
        let peerInfo: any[] = await rpcNode1_miner.getPeerInfo();
        while(peerInfo.length < 1) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length, 1);

        let lastBlockHash2 = await rpcNode1_miner.getbestblockhash();
        while(lastBlockHash !== lastBlockHash2) {
            await sleep(50);
            lastBlockHash2 = await rpcNode1_miner.getbestblockhash();
        }
        assert.strictEqual(lastBlockHash, lastBlockHash2);
    });

    step("DS-M: produces ZMQ output for the transaction", async () => {
        // give slpdb time to process
        while (slpdbTxnNotifications.filter(txn => txn.tx.h === mintTxid2).length === 0) {
            await sleep(50);
        }

        let txn = slpdbTxnNotifications.filter(txn => txn.tx.h === mintTxid2)[0];
        // check that SLPDB made proper outgoing ZMQ messages for 
        assert.strictEqual(slpdbTxnNotifications.length > 0, true);
        assert.strictEqual(txn.slp!.valid, true);
        // assert.strictEqual(txn.slp!.detail!.name, "unit-test-2b");
        // assert.strictEqual(txn.slp!.detail!.symbol, "ut2b");
        // assert.strictEqual(txn.slp!.detail!.tokenIdHex, mintTxid2);
        assert.strictEqual(txn.slp!.detail!.outputs![0].address, receiverSlptest);
        assert.strictEqual(txn.slp!.detail!.transactionType, SlpTransactionType.MINT);
        // @ts-ignore
        assert.strictEqual(txn.slp!.detail!.outputs![0].amount!, TOKEN_GENESIS_QTY.toFixed());
        //assert.strictEqual(txn.blk!.h, lastBlockHash);
        //assert.strictEqual(txn.blk!.i, lastBlockIndex);
        assert.strictEqual(typeof txn.in, "object");
        assert.strictEqual(typeof txn.out, "object");
        assert.strictEqual(typeof txn.tx, "object");
    });

    step("DS-M: produces ZMQ output for the block", async () => {
        while(slpdbBlockNotifications.length === 0) {
            await sleep(50);
        }
        assert.strictEqual(slpdbBlockNotifications.length, 1);
        assert.strictEqual(slpdbBlockNotifications[0].txns.length, 1);
        assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.txid, mintTxid2);
        assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.slp.detail!.tokenIdHex, tokenId);
        // assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.slp.detail!.name, "unit-test-2b");
        // assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.slp.detail!.symbol, "ut2b");
        // @ts-ignore
        assert.strictEqual(slpdbBlockNotifications[0]!.txns[0]!.slp!.detail!.outputs![0].amount!, TOKEN_GENESIS_QTY.toFixed());
        
        // Check block hash with block zmq notification
        assert.strictEqual(typeof slpdbBlockNotifications[0]!.hash, "string");
        assert.strictEqual(slpdbBlockNotifications[0]!.hash.length, 64);
    });

    step("DS-M: store double spend mint2 in confirmed", async () => {
        let txn = await db.confirmedFetch(mintTxid2);
        while (!txn || !txn!.slp) { // NOTE: This is a problem where the unconfirmed item is first saved without the slp property (but ZMQ should happen only after slp is added)
            await sleep(50);
            txn = await db.confirmedFetch(mintTxid2);
        }
        let confirmed = await db.db.collection("confirmed").find({ "tx.h": mintTxid2 }).toArray();
        assert.strictEqual(txn!.slp!.valid, true);
        // assert.strictEqual(txn!.slp!.detail!.name, "unit-test-2b");
        // assert.strictEqual(txn!.slp!.detail!.symbol, "ut2b");     
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, tokenId);
        assert.strictEqual(confirmed.length, 1);

        // make sure it is not in unconfirmed
        let txn_u = await db.unconfirmedFetch(mintTxid2);
        assert.strictEqual(txn_u, null);
    });

    step("DS-M: stores double spend mint2 in tokens", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while (!t) {
            await sleep(50);
            t = await db.tokenFetch(tokenId);
        }
        assert.strictEqual(t!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(t!.mintBatonUtxo, mintTxid2 + ":2");
        assert.strictEqual(t!.tokenStats!.block_created, lastBlockIndex-1);
        // assert.strictEqual(t!.tokenStats!.block_last_active_mint, null);
        // assert.strictEqual(t!.tokenStats!.block_last_active_send, null);
        // assert.strictEqual(t!.tokenStats!.qty_token_burned.toString(), "0");
        // assert.strictEqual(t!.tokenStats!.qty_token_circulating_supply.toString(), TOKEN_GENESIS_QTY.toFixed());
        // assert.strictEqual(t!.tokenStats!.qty_token_minted.toString(), TOKEN_GENESIS_QTY.toFixed());
        assert.strictEqual(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-M: stores double spend mint2 in graphs", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": mintTxid2 });
        while(!g || !g.graphTxn) {
            await sleep(50);
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": mintTxid2 });
        }
        assert.strictEqual(g!.graphTxn.txid, mintTxid2);
        assert.strictEqual(g!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(g!.graphTxn._blockHash!.toString("hex"), lastBlockHash);

        // Check unspent outputs.
        assert.strictEqual(g!.graphTxn.outputs[0].status, TokenUtxoStatus.UNSPENT);
        assert.strictEqual(g!.graphTxn.outputs[1].status, BatonUtxoStatus.BATON_UNSPENT);
    });

    step("DS-S: Verify mint1 is deleted from confirmed/unconfirmed/graphs", async () => {
        let unconf = await db.unconfirmedFetch(mintTxid1);
        assert.strictEqual(unconf, null);
        let conf = await db.confirmedFetch(mintTxid1);
        assert.strictEqual(conf, null);
        let graphTxn = await db.graphTxnFetch(mintTxid1);
        assert.strictEqual(graphTxn, null);
        // let token = await db.tokenFetch(tokenId);
        // assert.strictEqual(token, null);
    });

    step("Cleanup after tests", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        sock.disconnect('tcp://0.0.0.0:27339');
    });
});
