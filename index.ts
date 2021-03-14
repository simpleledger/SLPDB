import * as dotenv from 'dotenv';
dotenv.config()

import { Bit } from './bit';
import { Db } from './db';
import { RpcClient } from './rpc';
import { Config } from './config';
import { SlpdbStatus } from './status';
import { Info, ChainSyncCheckpoint } from './info';
import { SlpGraphManager } from './slpgraphmanager';
import { TokenFilters } from './filters';
import { BlockchainInfoResult } from 'bitcoin-com-rest';
import { Query } from './query';
import { PruneStack } from './prunestack';

new RpcClient({ useGrpc: Boolean(Config.grpc.url) });

// init promise based resources
const sp = require("synchronized-promise");
let getBlockchainInfoSync: () => BlockchainInfoResult = sp(RpcClient.getBlockchainInfo,{timeouts:Config.rpc.rpcTimeoutMs});
let setNetworkSync: (network: string) => void = sp(Info.setNetwork);
let queryInitSync: () => void = sp(Query.init);
let chain = getBlockchainInfoSync().chain;
let network = chain === 'test' || chain  === 'regtest' ? 'testnet' : 'mainnet';
setNetworkSync(network);
queryInitSync();

let db = new Db({ 
    dbName: network === 'mainnet' ? Config.db.name : Config.db.name_testnet, 
    dbUrl: Config.db.url, 
    config: Config.db 
});
let bit = new Bit(db);
new SlpdbStatus(db, process.argv);

let tokenManager: SlpGraphManager;

const daemon = {
    run: async ({ startHeight }: { startHeight?: number } ) => {
        // persist updated SLPDB status every 10 minutes
        await SlpdbStatus.loadPreviousAttributes();
        setInterval(async function() {
            await SlpdbStatus.saveStatus();
        }, 60000);

        await bit.init();

        // test RPC connection
        console.log("[INFO] Testing RPC connection...");
        await RpcClient.getBlockCount();
        console.log("[INFO] RPC is initialized.");

        // set start height override
        if (startHeight) {
            console.log("[WARN] Using the '--startHeight' option may result in missing data if the token schema is changed. Only use it on a one-off basis, if you know what you're doing.");
            await Info.updateBlockCheckpoint(startHeight, null);
        }

        await SlpdbStatus.saveStatus();

        // check for confirmed collection schema update
        let schema = await Info.getConfirmedCollectionSchema();
        if (!schema || schema !== Config.db.confirmed_schema_version) {
            await Info.setConfirmedCollectionSchema(Config.db.confirmed_schema_version);
            await Info.checkpointReset();
            console.log("[INFO] Schema version for the confirmed collection was updated. Reseting block checkpoint reset to", (await Info.getBlockCheckpoint()).height)
        }

        let lastSynchronized = <ChainSyncCheckpoint>await Info.getBlockCheckpoint((await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet);
        console.log("reprocessFrom: ", lastSynchronized.height);

        console.time('[PERF] Indexing Keys');
        let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
        if (lastSynchronized.height === from) {
            console.log('[INFO] Indexing MongoDB With Configured Keys...', new Date());
            await db.confirmedIndex();
        }
        console.timeEnd('[PERF] Indexing Keys');

        console.log('[INFO] Starting to processing SLP Data.', new Date());
        let currentHeight = await RpcClient.getBlockCount();
        tokenManager = new SlpGraphManager(db, currentHeight, network, bit);
        bit._slpGraphManager = tokenManager;
        PruneStack(tokenManager._tokens);  // call instantiates singleton

        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await SlpdbStatus.changeStateToStartupBlockSync({ 
            network, 
            getSyncdCheckpoint: async () => await Info.getBlockCheckpoint(),
            getSlpTokensCount: () => { return tokenManager._tokens.size; }
        });

        // load token validation caches
        console.log("Init all tokens");
        try {
            await tokenManager.initAllTokenGraphs();
        } catch (err) {
            if (err.message === "DB schema does not match the current version.") {
                await db.drop();
                await Info.checkpointReset();
                throw Error("DB schema does not match the current version, so MongoDb and LevelDb have been reset, please resart SLPDB.")
            } else {
                throw err;
            }
        }
        console.log("Init all tokens Complete");

        // sync with full node's block height
        await bit.processBlocksForSLP();
        if (bit._exit) {
            return;
        }

        // sync with mempool and listen for wire notifications
        await db.unconfirmedReset();
        await bit.processCurrentMempoolForSLP();
        bit.listenToZmq();
        console.timeEnd('[PERF] Initial Block Sync');
        await bit.removeExtraneousMempoolTxns();

        tokenManager._updatesQueue.start();
        await SlpdbStatus.changeStateToRunning({
            getSlpMempoolSize: () => tokenManager._bit.slpMempool.size
        });
    }
}

const util = {
    reset_to_block: async (block_height: number) => {  //592340
        let network = (await RpcClient.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet';
        await Info.setNetwork(network);
        await Info.updateBlockCheckpoint(block_height, null);
        console.log("[INFO] Reset block done.");
        process.exit(1);
    }
}

const start = async () => {
    let args = process.argv;
    if (args.length > 2) {
        if(args[2] === "run") {
            let options: any = {};
            if(args.includes("--startHeight")) {
                let index = args.indexOf("--startHeight");
                console.log("[INFO] Resync from startHeight:", index);
                options.startHeight = parseInt(args[index+1]);
            }
            await daemon.run(options);
        }
        else if(args[2] === "tip") {
            await util.reset_to_block(parseInt(process.argv[3]));
        }
    } else {
        throw Error("No command provided after 'node ./index.js'.");
    }
}

// @ts-ignore
process.on('uncaughtException', async (err: any, origin: any) => {
    console.log("[ERROR] uncaughtException", err);
    var message;
    if(err.stack)
        message = `[${(new Date()).toUTCString()}] ${err.stack}`;
    else if(err.message)
        message = `[${(new Date()).toUTCString()}] ${err.message}`;
    else if(typeof message === 'string')
        message = `[${(new Date()).toUTCString()}] ${err}`;
    else if(typeof message === 'object')
        message = `[${(new Date()).toUTCString()}] ${JSON.stringify(err)}`;
    else
        message = `[${(new Date()).toUTCString()}] SLPDB exited for an unknown reason.`
    try {
        await SlpdbStatus.logExitReason(message);
        console.log(err);
        console.log('[INFO] Shutting down SLPDB...', new Date().toString());
        await db.exit();
    } catch(error) {
        console.log("[ERROR] Could not log to DB:", error);
    } finally { 
        process.exit(0);
    }
});

process.on('unhandledRejection', async (err: any, promise: any) => {
    console.log("[ERROR] unhandledRejection", err);
    var message;
    if(err.stack)
        message = `[${(new Date()).toUTCString()}] ${err.stack}`;
    else if(err.message)
        message = `[${(new Date()).toUTCString()}] ${err.message}`;
    else if(typeof message === 'string')
        message = `[${(new Date()).toUTCString()}] ${err}`;
    else if(typeof message === 'object')
        message = `[${(new Date()).toUTCString()}] ${JSON.stringify(err)}`;
    else
        message = `[${(new Date()).toUTCString()}] SLPDB exited for an unknown reason.`
    try {
        await SlpdbStatus.logExitReason(message);
        console.log(err);
        console.log('[INFO] Shutting down SLPDB...', new Date().toString());
        await db.exit();
    } catch(error) {
        console.log("[ERROR] Could not log to DB:", error);
    } finally {
        process.exit(0);
    }
});

process.on('SIGINT', async () => {
    await shutdown('SIGINT');
});

process.on('SIGTERM', async () => {
    await shutdown('SIGTERM');
});

process.on('SIGQUIT', async () => {
    await shutdown('SIGQUIT');
});

let shutdown = async (signal: string) => {
    console.log(`[INFO] Got ${signal}. Graceful shutdown start ${new Date().toISOString()}`);

    try {
        bit._zmqItemQueue.pause();
        console.log('[INFO] ZMQ processing stopped.');
    } catch (_) {}

    try {
        await bit.stop();
        console.log('[INFO] Block sync processing stopped.');
    } catch(_) {}

    try {
        console.log('[INFO] Stopping Token graph processing.');

        await tokenManager.stop();
        for (let [tokenId, token] of tokenManager._tokens) {
            await token.stop()
        }
        console.log('[INFO] Token graph processing stopped.');
    } catch (_) {}

    try {
        await SlpdbStatus.logExitReason(signal);
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        await sleep(2000);
        console.log('[INFO] Final telemetry update complete.');
    } catch(_) {}

    try {
        await db.exit();
        console.log('[INFO] Closed mongo DB connection.');
    } catch (_) {}

    console.log(`[INFO] Graceful shutdown completed ${new Date().toISOString()}`);
    process.exit();
}

start();
