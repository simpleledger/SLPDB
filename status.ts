import { Db } from "./db";
import { RpcClient } from "./rpc";
import { ChainSyncCheckpoint } from "./info";
import * as fs from 'fs';
import { Config } from "./config";

import * as https from 'https';
var pjson = require('./package.json');

enum context { 
    "SLPDB" = "SLPDB"
}

export class SlpdbStatus {
    static db: Db;
    static version = pjson.version;
    static versionHash: string|null = null;
    static deplVersionHash: string|null = null;
    static context: context = context.SLPDB;
    static public_url: string = Config.telemetry.advertised_host;
    static lastIncomingTxnZmq: { utc: string, unix: number}|null = null;
    static lastIncomingBlockZmq: { utc: string, unix: number}|null = null;
    static lastOutgoingTxnZmq: { utc: string, unix: number}|null = null;
    static lastOutgoingBlockZmq: { utc: string, unix: number}|null = null;
    static slpProcessedBlockHeight: number|null = null;
    static state: SlpdbState;
    static network: string = '';
    static pastStackTraces: any[] = [];
    static rpc: RpcClient;
    static getSlpMempoolSize = function() { return -1; }
    static getSlpTokensCount = function() { return -1; }
    static getSyncdCheckpoint: () => Promise<ChainSyncCheckpoint> = async function() { return { hash: '', height: -1 }; }

    constructor(db: Db, rpc: RpcClient) {
        SlpdbStatus.db = db;
        SlpdbStatus.rpc = rpc;
        SlpdbStatus.state = SlpdbState.PRE_STARTUP;
        SlpdbStatus.versionHash = SlpdbStatus.getVersion();
        SlpdbStatus.deplVersionHash = SlpdbStatus.getDeplVersion();
    }
   
    static updateTimeIncomingTxnZmq() {
        let date = new Date();
        SlpdbStatus.lastIncomingTxnZmq = { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) }
    }

    static updateTimeIncomingBlockZmq() {
        let date = new Date();
        SlpdbStatus.lastIncomingBlockZmq = { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) }    
    }

    static updateTimeOutgoingBlockZmq() {
        let date = new Date();
        SlpdbStatus.lastOutgoingBlockZmq = { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) }    
    }

    static updateTimeOutgoingTxnZmq() {
        let date = new Date();
        SlpdbStatus.lastOutgoingTxnZmq = { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) }    
    }

    static updateSlpProcessedBlockHeight(height: number) {
        SlpdbStatus.slpProcessedBlockHeight = height;
    }

    static async changeStateToStartupBlockSync({ network, getSyncdCheckpoint }: { network: string, getSyncdCheckpoint: () => Promise<ChainSyncCheckpoint> }) {
        SlpdbStatus.network = network;
        SlpdbStatus.getSyncdCheckpoint = getSyncdCheckpoint;
        SlpdbStatus.state = SlpdbState.STARTUP_BLOCK_SYNC;
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToStartupSlpProcessing({ getSlpTokensCount }: { getSlpTokensCount: () => number }) {
        SlpdbStatus.state = SlpdbState.STARTUP_TOKEN_PROCESSING;
        SlpdbStatus.getSlpTokensCount = getSlpTokensCount;
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToRunning({ getSlpMempoolSize }: { getSlpMempoolSize: () => number }) {
        SlpdbStatus.state = SlpdbState.RUNNING;
        SlpdbStatus.getSlpMempoolSize = getSlpMempoolSize;
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
        let status = {
            version: SlpdbStatus.version,            
            versionHash: SlpdbStatus.versionHash,
            deplVersionHash: SlpdbStatus.deplVersionHash,
            context: SlpdbStatus.context,
            lastStatusUpdate: { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) },
            lastIncomingTxnZmq: SlpdbStatus.lastIncomingTxnZmq,
            lastIncomingBlockZmq: SlpdbStatus.lastIncomingBlockZmq,
            lastOutgoingTxnZmq: SlpdbStatus.lastOutgoingTxnZmq,
            lastOutgoingBlockZmq: SlpdbStatus.lastOutgoingBlockZmq,
            state: SlpdbStatus.state,
            network: SlpdbStatus.network,
            bchBlockHeight: checkpoint.height,
            bchBlockHash: checkpoint.hash,
            slpProcessedBlockHeight: SlpdbStatus.slpProcessedBlockHeight,
            mempoolInfoBch: mempoolInfo,
            mempoolSizeSlp: SlpdbStatus.getSlpMempoolSize(),
            tokensCount: SlpdbStatus.getSlpTokensCount(),
            pastStackTraces: stackTraces,
            mongoDbStats: await SlpdbStatus.db.db.stats({ scale: 1048576 }),
            public_url: SlpdbStatus.public_url
        };
        SlpdbStatus.updateTelemetry(status);
        return status;
    }

    private static updateTelemetry(status: StatusDbo) {
        if (Config.telemetry.advertised_host !== '') {
            let data = JSON.stringify({ status: status });
            let options = {
                hostname: Config.telemetry.host,
                port: Config.telemetry.port,
                path: '/status',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length, 
                    'Authorization': Config.telemetry.secret
                }
            };
            let req = https.request(options, res => {
                console.log(`statusCode: ${res.statusCode}`);
                res.on('data', d => {
                    console.log(`[INFO] Telelmetry response from ${Config.telemetry.advertised_host}:`);
                    console.log(d.toString('utf8'));
                });
            });
            req.on('error', error => {
                let reason = error.message;
                if (Config.telemetry.host === '')
                    reason = "Env var 'telemetry_host' is not set";
                console.log("[ERROR] Telemetry update failed. Reason:", reason);
            });
            req.write(data);
            req.end();
        }
    }

    static async loadPreviousAttributes() {
        let dbo = await SlpdbStatus.db.statusFetch("SLPDB");
        try {
            SlpdbStatus.pastStackTraces = dbo.pastStackTraces;
        } catch(_) {}
    }

    static getVersion() {
        try {
            const rev = fs.readFileSync('.git/HEAD').toString();
            if (rev.indexOf(':') === -1) {
                return rev.trim();
            } else {
                return fs.readFileSync('.git/' + rev.trim().substring(5)).toString().trim();
            }
        }  catch (_) {
            return null;
        }
    }

    static getDeplVersion() {
        try {
            const rev = fs.readFileSync('._git/HEAD').toString();
            if (rev.indexOf(':') === -1) {
                return rev.trim();
            } else {
                return fs.readFileSync('._git/' + rev.trim().substring(5)).toString().trim();
            }
        }  catch (_) {
            return null;
        }
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

interface StatusDbo {
    version: string; 
    versionHash: string | null; 
    deplVersionHash: string | null;
    context: context; 
    lastStatusUpdate: { utc: string; unix: number; }; 
    lastIncomingTxnZmq: { utc: string; unix: number; } | null; 
    lastIncomingBlockZmq: { utc: string; unix: number; } | null; 
    lastOutgoingTxnZmq: { utc: string; unix: number; } | null; 
    lastOutgoingBlockZmq: { utc: string; unix: number; } | null; 
    state: SlpdbState; 
    network: string; 
    bchBlockHeight: number; 
    bchBlockHash: string | null; 
    slpProcessedBlockHeight: number | null;
    mempoolInfoBch: {} | null; 
    mempoolSizeSlp: number; 
    tokensCount: number; 
    pastStackTraces: any[]; 
    mongoDbStats: any; 
    public_url: string; 
}
