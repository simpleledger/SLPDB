import { Config } from "./config";
import * as zmq from 'zeromq';
import { GrpcClient, TransactionNotification, BlockNotification } from "grpc-bchrpc-node";
import { ClientReadableStream } from "grpc";

export class Notifications {
    useGrpc: boolean | undefined;
    sock: any | undefined;
    grpc: GrpcClient | undefined;
    onRawTxnCb: Function;
    onBlockHashCb: Function;
    constructor({ onRawTxnCb, onBlockHashCb, useGrpc }: { onRawTxnCb: (message:Buffer)=>any, onBlockHashCb: (message:Buffer)=>any, useGrpc?: boolean }) {
        this.onRawTxnCb = onRawTxnCb;
        this.onBlockHashCb = onBlockHashCb;
        if(useGrpc) {
            this.useGrpc = useGrpc;
            if(Boolean(Config.grpc.url) && Config.grpc.certPath)
                this.grpc = new GrpcClient({ url: Config.grpc.url, rootCertPath: Config.grpc.certPath });
            else
                this.grpc = new GrpcClient({ url: Config.grpc.url });    
            this.grpcSubscribe();        
        } else {
            this.sock = zmq.socket('sub');
            this.sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port);
            this.sock.subscribe('rawtx');
            this.sock.subscribe('hashblock');
            this.sock.on('message', async function(topic: string, message: Buffer) {
                if (topic.toString() === 'rawtx') {
                    await onRawTxnCb(message);
                } else if(topic.toString() === 'hashblock') { 
                    await onBlockHashCb(message);
                }
            })
        }
    }

    async grpcSubscribe() {
        let self = this;
        if(this.grpc) {
            let txnstream: ClientReadableStream<TransactionNotification>;
            txnstream = await this.grpc.subscribeTransactions({ includeMempoolAcceptance: true, includeSerializedTxn: true })
            txnstream.on('data', function(data: TransactionNotification) {
                self.onRawTxnCb(Buffer.from(data.getSerializedTransaction_asU8()))
            })
            let blockstream: ClientReadableStream<BlockNotification>;  // damnit.. i hate blockstream
            blockstream = await this.grpc.subscribeBlocks({});
            blockstream.on('data', function(data: BlockNotification){
                self.onBlockHashCb(Buffer.from(data.getBlockInfo()!.getHash_asU8().reverse()))
            })
        }
    }
}