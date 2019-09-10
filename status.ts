import { Db } from "./db";
import { RpcClient } from "./rpc";
import { ChainSyncCheckpoint } from "./info";

var pjson = require('./package.json');

enum context { 
    "SLPDB" = "SLPDB"
}

export class SlpdbStatus {
    static db: Db;
    static version: string;
    static context: context = context.SLPDB;
    static lastStatusUpdate: string = '';
    static state: SlpdbState;
    static network: string = '';
    static pastStackTraces: any[] = [];
    static rpc: RpcClient;
    static getSlpMempoolSize = function() { return -1; }
    static getSlpTokensCount = function() { return -1; }
    static getSyncdCheckpoint: () => Promise<ChainSyncCheckpoint> = async function() { return { hash: '', height: -1 }; }

    constructor(db: Db, rpc: RpcClient) {
        SlpdbStatus.version = pjson.version;
        SlpdbStatus.db = db;
        SlpdbStatus.rpc = rpc;
        SlpdbStatus.state = SlpdbState.PRE_STARTUP;
    }

    static async changeStateToStartupBlockSync({network, getSyncdCheckpoint}: {network: string, getSyncdCheckpoint: () => Promise<ChainSyncCheckpoint>}) {
        SlpdbStatus.network = network;
        SlpdbStatus.getSyncdCheckpoint = getSyncdCheckpoint;
        SlpdbStatus.state = SlpdbState.STARTUP_BLOCK_SYNC;
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToStartupSlpProcessing() {
        SlpdbStatus.state = SlpdbState.STARTUP_TOKEN_PROCESSING;
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToRunning({ getSlpMempoolSize, getSlpTokensCount }: { getSlpMempoolSize: () => number, getSlpTokensCount: () => number}) {
        SlpdbStatus.state = SlpdbState.RUNNING;
        SlpdbStatus.getSlpMempoolSize = getSlpMempoolSize;
        SlpdbStatus.getSlpTokensCount = getSlpTokensCount;
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToExitOnError(trace: string) {
        SlpdbStatus.state = SlpdbState.EXITED_ON_ERROR;
        SlpdbStatus.pastStackTraces.unshift(trace);
        if(SlpdbStatus.pastStackTraces.length > 5)
            SlpdbStatus.pastStackTraces.pop();
        await SlpdbStatus.saveStatus();
    }

    static async saveStatus() {
        let dbo = await SlpdbStatus.toDbo();
        await SlpdbStatus.db.statusUpdate(dbo);
    }

    static async logExitReason(error: string) {
        if(error) {
            await SlpdbStatus.changeStateToExitOnError(error);
        } else {
            SlpdbState.EXITED_NORMAL;
            await SlpdbStatus.saveStatus();
        }
    }

    private static async toDbo() {
        let checkpoint = await SlpdbStatus.getSyncdCheckpoint();

        let mempoolInfo = null;
        try {
            mempoolInfo = await SlpdbStatus.rpc.getMempoolInfo();
        } catch (_) { }

        let stackTraces = SlpdbStatus.pastStackTraces.map(t => {
            if(typeof t === 'string')
                return t;
            else {
                try {
                    return t.toString();
                } catch(_) { 
                    return "Unknown stack trace."
                }
            }
        })
        let date = new Date();
        return {
            version: SlpdbStatus.version,
            context: SlpdbStatus.context,
            lastStatusUpdate: { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) },
            state: SlpdbStatus.state,
            network: SlpdbStatus.network,
            blockHeight: checkpoint.height,
            blockHash: checkpoint.hash,
            mempoolInfoBch: mempoolInfo,
            mempoolSizeSlp: SlpdbStatus.getSlpMempoolSize(),
            tokensCount: SlpdbStatus.getSlpTokensCount(),
            pastStackTraces: stackTraces,
            mongoDbStats: await SlpdbStatus.db.db.stats({ scale: 1048576 })
        }
    }

    static async loadPreviousAttributes() {
        let dbo = await SlpdbStatus.db.statusFetch("SLPDB");
        try {
            SlpdbStatus.pastStackTraces = dbo.pastStackTraces;
        } catch(_) {}
    }
}

export enum SlpdbState {
    "PRE_STARTUP" = "PRE_STARTUP",                            // phase 1) checking connections with mongodb and bitcoin rpc
    "STARTUP_BLOCK_SYNC" = "STARTUP_BLOCK_SYNC",              // phase 2) indexing blockchain data into confirmed collection (allows crawling tokens dag quickly)
    "STARTUP_TOKEN_PROCESSING" = "STARTUP_TOKEN_PROCESSING",  // phase 3) load/update token graphs, hold a cache (allows fastest SLP validation)
    "RUNNING" = "RUNNING",                                    // phase 4) startup completed, running normally
    "EXITED_ON_ERROR" = "EXITED_ON_ERROR",                    // process exited due to an error during normal operation
    "EXITED_NORMAL" = "EXITED_NORMAL"                         // process exited normally, clean shutdown or finished running a command
}
