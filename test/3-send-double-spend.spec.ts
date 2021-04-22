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
        //console.log(slpdbBlockNotifications);
    }
});

// connect to the regtest mongoDB
let db = new Db({ dbUrl: `mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`, dbName: "slpdb_test", config: Config.db });

// produced and shared between tests.
let receiverRegtest: string;
let receiverSlptest: string; // this is same address as receiverRegtest, converted to slptest format
let txnInputs: SlpAddressUtxoResult[];
let tokenId: string;
let txid1: string;
let txid2: string;

let lastBlockHash: string;
let lastBlockIndex: number;

describe("3-Double-Spend-Send", () => {

    step("Initial setup for all tests", async () => {

        // generate block to clear the mempool (may be dirty from previous tests)
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];

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
            lastBlockHash = (await rpcNode1_miner.generate(1))[0];
            balance = await rpcNode1_miner.getBalance();
        }

        // put all the funds on the receiver's address
        receiverRegtest = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiverRegtest, 1, "", "", true);
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];

        // check both nodes are on the same block
        let node1Hash = await rpcNode1_miner.getbestblockhash();
        let node2Hash = await rpcNode2_miner.getbestblockhash();

        while(node1Hash !== node2Hash) {
            await sleep(50);
            node1Hash = await rpcNode1_miner.getbestblockhash();
            node2Hash = await rpcNode2_miner.getbestblockhash();
        }
        assert.strictEqual(node1Hash, node2Hash);

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
        let genesisTxnHex = txnHelpers.simpleTokenGenesis({
            tokenName: "unit-test-3", 
            tokenTicker: "ut3", 
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
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        let lastBlockHash2 = await rpcNode2_miner.getbestblockhash();
        assert.strictEqual(lastBlockHash, lastBlockHash2);

        // disconnect nodes now
        peerInfo = await rpcNode1_miner.getPeerInfo();
        await rpcNode1_miner.disconnectNode("bitcoin2");
        while(peerInfo.length > 0) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length === 0, true);
    });

    step("DS-S: Check the new token has been added", async () => {  // NOTE: This takes longer than normal since we're not waiting for ZMQ msg
        let txn = await db.confirmedFetch(tokenId);
        let txn_u = await db.unconfirmedFetch(tokenId);
        while (!txn || !txn!.slp || !txn.slp.valid || txn_u) {
            await sleep(50);
            txn = await db.confirmedFetch(tokenId);
            txn_u = await db.unconfirmedFetch(tokenId);
        }
        let confirmed = await db.db.collection("confirmed").find({ "tx.h": tokenId }).toArray();
        assert.strictEqual(txn!.slp!.valid, true);
        assert.strictEqual(txn!.slp!.detail!.name, "unit-test-3");
        assert.strictEqual(txn!.slp!.detail!.symbol, "ut3");     
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, txn!.tx.h);
        assert.strictEqual(confirmed.length, 1);
        assert.strictEqual(txn_u, null);
    });

    step("DS-S: Process transaction inputs", async () => {
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

    step("DS-S: Create two different send transactions", async () => {
        // create and broadcast SLP genesis transaction
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);

        let sendTxnHex1 = txnHelpers.simpleTokenSend({
            tokenId, 
            sendAmounts: new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS),
            inputUtxos: txnInputs, 
            tokenReceiverAddresses: receiverSlptest, 
            changeReceiverAddress: receiverSlptest
        });

        let sendTxnHex2 = txnHelpers.simpleTokenSend({
            tokenId, 
            sendAmounts: new BigNumber(TOKEN_GENESIS_QTY-1).times(10**TOKEN_DECIMALS),
            inputUtxos: txnInputs, 
            tokenReceiverAddresses: receiverSlptest, 
            changeReceiverAddress: receiverSlptest
        });
    
        txid1 = await rpcNode1_miner.sendRawTransaction(sendTxnHex1, true);
        console.log(`txid1: ${txid1}`);
        txid2 = await rpcNode2_miner.sendRawTransaction(sendTxnHex2, true);
        console.log(`txid2: ${txid2}`);

        assert.strictEqual(txid1.length === 64, true);
        assert.strictEqual(txid2.length === 64, true);
        assert.strictEqual(txid1 !== txid2, true);
    });

    step("DS-S: Check SLPDB has pre-double spent transaction as unconfirmed", async () => {
        //let txn = await db.unconfirmedFetch(txid1);
        let unconfirmed = await db.db.collection("unconfirmed").find({}).toArray();
        let txn = unconfirmed.find(i => i.tx.h === txid1);
        while (!txn) { // || unconfirmed.length !== 1) {
            //console.log(unconfirmed.length);
            await sleep(50);
            unconfirmed = await db.db.collection("unconfirmed").find({}).toArray();
            txn = unconfirmed.find(i => i.tx.h === txid1);
        }
        assert.strictEqual(txn!.slp!.valid, true);
        assert.strictEqual(txn!.slp!.detail!.name, "unit-test-3");
        assert.strictEqual(txn!.slp!.detail!.symbol, "ut3");     
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, tokenId);
    });

    step("DS-S: Check SLPDB has pre-double spent transaction in graphs", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid1 });
        while (!g || !g.graphTxn) {
            await sleep(50);
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid1 });
        }
        assert.strictEqual(g!.graphTxn.txid, txid1);
        assert.strictEqual(g!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(g!.graphTxn._blockHash, null);

        // Check unspent outputs.
        assert.strictEqual(g!.graphTxn.outputs[0].status, TokenUtxoStatus.UNSPENT);

        // Check genesis outputs updated
        let genesis: GraphTxnDbo | null = await db.db.collection("graphs").findOne({"graphTxn.txid": tokenId});
        assert.strictEqual(genesis!.graphTxn.outputs[0].status, TokenUtxoStatus.SPENT_SAME_TOKEN);
        assert.strictEqual(genesis!.graphTxn.outputs[0].spendTxid, txid1);
        assert.strictEqual(genesis!.graphTxn.outputs[0].invalidReason, null);
        assert.strictEqual(genesis!.graphTxn.outputs[1].status, BatonUtxoStatus.BATON_UNSPENT);
    });

    step("DS-S: Check SLPDB has pre-double spent transaction in tokens", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        assert.strictEqual(t!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(t!.mintBatonUtxo, tokenId + ":2");
        assert.strictEqual(t!.tokenStats!.block_created, lastBlockIndex);
        assert.strictEqual(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-S: Generate block on node 2 and reconnect the two nodes", async () => {
        // clear ZMQ cache
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        let peerInfo: any[] = await rpcNode1_miner.getPeerInfo();
        while(peerInfo.length > 0) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length === 0, true);

        // use 2nd (non-SLPDB connected node) to generate a block, reconnect to cause double spend
        lastBlockHash = (await rpcNode2_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode2_miner.getBlock(lastBlockHash, true)).height;

        // connect miner node to a full node that is connected to slpdb
        try {
            await rpcNode1_miner.addNode("bitcoin2", "onetry");
        } catch(err) { }

        // reconnect nodes
        peerInfo = await rpcNode1_miner.getPeerInfo();
        while(peerInfo.length < 1) {
            await sleep(100);
            peerInfo = await rpcNode1_miner.getPeerInfo();
        }
        assert.strictEqual(peerInfo.length, 1);
    });

    step("DS-S: produces ZMQ output for the double-spend transaction", async () => {
        // give slpdb time to process
        let txn: TNATxn|undefined = slpdbTxnNotifications.find(t => t.tx.h === txid2);
        while (!txn) {
            await sleep(50);
            txn = slpdbTxnNotifications.find(t => t.tx.h === txid2);
        }
        // check that SLPDB made proper outgoing ZMQ messages for 
        //assert.strictEqual(slpdbTxnNotifications.length, 1);
        assert.strictEqual(txn!.slp!.valid, true);
        assert.strictEqual(txn!.slp!.detail!.name, "unit-test-3");
        assert.strictEqual(txn!.slp!.detail!.symbol, "ut3");
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, tokenId);
        assert.strictEqual(txn!.slp!.detail!.outputs![0].address, receiverSlptest);
        assert.strictEqual(txn!.slp!.detail!.transactionType, SlpTransactionType.SEND);
        // @ts-ignore
        assert.strictEqual(txn!.slp!.detail!.outputs![0].amount!, (TOKEN_GENESIS_QTY-1).toFixed());
        // @ts-ignore
        assert.strictEqual(txn!.slp!.detail!.outputs![1].amount!, (1).toFixed());
        //assert.strictEqual(slpdbTxnNotifications[0]!.blk!.h, lastBlockHash);
        //assert.strictEqual(slpdbTxnNotifications[0]!.blk!.i, lastBlockIndex);
        assert.strictEqual(typeof txn!.in, "object");
        assert.strictEqual(typeof txn!.out, "object");
        assert.strictEqual(typeof txn!.tx, "object");
        assert.strictEqual(txn!.tx!.h, txid2);
    });

    step("DS-S: stores double spend txid2 in tokens (immediately after txn ZMQ)", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while(!t) { // || t!.tokenStats!.block_last_active_send === null) { // || t!.tokenStats!.qty_token_burned.toString() !== "0") {
            t = await db.tokenFetch(tokenId);
            await sleep(50);
        }
        assert.strictEqual(t!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(t!.mintBatonUtxo, tokenId + ":2");
        assert.strictEqual(t!.tokenStats!.block_created, lastBlockIndex-1);
        assert.strictEqual(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-S: produces ZMQ output for the block", async () => {
        while(slpdbBlockNotifications.length === 0) {
            await sleep(50);
        }
        assert.strictEqual(slpdbBlockNotifications.length, 1);
        assert.strictEqual(slpdbBlockNotifications[0].txns.length, 1);
        assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.txid, txid2);
        assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.slp.detail!.tokenIdHex, tokenId);
        assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.slp.detail!.name, "unit-test-3");
        assert.strictEqual(slpdbBlockNotifications[0].txns[0]!.slp.detail!.symbol, "ut3");
        // @ts-ignore
        assert.strictEqual(slpdbBlockNotifications[0]!.txns[0]!.slp!.detail!.outputs![0].amount!, (TOKEN_GENESIS_QTY-1).toFixed());
        // @ts-ignore
        assert.strictEqual(slpdbBlockNotifications[0]!.txns[0]!.slp!.detail!.outputs![1].amount!, (1).toFixed());
        // Check block hash with block zmq notification
        assert.strictEqual(typeof slpdbBlockNotifications[0]!.hash, "string");
        assert.strictEqual(slpdbBlockNotifications[0]!.hash.length, 64);
    });

    step("DS-S: store double spend txid2 in confirmed", async () => {
        let txn = await db.confirmedFetch(txid2);
        while (!txn) {
            await sleep(50);
            txn = await db.confirmedFetch(txid2);
        }
        let confirmed = await db.db.collection("confirmed").find({ "tx.h": txid2 }).toArray();
        assert.strictEqual(txn!.slp!.valid, true);
        assert.strictEqual(txn!.slp!.detail!.name, "unit-test-3");
        assert.strictEqual(txn!.slp!.detail!.symbol, "ut3");    
        assert.strictEqual(txn!.tx.h, txid2); 
        assert.strictEqual(txn!.slp!.detail!.tokenIdHex, tokenId);
        assert.strictEqual(confirmed.length, 1);

        // make sure it is not in unconfirmed
        let txn_u = await db.unconfirmedFetch(txid2);
        assert.strictEqual(txn_u, null);
    });

    step("DS-S: stores double spend txid2 in tokens", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        assert.strictEqual(t!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(t!.mintBatonUtxo, tokenId + ":2");
        assert.strictEqual(t!.tokenStats!.block_created, lastBlockIndex-1);
        assert.strictEqual(t!.mintBatonStatus, TokenBatonStatus.ALIVE);
    });

    step("DS-S: stores double spend token2 in graphs", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid2 });
        while(!g || !g.graphTxn) {
            await sleep(50);
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": txid2 });
        }
        assert.strictEqual(g!.graphTxn.txid, txid2);
        assert.strictEqual(g!.tokenDetails.tokenIdHex, tokenId);
        assert.strictEqual(g!.graphTxn._blockHash!.toString("hex"), lastBlockHash);

        // Check unspent outputs.
        assert.strictEqual(g!.graphTxn.outputs[0].status, TokenUtxoStatus.UNSPENT);

        // Check genesis outputs updated
        let genesis: GraphTxnDbo | null = await db.db.collection("graphs").findOne({"graphTxn.txid": tokenId});
        assert.strictEqual(genesis!.graphTxn.outputs[0].status, TokenUtxoStatus.SPENT_SAME_TOKEN);
        assert.strictEqual(genesis!.graphTxn.outputs[0].spendTxid, txid2);
        assert.strictEqual(genesis!.graphTxn.outputs[0].invalidReason, null);
        assert.strictEqual(genesis!.graphTxn.outputs[1].status, BatonUtxoStatus.BATON_UNSPENT);
    });

    step("DS-S: Verify txid1 is deleted from confirmed/unconfirmed/graphs", async () => {
        let unconf = await db.unconfirmedFetch(txid1);
        assert.strictEqual(unconf, null);
        let conf = await db.confirmedFetch(txid1);
        assert.strictEqual(conf, null);
        let graphTxn = await db.graphTxnFetch(txid1);
        assert.strictEqual(graphTxn, null);
    });

    step("DS-S: Verify txid2 input txn have outputs pointing to txid2, not txid1", async () => {
        let g = await db.graphTxnFetch(txid2);
        let g0 = await db.graphTxnFetch(g!.graphTxn.inputs[0]!.txid);
        assert.strictEqual(g0!.graphTxn.outputs[0].spendTxid, txid2);
    });

    step("Cleanup after tests", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        sock.disconnect('tcp://0.0.0.0:27339');
    });
});
