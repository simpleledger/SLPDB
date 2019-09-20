import * as dotenv from 'dotenv';
dotenv.config()

import { Bit } from './bit';
import { Db } from './db';
import { RpcClient } from './rpc';
import { Config } from './config';
import { SlpdbStatus } from './status';
import { Info, ChainSyncCheckpoint } from './info';
import { SlpGraphManager } from './slpgraphmanager';
import { TokenFilterRule, TokenFilter } from './filters';

const db = new Db();
const rpc = new RpcClient({useGrpc: Boolean(Config.grpc.url) });
const bit = new Bit(db, rpc);
new SlpdbStatus(db, rpc);

const daemon = {
    run: async function({ startHeight, loadFromDb=true }: { startHeight?: number, loadFromDb?: boolean} ) {
        let network!: string;
        try {        
            network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet';
            await Info.setNetwork(network);
            await db.init();
        } catch(err) {
            console.log(err);
            process.exit();
        }

        // persist updated SLPDB status every 10 minutes
        await SlpdbStatus.loadPreviousAttributes();
        setInterval(async function() {
            await SlpdbStatus.saveStatus();
        }, 60000);

        await bit.init();

        // test RPC connection
        console.log("[INFO] Testing RPC connection...");
        await rpc.getBlockCount();
        console.log("[INFO] RPC is initialized.");

        // set start height override
        if(startHeight)
            await Info.updateBlockCheckpoint(startHeight, null);
        
        await SlpdbStatus.saveStatus();

        // try to load tokens filter yaml
        let filter = TokenFilter.loadFromFile();

        // check for confirmed collection schema update
        let schema = await Info.getConfirmedCollectionSchema();
        if(!schema || schema !== Config.db.confirmed_schema_version) {
            await Info.setConfirmedCollectionSchema(Config.db.confirmed_schema_version);
            await Info.checkpointReset();
            console.log("[INFO] Schema version for the confirmed collection was updated. Reseting block checkpoint reset to", (await Info.getBlockCheckpoint()).height)
        }

        const lastSynchronized = <ChainSyncCheckpoint>await Info.getBlockCheckpoint((await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet);
        let reprocessFrom = lastSynchronized.height;
        if(lastSynchronized.height > await bit.requestheight()) {
            throw Error("Config.core.from or Config.core.from_testnet cannot be larger than the current blockchain height (check the config.ts file)");
        }

        console.time('[PERF] Indexing Keys');
        let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
        if (lastSynchronized.height === from) {
            console.log('[INFO] Indexing MongoDB With Configured Keys...', new Date());
            await db.confirmedIndex();
        }
        console.timeEnd('[PERF] Indexing Keys');

        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await SlpdbStatus.changeStateToStartupBlockSync({ 
            network, getSyncdCheckpoint: async () => await Info.getBlockCheckpoint()
        });
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());

        console.log('[INFO] Starting to processing SLP Data.', new Date());
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network, bit, filter);
        bit._slpGraphManager = tokenManager;
        bit.listenToZmq();
        await bit.checkForMissingMempoolTxns(undefined, true);

        let onComplete = async () => {
            await tokenManager._startupQueue.onIdle();
            console.log("[INFO] Starting to process graph based on recent mempool and block activity");
            tokenManager._updatesQueue.start();
            await tokenManager._updatesQueue.onIdle();
            console.log("[INFO] Updates from recent mempool and block activity complete");
            await tokenManager.fixMissingTokenTimestamps();
            await tokenManager._bit.handleConfirmedTxnsMissingSlpMetadata();
            await SlpdbStatus.changeStateToRunning({
                getSlpMempoolSize: () => tokenManager._bit.slpMempool.size
            });
            console.log("[INFO] initAllTokens complete");
        }

        await tokenManager.initAllTokens({ reprocessFrom, onComplete, loadFromDb: loadFromDb });

        // // look for burned token transactions every hour after startup
        // setInterval(async function() {
        //     if(tokenManager._startupQueue.size === 0 && tokenManager._startupQueue.pending === 0) {
        //         await tokenManager.searchForNonSlpBurnTransactions();
        //     }
        // }, 3600000);
    }
}

const util = {
    reprocess_token: async function(tokenId: string) {
        let network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet'
        await Info.setNetwork(network);
        await db.init();
        await bit.init();
        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());
        let filter = new TokenFilter();
        filter.addRule(new TokenFilterRule({ name: "unknown", info: tokenId, type: 'include-single'}));
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network, bit, filter);
        bit._slpGraphManager = tokenManager;
        bit.listenToZmq();
        await tokenManager.initAllTokens({ reprocessFrom: 0, loadFromDb: false });
        await tokenManager._startupQueue.onIdle();
        console.log("[INFO] Reprocess done.");
        process.exit(1);
    },
    reset_to_block: async function(block_height: number) {  //592340
        let includeTokenIds = [
            "8aab2185354926d72c6a8f6bf7e403daaf1469c02e00a5ad5981b84ea776d980",
        ]
        let filter = new TokenFilter();
        includeTokenIds.forEach(i => {
            filter.addRule(new TokenFilterRule({ name: "unknown", info: i, type: 'include-single'}));
        });
        let network = (await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet';
        await Info.setNetwork(network);
        await db.init();
        let currentHeight = await rpc.getBlockCount();
        let tokenManager = new SlpGraphManager(db, currentHeight, network, bit, filter);
        await tokenManager.initAllTokens({ reprocessFrom: 0, reprocessTo: block_height });
        await tokenManager._startupQueue.onIdle();
        let blockhash = await rpc.getBlockHash(block_height+1);
        await tokenManager.onBlockHash(blockhash);
        await Info.updateBlockCheckpoint(block_height, null);
        console.log("[INFO] Reset block done.")
        process.exit(1);
    }
}

const start = async function() {
    let args = process.argv;
    if (args.length > 2) {
        if(args[2] === "run") {
            let options: any = {};
            if(args.includes("--reprocess")) {
                console.log("[INFO] Reprocessing all tokens.");
                options.loadFromDb = false;
            }
            if(args.includes("--startHeight")) {
                let index = args.indexOf("--startHeight");
                console.log("[INFO] Resync from startHeight:", index);
                options.startHeight = parseInt(args[index+1]);
            }
            await daemon.run(options);
        }
        else if(args[2] === "reprocess")
            await util.reprocess_token(process.argv[3]);
        else if(args[2] === "goToBlock")
            await util.reset_to_block(parseInt(process.argv[3]));
    } else {
        await daemon.run({});
    }
}

// @ts-ignore
process.on('uncaughtException', async (err: any, origin: any) => {
    console.log("[ERROR] uncaughtException", err);
    var message = err;
    try {
        message = `[${(new Date()).toUTCString()}] ${err.stack}`;
    } catch(_) {}
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
    var message = err;
    try {
        message = `[${(new Date()).toUTCString()}] ${err.stack}`;
    } catch(_) {}
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

start();
