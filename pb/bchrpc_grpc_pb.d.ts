// package: pb
// file: bchrpc.proto

/* tslint:disable */

import * as grpc from "grpc";
import * as bchrpc_pb from "./bchrpc_pb";

interface IbchrpcService extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
    getMempoolInfo: IbchrpcService_IGetMempoolInfo;
    getBlockchainInfo: IbchrpcService_IGetBlockchainInfo;
    getBlockInfo: IbchrpcService_IGetBlockInfo;
    getBlock: IbchrpcService_IGetBlock;
    getRawBlock: IbchrpcService_IGetRawBlock;
    getBlockFilter: IbchrpcService_IGetBlockFilter;
    getHeaders: IbchrpcService_IGetHeaders;
    getTransaction: IbchrpcService_IGetTransaction;
    getRawTransaction: IbchrpcService_IGetRawTransaction;
    getAddressTransactions: IbchrpcService_IGetAddressTransactions;
    getRawAddressTransactions: IbchrpcService_IGetRawAddressTransactions;
    getAddressUnspentOutputs: IbchrpcService_IGetAddressUnspentOutputs;
    getMerkleProof: IbchrpcService_IGetMerkleProof;
    submitTransaction: IbchrpcService_ISubmitTransaction;
    subscribeTransactions: IbchrpcService_ISubscribeTransactions;
    subscribeTransactionStream: IbchrpcService_ISubscribeTransactionStream;
    subscribeBlocks: IbchrpcService_ISubscribeBlocks;
}

interface IbchrpcService_IGetMempoolInfo extends grpc.MethodDefinition<bchrpc_pb.GetMempoolInfoRequest, bchrpc_pb.GetMempoolInfoResponse> {
    path: string; // "/pb.bchrpc/GetMempoolInfo"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetMempoolInfoRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetMempoolInfoRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetMempoolInfoResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetMempoolInfoResponse>;
}
interface IbchrpcService_IGetBlockchainInfo extends grpc.MethodDefinition<bchrpc_pb.GetBlockchainInfoRequest, bchrpc_pb.GetBlockchainInfoResponse> {
    path: string; // "/pb.bchrpc/GetBlockchainInfo"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetBlockchainInfoRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetBlockchainInfoRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetBlockchainInfoResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetBlockchainInfoResponse>;
}
interface IbchrpcService_IGetBlockInfo extends grpc.MethodDefinition<bchrpc_pb.GetBlockInfoRequest, bchrpc_pb.GetBlockInfoResponse> {
    path: string; // "/pb.bchrpc/GetBlockInfo"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetBlockInfoRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetBlockInfoRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetBlockInfoResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetBlockInfoResponse>;
}
interface IbchrpcService_IGetBlock extends grpc.MethodDefinition<bchrpc_pb.GetBlockRequest, bchrpc_pb.GetBlockResponse> {
    path: string; // "/pb.bchrpc/GetBlock"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetBlockRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetBlockRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetBlockResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetBlockResponse>;
}
interface IbchrpcService_IGetRawBlock extends grpc.MethodDefinition<bchrpc_pb.GetRawBlockRequest, bchrpc_pb.GetRawBlockResponse> {
    path: string; // "/pb.bchrpc/GetRawBlock"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetRawBlockRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetRawBlockRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetRawBlockResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetRawBlockResponse>;
}
interface IbchrpcService_IGetBlockFilter extends grpc.MethodDefinition<bchrpc_pb.GetBlockFilterRequest, bchrpc_pb.GetBlockFilterResponse> {
    path: string; // "/pb.bchrpc/GetBlockFilter"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetBlockFilterRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetBlockFilterRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetBlockFilterResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetBlockFilterResponse>;
}
interface IbchrpcService_IGetHeaders extends grpc.MethodDefinition<bchrpc_pb.GetHeadersRequest, bchrpc_pb.GetHeadersResponse> {
    path: string; // "/pb.bchrpc/GetHeaders"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetHeadersRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetHeadersRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetHeadersResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetHeadersResponse>;
}
interface IbchrpcService_IGetTransaction extends grpc.MethodDefinition<bchrpc_pb.GetTransactionRequest, bchrpc_pb.GetTransactionResponse> {
    path: string; // "/pb.bchrpc/GetTransaction"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetTransactionRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetTransactionRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetTransactionResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetTransactionResponse>;
}
interface IbchrpcService_IGetRawTransaction extends grpc.MethodDefinition<bchrpc_pb.GetRawTransactionRequest, bchrpc_pb.GetRawTransactionResponse> {
    path: string; // "/pb.bchrpc/GetRawTransaction"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetRawTransactionRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetRawTransactionRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetRawTransactionResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetRawTransactionResponse>;
}
interface IbchrpcService_IGetAddressTransactions extends grpc.MethodDefinition<bchrpc_pb.GetAddressTransactionsRequest, bchrpc_pb.GetAddressTransactionsResponse> {
    path: string; // "/pb.bchrpc/GetAddressTransactions"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetAddressTransactionsRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetAddressTransactionsRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetAddressTransactionsResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetAddressTransactionsResponse>;
}
interface IbchrpcService_IGetRawAddressTransactions extends grpc.MethodDefinition<bchrpc_pb.GetRawAddressTransactionsRequest, bchrpc_pb.GetRawAddressTransactionsResponse> {
    path: string; // "/pb.bchrpc/GetRawAddressTransactions"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetRawAddressTransactionsRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetRawAddressTransactionsRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetRawAddressTransactionsResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetRawAddressTransactionsResponse>;
}
interface IbchrpcService_IGetAddressUnspentOutputs extends grpc.MethodDefinition<bchrpc_pb.GetAddressUnspentOutputsRequest, bchrpc_pb.GetAddressUnspentOutputsResponse> {
    path: string; // "/pb.bchrpc/GetAddressUnspentOutputs"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetAddressUnspentOutputsRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetAddressUnspentOutputsRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetAddressUnspentOutputsResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetAddressUnspentOutputsResponse>;
}
interface IbchrpcService_IGetMerkleProof extends grpc.MethodDefinition<bchrpc_pb.GetMerkleProofRequest, bchrpc_pb.GetMerkleProofResponse> {
    path: string; // "/pb.bchrpc/GetMerkleProof"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.GetMerkleProofRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.GetMerkleProofRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.GetMerkleProofResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.GetMerkleProofResponse>;
}
interface IbchrpcService_ISubmitTransaction extends grpc.MethodDefinition<bchrpc_pb.SubmitTransactionRequest, bchrpc_pb.SubmitTransactionResponse> {
    path: string; // "/pb.bchrpc/SubmitTransaction"
    requestStream: boolean; // false
    responseStream: boolean; // false
    requestSerialize: grpc.serialize<bchrpc_pb.SubmitTransactionRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.SubmitTransactionRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.SubmitTransactionResponse>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.SubmitTransactionResponse>;
}
interface IbchrpcService_ISubscribeTransactions extends grpc.MethodDefinition<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification> {
    path: string; // "/pb.bchrpc/SubscribeTransactions"
    requestStream: boolean; // false
    responseStream: boolean; // true
    requestSerialize: grpc.serialize<bchrpc_pb.SubscribeTransactionsRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.SubscribeTransactionsRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.TransactionNotification>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.TransactionNotification>;
}
interface IbchrpcService_ISubscribeTransactionStream extends grpc.MethodDefinition<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification> {
    path: string; // "/pb.bchrpc/SubscribeTransactionStream"
    requestStream: boolean; // true
    responseStream: boolean; // true
    requestSerialize: grpc.serialize<bchrpc_pb.SubscribeTransactionsRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.SubscribeTransactionsRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.TransactionNotification>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.TransactionNotification>;
}
interface IbchrpcService_ISubscribeBlocks extends grpc.MethodDefinition<bchrpc_pb.SubscribeBlocksRequest, bchrpc_pb.BlockNotification> {
    path: string; // "/pb.bchrpc/SubscribeBlocks"
    requestStream: boolean; // false
    responseStream: boolean; // true
    requestSerialize: grpc.serialize<bchrpc_pb.SubscribeBlocksRequest>;
    requestDeserialize: grpc.deserialize<bchrpc_pb.SubscribeBlocksRequest>;
    responseSerialize: grpc.serialize<bchrpc_pb.BlockNotification>;
    responseDeserialize: grpc.deserialize<bchrpc_pb.BlockNotification>;
}

export const bchrpcService: IbchrpcService;

export interface IbchrpcServer {
    getMempoolInfo: grpc.handleUnaryCall<bchrpc_pb.GetMempoolInfoRequest, bchrpc_pb.GetMempoolInfoResponse>;
    getBlockchainInfo: grpc.handleUnaryCall<bchrpc_pb.GetBlockchainInfoRequest, bchrpc_pb.GetBlockchainInfoResponse>;
    getBlockInfo: grpc.handleUnaryCall<bchrpc_pb.GetBlockInfoRequest, bchrpc_pb.GetBlockInfoResponse>;
    getBlock: grpc.handleUnaryCall<bchrpc_pb.GetBlockRequest, bchrpc_pb.GetBlockResponse>;
    getRawBlock: grpc.handleUnaryCall<bchrpc_pb.GetRawBlockRequest, bchrpc_pb.GetRawBlockResponse>;
    getBlockFilter: grpc.handleUnaryCall<bchrpc_pb.GetBlockFilterRequest, bchrpc_pb.GetBlockFilterResponse>;
    getHeaders: grpc.handleUnaryCall<bchrpc_pb.GetHeadersRequest, bchrpc_pb.GetHeadersResponse>;
    getTransaction: grpc.handleUnaryCall<bchrpc_pb.GetTransactionRequest, bchrpc_pb.GetTransactionResponse>;
    getRawTransaction: grpc.handleUnaryCall<bchrpc_pb.GetRawTransactionRequest, bchrpc_pb.GetRawTransactionResponse>;
    getAddressTransactions: grpc.handleUnaryCall<bchrpc_pb.GetAddressTransactionsRequest, bchrpc_pb.GetAddressTransactionsResponse>;
    getRawAddressTransactions: grpc.handleUnaryCall<bchrpc_pb.GetRawAddressTransactionsRequest, bchrpc_pb.GetRawAddressTransactionsResponse>;
    getAddressUnspentOutputs: grpc.handleUnaryCall<bchrpc_pb.GetAddressUnspentOutputsRequest, bchrpc_pb.GetAddressUnspentOutputsResponse>;
    getMerkleProof: grpc.handleUnaryCall<bchrpc_pb.GetMerkleProofRequest, bchrpc_pb.GetMerkleProofResponse>;
    submitTransaction: grpc.handleUnaryCall<bchrpc_pb.SubmitTransactionRequest, bchrpc_pb.SubmitTransactionResponse>;
    subscribeTransactions: grpc.handleServerStreamingCall<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification>;
    subscribeTransactionStream: grpc.handleBidiStreamingCall<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification>;
    subscribeBlocks: grpc.handleServerStreamingCall<bchrpc_pb.SubscribeBlocksRequest, bchrpc_pb.BlockNotification>;
}

export interface IbchrpcClient {
    getMempoolInfo(request: bchrpc_pb.GetMempoolInfoRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMempoolInfoResponse) => void): grpc.ClientUnaryCall;
    getMempoolInfo(request: bchrpc_pb.GetMempoolInfoRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMempoolInfoResponse) => void): grpc.ClientUnaryCall;
    getMempoolInfo(request: bchrpc_pb.GetMempoolInfoRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMempoolInfoResponse) => void): grpc.ClientUnaryCall;
    getBlockchainInfo(request: bchrpc_pb.GetBlockchainInfoRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockchainInfoResponse) => void): grpc.ClientUnaryCall;
    getBlockchainInfo(request: bchrpc_pb.GetBlockchainInfoRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockchainInfoResponse) => void): grpc.ClientUnaryCall;
    getBlockchainInfo(request: bchrpc_pb.GetBlockchainInfoRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockchainInfoResponse) => void): grpc.ClientUnaryCall;
    getBlockInfo(request: bchrpc_pb.GetBlockInfoRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockInfoResponse) => void): grpc.ClientUnaryCall;
    getBlockInfo(request: bchrpc_pb.GetBlockInfoRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockInfoResponse) => void): grpc.ClientUnaryCall;
    getBlockInfo(request: bchrpc_pb.GetBlockInfoRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockInfoResponse) => void): grpc.ClientUnaryCall;
    getBlock(request: bchrpc_pb.GetBlockRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockResponse) => void): grpc.ClientUnaryCall;
    getBlock(request: bchrpc_pb.GetBlockRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockResponse) => void): grpc.ClientUnaryCall;
    getBlock(request: bchrpc_pb.GetBlockRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockResponse) => void): grpc.ClientUnaryCall;
    getRawBlock(request: bchrpc_pb.GetRawBlockRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawBlockResponse) => void): grpc.ClientUnaryCall;
    getRawBlock(request: bchrpc_pb.GetRawBlockRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawBlockResponse) => void): grpc.ClientUnaryCall;
    getRawBlock(request: bchrpc_pb.GetRawBlockRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawBlockResponse) => void): grpc.ClientUnaryCall;
    getBlockFilter(request: bchrpc_pb.GetBlockFilterRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockFilterResponse) => void): grpc.ClientUnaryCall;
    getBlockFilter(request: bchrpc_pb.GetBlockFilterRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockFilterResponse) => void): grpc.ClientUnaryCall;
    getBlockFilter(request: bchrpc_pb.GetBlockFilterRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockFilterResponse) => void): grpc.ClientUnaryCall;
    getHeaders(request: bchrpc_pb.GetHeadersRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetHeadersResponse) => void): grpc.ClientUnaryCall;
    getHeaders(request: bchrpc_pb.GetHeadersRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetHeadersResponse) => void): grpc.ClientUnaryCall;
    getHeaders(request: bchrpc_pb.GetHeadersRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetHeadersResponse) => void): grpc.ClientUnaryCall;
    getTransaction(request: bchrpc_pb.GetTransactionRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetTransactionResponse) => void): grpc.ClientUnaryCall;
    getTransaction(request: bchrpc_pb.GetTransactionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetTransactionResponse) => void): grpc.ClientUnaryCall;
    getTransaction(request: bchrpc_pb.GetTransactionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetTransactionResponse) => void): grpc.ClientUnaryCall;
    getRawTransaction(request: bchrpc_pb.GetRawTransactionRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawTransactionResponse) => void): grpc.ClientUnaryCall;
    getRawTransaction(request: bchrpc_pb.GetRawTransactionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawTransactionResponse) => void): grpc.ClientUnaryCall;
    getRawTransaction(request: bchrpc_pb.GetRawTransactionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawTransactionResponse) => void): grpc.ClientUnaryCall;
    getAddressTransactions(request: bchrpc_pb.GetAddressTransactionsRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    getAddressTransactions(request: bchrpc_pb.GetAddressTransactionsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    getAddressTransactions(request: bchrpc_pb.GetAddressTransactionsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    getRawAddressTransactions(request: bchrpc_pb.GetRawAddressTransactionsRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    getRawAddressTransactions(request: bchrpc_pb.GetRawAddressTransactionsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    getRawAddressTransactions(request: bchrpc_pb.GetRawAddressTransactionsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    getAddressUnspentOutputs(request: bchrpc_pb.GetAddressUnspentOutputsRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressUnspentOutputsResponse) => void): grpc.ClientUnaryCall;
    getAddressUnspentOutputs(request: bchrpc_pb.GetAddressUnspentOutputsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressUnspentOutputsResponse) => void): grpc.ClientUnaryCall;
    getAddressUnspentOutputs(request: bchrpc_pb.GetAddressUnspentOutputsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressUnspentOutputsResponse) => void): grpc.ClientUnaryCall;
    getMerkleProof(request: bchrpc_pb.GetMerkleProofRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMerkleProofResponse) => void): grpc.ClientUnaryCall;
    getMerkleProof(request: bchrpc_pb.GetMerkleProofRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMerkleProofResponse) => void): grpc.ClientUnaryCall;
    getMerkleProof(request: bchrpc_pb.GetMerkleProofRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMerkleProofResponse) => void): grpc.ClientUnaryCall;
    submitTransaction(request: bchrpc_pb.SubmitTransactionRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.SubmitTransactionResponse) => void): grpc.ClientUnaryCall;
    submitTransaction(request: bchrpc_pb.SubmitTransactionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.SubmitTransactionResponse) => void): grpc.ClientUnaryCall;
    submitTransaction(request: bchrpc_pb.SubmitTransactionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.SubmitTransactionResponse) => void): grpc.ClientUnaryCall;
    subscribeTransactions(request: bchrpc_pb.SubscribeTransactionsRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.TransactionNotification>;
    subscribeTransactions(request: bchrpc_pb.SubscribeTransactionsRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.TransactionNotification>;
    subscribeTransactionStream(): grpc.ClientDuplexStream<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification>;
    subscribeTransactionStream(options: Partial<grpc.CallOptions>): grpc.ClientDuplexStream<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification>;
    subscribeTransactionStream(metadata: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientDuplexStream<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification>;
    subscribeBlocks(request: bchrpc_pb.SubscribeBlocksRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.BlockNotification>;
    subscribeBlocks(request: bchrpc_pb.SubscribeBlocksRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.BlockNotification>;
}

export class bchrpcClient extends grpc.Client implements IbchrpcClient {
    constructor(address: string, credentials: grpc.ChannelCredentials, options?: object);
    public getMempoolInfo(request: bchrpc_pb.GetMempoolInfoRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMempoolInfoResponse) => void): grpc.ClientUnaryCall;
    public getMempoolInfo(request: bchrpc_pb.GetMempoolInfoRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMempoolInfoResponse) => void): grpc.ClientUnaryCall;
    public getMempoolInfo(request: bchrpc_pb.GetMempoolInfoRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMempoolInfoResponse) => void): grpc.ClientUnaryCall;
    public getBlockchainInfo(request: bchrpc_pb.GetBlockchainInfoRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockchainInfoResponse) => void): grpc.ClientUnaryCall;
    public getBlockchainInfo(request: bchrpc_pb.GetBlockchainInfoRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockchainInfoResponse) => void): grpc.ClientUnaryCall;
    public getBlockchainInfo(request: bchrpc_pb.GetBlockchainInfoRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockchainInfoResponse) => void): grpc.ClientUnaryCall;
    public getBlockInfo(request: bchrpc_pb.GetBlockInfoRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockInfoResponse) => void): grpc.ClientUnaryCall;
    public getBlockInfo(request: bchrpc_pb.GetBlockInfoRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockInfoResponse) => void): grpc.ClientUnaryCall;
    public getBlockInfo(request: bchrpc_pb.GetBlockInfoRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockInfoResponse) => void): grpc.ClientUnaryCall;
    public getBlock(request: bchrpc_pb.GetBlockRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockResponse) => void): grpc.ClientUnaryCall;
    public getBlock(request: bchrpc_pb.GetBlockRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockResponse) => void): grpc.ClientUnaryCall;
    public getBlock(request: bchrpc_pb.GetBlockRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockResponse) => void): grpc.ClientUnaryCall;
    public getRawBlock(request: bchrpc_pb.GetRawBlockRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawBlockResponse) => void): grpc.ClientUnaryCall;
    public getRawBlock(request: bchrpc_pb.GetRawBlockRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawBlockResponse) => void): grpc.ClientUnaryCall;
    public getRawBlock(request: bchrpc_pb.GetRawBlockRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawBlockResponse) => void): grpc.ClientUnaryCall;
    public getBlockFilter(request: bchrpc_pb.GetBlockFilterRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockFilterResponse) => void): grpc.ClientUnaryCall;
    public getBlockFilter(request: bchrpc_pb.GetBlockFilterRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockFilterResponse) => void): grpc.ClientUnaryCall;
    public getBlockFilter(request: bchrpc_pb.GetBlockFilterRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetBlockFilterResponse) => void): grpc.ClientUnaryCall;
    public getHeaders(request: bchrpc_pb.GetHeadersRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetHeadersResponse) => void): grpc.ClientUnaryCall;
    public getHeaders(request: bchrpc_pb.GetHeadersRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetHeadersResponse) => void): grpc.ClientUnaryCall;
    public getHeaders(request: bchrpc_pb.GetHeadersRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetHeadersResponse) => void): grpc.ClientUnaryCall;
    public getTransaction(request: bchrpc_pb.GetTransactionRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetTransactionResponse) => void): grpc.ClientUnaryCall;
    public getTransaction(request: bchrpc_pb.GetTransactionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetTransactionResponse) => void): grpc.ClientUnaryCall;
    public getTransaction(request: bchrpc_pb.GetTransactionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetTransactionResponse) => void): grpc.ClientUnaryCall;
    public getRawTransaction(request: bchrpc_pb.GetRawTransactionRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawTransactionResponse) => void): grpc.ClientUnaryCall;
    public getRawTransaction(request: bchrpc_pb.GetRawTransactionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawTransactionResponse) => void): grpc.ClientUnaryCall;
    public getRawTransaction(request: bchrpc_pb.GetRawTransactionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawTransactionResponse) => void): grpc.ClientUnaryCall;
    public getAddressTransactions(request: bchrpc_pb.GetAddressTransactionsRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    public getAddressTransactions(request: bchrpc_pb.GetAddressTransactionsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    public getAddressTransactions(request: bchrpc_pb.GetAddressTransactionsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    public getRawAddressTransactions(request: bchrpc_pb.GetRawAddressTransactionsRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    public getRawAddressTransactions(request: bchrpc_pb.GetRawAddressTransactionsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    public getRawAddressTransactions(request: bchrpc_pb.GetRawAddressTransactionsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetRawAddressTransactionsResponse) => void): grpc.ClientUnaryCall;
    public getAddressUnspentOutputs(request: bchrpc_pb.GetAddressUnspentOutputsRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressUnspentOutputsResponse) => void): grpc.ClientUnaryCall;
    public getAddressUnspentOutputs(request: bchrpc_pb.GetAddressUnspentOutputsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressUnspentOutputsResponse) => void): grpc.ClientUnaryCall;
    public getAddressUnspentOutputs(request: bchrpc_pb.GetAddressUnspentOutputsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetAddressUnspentOutputsResponse) => void): grpc.ClientUnaryCall;
    public getMerkleProof(request: bchrpc_pb.GetMerkleProofRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMerkleProofResponse) => void): grpc.ClientUnaryCall;
    public getMerkleProof(request: bchrpc_pb.GetMerkleProofRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMerkleProofResponse) => void): grpc.ClientUnaryCall;
    public getMerkleProof(request: bchrpc_pb.GetMerkleProofRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.GetMerkleProofResponse) => void): grpc.ClientUnaryCall;
    public submitTransaction(request: bchrpc_pb.SubmitTransactionRequest, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.SubmitTransactionResponse) => void): grpc.ClientUnaryCall;
    public submitTransaction(request: bchrpc_pb.SubmitTransactionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.SubmitTransactionResponse) => void): grpc.ClientUnaryCall;
    public submitTransaction(request: bchrpc_pb.SubmitTransactionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: bchrpc_pb.SubmitTransactionResponse) => void): grpc.ClientUnaryCall;
    public subscribeTransactions(request: bchrpc_pb.SubscribeTransactionsRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.TransactionNotification>;
    public subscribeTransactions(request: bchrpc_pb.SubscribeTransactionsRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.TransactionNotification>;
    public subscribeTransactionStream(options?: Partial<grpc.CallOptions>): grpc.ClientDuplexStream<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification>;
    public subscribeTransactionStream(metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientDuplexStream<bchrpc_pb.SubscribeTransactionsRequest, bchrpc_pb.TransactionNotification>;
    public subscribeBlocks(request: bchrpc_pb.SubscribeBlocksRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.BlockNotification>;
    public subscribeBlocks(request: bchrpc_pb.SubscribeBlocksRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<bchrpc_pb.BlockNotification>;
}
