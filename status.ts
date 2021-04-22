import { Db } from "./db";
import { RpcClient } from "./rpc";
import { ChainSyncCheckpoint, Info } from "./info";
import * as fs from 'fs';
import { Config } from "./config";

import * as https from 'https';
import { CacheSet } from "./cache";
var pjson = require('./package.json');
var os = require('os-utils');

enum context { 
    "SLPDB" = "SLPDB"
}

export class SlpdbStatus {
    static db: Db;
    static startCmd: string;
    static version = pjson.version;
    static versionHash: string|null = null;
    static deplVersionHash: string|null = null;
    static context: context = context.SLPDB;
    static lastIncomingTxnZmq: { utc: string, unix: number}|null = null;
    static lastIncomingBlockZmq: { utc: string, unix: number}|null = null;
    static lastOutgoingTxnZmq: { utc: string, unix: number}|null = null;
    static lastOutgoingBlockZmq: { utc: string, unix: number}|null = null;
    static slpProcessedBlockHeight: number|null = null;
    static state: SlpdbState;
    static stateHistory = new CacheSet<{ utc: string, state: SlpdbState }>(10);
    static network: string = '';
    static pastStackTraces: any[] = [];
    static doubleSpendHistory: any[] = [];
    static reorgHistory: any[] = [];
    static rpc: RpcClient;
    static getSlpMempoolSize = function() { return -1; }
    static getSlpTokensCount = function() { return -1; }
    static getSyncdCheckpoint: () => Promise<ChainSyncCheckpoint> = async function() { return { hash: '', height: -1 }; }

    constructor(db: Db, startCmd: string[]) {
        SlpdbStatus.db = db;
        SlpdbStatus.setState(SlpdbState.PRE_STARTUP);
        SlpdbStatus.versionHash = SlpdbStatus.getVersion();
        SlpdbStatus.deplVersionHash = SlpdbStatus.getDeplVersion();
        let last = (a: string[]) => { let i = a.length-1; return a[i]; }
        SlpdbStatus.startCmd = "".concat(...startCmd.map(s => last(s.split('/')).concat(' '))).trimEnd();
    }

    static setState(state: SlpdbState) {
        SlpdbStatus.state = state;
        SlpdbStatus.stateHistory.push({ utc: (new Date()).toUTCString(), state });
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

    static async updateSlpProcessedBlockHeight(height: number) {
        SlpdbStatus.slpProcessedBlockHeight = height;
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToStartupBlockSync({ network, getSyncdCheckpoint, getSlpTokensCount }: { network: string, getSyncdCheckpoint: () => Promise<ChainSyncCheckpoint>, getSlpTokensCount: () => number }) {
        SlpdbStatus.network = network;
        SlpdbStatus.getSyncdCheckpoint = getSyncdCheckpoint;
        SlpdbStatus.getSlpTokensCount = getSlpTokensCount;
        SlpdbStatus.setState(SlpdbState.STARTUP_BLOCK_SYNC);
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToRunning({ getSlpMempoolSize }: { getSlpMempoolSize: () => number }) {
        SlpdbStatus.setState(SlpdbState.RUNNING);
        SlpdbStatus.getSlpMempoolSize = getSlpMempoolSize;
        await SlpdbStatus.saveStatus();
    }

    static async changeStateToExitOnError(trace: string) {
        SlpdbStatus.setState(SlpdbState.EXITED_ON_ERROR);
        SlpdbStatus.pastStackTraces.unshift(trace);
        if(SlpdbStatus.pastStackTraces.length > 5)
            SlpdbStatus.pastStackTraces.pop();
        await SlpdbStatus.saveStatus();
    }

    static async saveStatus() {
        let dbo = await SlpdbStatus.toDbo();
        await SlpdbStatus.db.statusUpdate(dbo);
    }

    static async logExitReason(errorMsg: string) {
        if (errorMsg === "SIGINT") {
            SlpdbStatus.setState(SlpdbState.EXITED_SIGINT);
            await SlpdbStatus.saveStatus();
        } else if (errorMsg === "SIGTERM") {
            SlpdbStatus.setState(SlpdbState.EXITED_SIGTERM);
            await SlpdbStatus.saveStatus();
        } else if (errorMsg === "SIGQUIT") {
            SlpdbStatus.setState(SlpdbState.EXITED_SIGQUIT);
            await SlpdbStatus.saveStatus();
        } else {
            await SlpdbStatus.changeStateToExitOnError(errorMsg);
        }
    }

    private static async toDbo() {
        let checkpoint = await SlpdbStatus.getSyncdCheckpoint();

        let mempoolInfo = null;
        try {
            mempoolInfo = await RpcClient.getMempoolInfo();
        } catch (_) { }

        let stackTraces = SlpdbStatus.pastStackTraces.map(t => {
            if(typeof t === 'string')
                return t;
            else {
                try {
                    return t.toString();
                } catch(_) { }
                try {
                    return JSON.stringify(t);
                } catch(_) {
                    return "Unknown stack trace.";
                }
            }
        })
        let date = new Date();
        let status = {
            version: this.version,            
            versionHash: this.versionHash,
            deplVersionHash: this.deplVersionHash,
            startCmd: this.startCmd,
            context: this.context,
            lastStatusUpdate: { utc: date.toUTCString(), unix: Math.floor(date.getTime()/1000) },
            lastIncomingTxnZmq: this.lastIncomingTxnZmq,
            lastIncomingBlockZmq: this.lastIncomingBlockZmq,
            lastOutgoingTxnZmq: this.lastOutgoingTxnZmq,
            lastOutgoingBlockZmq: this.lastOutgoingBlockZmq,
            state: this.state,
            stateHistory: Array.from(this.stateHistory.toSet()),
            network: this.network,
            bchBlockHeight: checkpoint.height,
            bchBlockHash: checkpoint.hash,
            slpProcessedBlockHeight: this.slpProcessedBlockHeight,
            mempoolInfoBch: mempoolInfo,
            mempoolSizeSlp: this.getSlpMempoolSize(),
            tokensCount: this.getSlpTokensCount(),
            pastStackTraces: stackTraces,
            doubleSpends: this.doubleSpendHistory,
            reorgs: this.reorgHistory,
            mongoDbStats: await this.db.db.stats({ scale: 1048576 }),
            publicUrl: await Info.getTelemetryName(),
            telemetryHash: await Info.getTelemetrySecretHash(),
            system: { loadAvg1: os.loadavg(1), loadAvg5: os.loadavg(5), loadAvg15: os.loadavg(15), platform: os.platform(), cpuCount: os.cpuCount(), freeMem: os.freemem(), totalMem: os.totalmem(), uptime: os.sysUptime(), processUptime: os.processUptime() }
        };
        await this.updateTelemetry(status);
        return status;
    }

    private static async updateTelemetry(status: StatusDbo) {
        if (Config.telemetry.enable) {
            try {
                let data = JSON.stringify({ status: status });
                let options = {
                    hostname: Config.telemetry.host,
                    port: Config.telemetry.port,
                    path: '/status',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': data.length,
                        'Authorization': await Info.getTelemetrySecret()
                    }
                };
                let req = https.request(options, res => {
                    console.log(`[INFO] Telementry response code: ${res.statusCode}`);
                    res.on('data', d => {
                        console.log(`[INFO] Telemetry response from ${Config.telemetry.host}: ${d.toString('utf8')}`);
                        try { JSON.parse(d).secretKey ? Info.setTelemetrySecret(JSON.parse(d).secretKey) : null; } catch (_) {}
                    });
                });
                req.on('error', error => {
                    let reason = error.message;
                    if (Config.telemetry.host === '') {
                        reason = "Env var 'telemetry_host' is not set";
                    }
                    console.log("[ERROR] Telemetry update failed. Reason:", reason);
                });
                console.log(`[INFO] Sending telemetry update to ${Config.telemetry.host} for ${await Info.getTelemetryName()}...`);
                req.write(data);
                req.end();
            } catch (err) {
                console.log(`[ERROR] Could not updateTelemetry: ${err}`);
            }
        }
    }

    static async loadPreviousAttributes() {
        let dbo = await SlpdbStatus.db.statusFetch("SLPDB");
        try {
            SlpdbStatus.pastStackTraces = dbo.pastStackTraces;
            let history = new CacheSet<{ utc: string, state: SlpdbState }>(10);
            dbo.stateHistory.forEach((state: { utc: string, state: SlpdbState }) => { history.push(state); });
            Array.from(SlpdbStatus.stateHistory.toSet()).forEach((state: { utc: string, state: SlpdbState }) => { history.push(state); });
            SlpdbStatus.stateHistory = history;
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
    "EXITED_SIGINT" = "EXITED_SIGINT",                        // process exited normally, clean shutdown or finished running a command
    "EXITED_SIGTERM" = "EXITED_SIGTERM",                      // process exited normally, clean shutdown or finished running a command
    "EXITED_SIGQUIT" = "EXITED_SIGQUIT"                       // process exited normally, clean shutdown or finished running a command
}

interface StatusDbo {
    version: string; 
    versionHash: string | null; 
    deplVersionHash: string | null;
    startCmd: string;
    context: context; 
    lastStatusUpdate: { utc: string; unix: number; }; 
    lastIncomingTxnZmq: { utc: string; unix: number; } | null; 
    lastIncomingBlockZmq: { utc: string; unix: number; } | null; 
    lastOutgoingTxnZmq: { utc: string; unix: number; } | null; 
    lastOutgoingBlockZmq: { utc: string; unix: number; } | null; 
    state: SlpdbState; 
    stateHistory: { utc: string, state: SlpdbState }[];
    network: string; 
    bchBlockHeight: number; 
    bchBlockHash: string | null; 
    slpProcessedBlockHeight: number | null;
    mempoolInfoBch: {} | null; 
    mempoolSizeSlp: number; 
    tokensCount: number; 
    pastStackTraces: string[]; 
    doubleSpends: any[];
    reorgs: any[];
    mongoDbStats: any; 
    publicUrl: string; 
    telemetryHash: string|null;
    system: any;
}
