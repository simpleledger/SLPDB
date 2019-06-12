// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('grpc');
var pb_bchrpc_pb = require('../pb/bchrpc_pb.js');

function serialize_pb_BlockNotification(arg) {
  if (!(arg instanceof pb_bchrpc_pb.BlockNotification)) {
    throw new Error('Expected argument of type pb.BlockNotification');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_BlockNotification(buffer_arg) {
  return pb_bchrpc_pb.BlockNotification.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetAddressTransactionsRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetAddressTransactionsRequest)) {
    throw new Error('Expected argument of type pb.GetAddressTransactionsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetAddressTransactionsRequest(buffer_arg) {
  return pb_bchrpc_pb.GetAddressTransactionsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetAddressTransactionsResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetAddressTransactionsResponse)) {
    throw new Error('Expected argument of type pb.GetAddressTransactionsResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetAddressTransactionsResponse(buffer_arg) {
  return pb_bchrpc_pb.GetAddressTransactionsResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetAddressUnspentOutputsRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetAddressUnspentOutputsRequest)) {
    throw new Error('Expected argument of type pb.GetAddressUnspentOutputsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetAddressUnspentOutputsRequest(buffer_arg) {
  return pb_bchrpc_pb.GetAddressUnspentOutputsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetAddressUnspentOutputsResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetAddressUnspentOutputsResponse)) {
    throw new Error('Expected argument of type pb.GetAddressUnspentOutputsResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetAddressUnspentOutputsResponse(buffer_arg) {
  return pb_bchrpc_pb.GetAddressUnspentOutputsResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockFilterRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockFilterRequest)) {
    throw new Error('Expected argument of type pb.GetBlockFilterRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockFilterRequest(buffer_arg) {
  return pb_bchrpc_pb.GetBlockFilterRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockFilterResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockFilterResponse)) {
    throw new Error('Expected argument of type pb.GetBlockFilterResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockFilterResponse(buffer_arg) {
  return pb_bchrpc_pb.GetBlockFilterResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockInfoRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockInfoRequest)) {
    throw new Error('Expected argument of type pb.GetBlockInfoRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockInfoRequest(buffer_arg) {
  return pb_bchrpc_pb.GetBlockInfoRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockInfoResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockInfoResponse)) {
    throw new Error('Expected argument of type pb.GetBlockInfoResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockInfoResponse(buffer_arg) {
  return pb_bchrpc_pb.GetBlockInfoResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockRequest)) {
    throw new Error('Expected argument of type pb.GetBlockRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockRequest(buffer_arg) {
  return pb_bchrpc_pb.GetBlockRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockResponse)) {
    throw new Error('Expected argument of type pb.GetBlockResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockResponse(buffer_arg) {
  return pb_bchrpc_pb.GetBlockResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockchainInfoRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockchainInfoRequest)) {
    throw new Error('Expected argument of type pb.GetBlockchainInfoRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockchainInfoRequest(buffer_arg) {
  return pb_bchrpc_pb.GetBlockchainInfoRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetBlockchainInfoResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetBlockchainInfoResponse)) {
    throw new Error('Expected argument of type pb.GetBlockchainInfoResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetBlockchainInfoResponse(buffer_arg) {
  return pb_bchrpc_pb.GetBlockchainInfoResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetHeadersRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetHeadersRequest)) {
    throw new Error('Expected argument of type pb.GetHeadersRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetHeadersRequest(buffer_arg) {
  return pb_bchrpc_pb.GetHeadersRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetHeadersResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetHeadersResponse)) {
    throw new Error('Expected argument of type pb.GetHeadersResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetHeadersResponse(buffer_arg) {
  return pb_bchrpc_pb.GetHeadersResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetMempoolInfoRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetMempoolInfoRequest)) {
    throw new Error('Expected argument of type pb.GetMempoolInfoRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetMempoolInfoRequest(buffer_arg) {
  return pb_bchrpc_pb.GetMempoolInfoRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetMempoolInfoResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetMempoolInfoResponse)) {
    throw new Error('Expected argument of type pb.GetMempoolInfoResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetMempoolInfoResponse(buffer_arg) {
  return pb_bchrpc_pb.GetMempoolInfoResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetMerkleProofRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetMerkleProofRequest)) {
    throw new Error('Expected argument of type pb.GetMerkleProofRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetMerkleProofRequest(buffer_arg) {
  return pb_bchrpc_pb.GetMerkleProofRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetMerkleProofResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetMerkleProofResponse)) {
    throw new Error('Expected argument of type pb.GetMerkleProofResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetMerkleProofResponse(buffer_arg) {
  return pb_bchrpc_pb.GetMerkleProofResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetRawAddressTransactionsRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetRawAddressTransactionsRequest)) {
    throw new Error('Expected argument of type pb.GetRawAddressTransactionsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetRawAddressTransactionsRequest(buffer_arg) {
  return pb_bchrpc_pb.GetRawAddressTransactionsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetRawAddressTransactionsResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetRawAddressTransactionsResponse)) {
    throw new Error('Expected argument of type pb.GetRawAddressTransactionsResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetRawAddressTransactionsResponse(buffer_arg) {
  return pb_bchrpc_pb.GetRawAddressTransactionsResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetRawBlockRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetRawBlockRequest)) {
    throw new Error('Expected argument of type pb.GetRawBlockRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetRawBlockRequest(buffer_arg) {
  return pb_bchrpc_pb.GetRawBlockRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetRawBlockResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetRawBlockResponse)) {
    throw new Error('Expected argument of type pb.GetRawBlockResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetRawBlockResponse(buffer_arg) {
  return pb_bchrpc_pb.GetRawBlockResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetRawTransactionRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetRawTransactionRequest)) {
    throw new Error('Expected argument of type pb.GetRawTransactionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetRawTransactionRequest(buffer_arg) {
  return pb_bchrpc_pb.GetRawTransactionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetRawTransactionResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetRawTransactionResponse)) {
    throw new Error('Expected argument of type pb.GetRawTransactionResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetRawTransactionResponse(buffer_arg) {
  return pb_bchrpc_pb.GetRawTransactionResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetTransactionRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetTransactionRequest)) {
    throw new Error('Expected argument of type pb.GetTransactionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetTransactionRequest(buffer_arg) {
  return pb_bchrpc_pb.GetTransactionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_GetTransactionResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.GetTransactionResponse)) {
    throw new Error('Expected argument of type pb.GetTransactionResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_GetTransactionResponse(buffer_arg) {
  return pb_bchrpc_pb.GetTransactionResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_SubmitTransactionRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.SubmitTransactionRequest)) {
    throw new Error('Expected argument of type pb.SubmitTransactionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_SubmitTransactionRequest(buffer_arg) {
  return pb_bchrpc_pb.SubmitTransactionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_SubmitTransactionResponse(arg) {
  if (!(arg instanceof pb_bchrpc_pb.SubmitTransactionResponse)) {
    throw new Error('Expected argument of type pb.SubmitTransactionResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_SubmitTransactionResponse(buffer_arg) {
  return pb_bchrpc_pb.SubmitTransactionResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_SubscribeBlocksRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.SubscribeBlocksRequest)) {
    throw new Error('Expected argument of type pb.SubscribeBlocksRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_SubscribeBlocksRequest(buffer_arg) {
  return pb_bchrpc_pb.SubscribeBlocksRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_SubscribeTransactionsRequest(arg) {
  if (!(arg instanceof pb_bchrpc_pb.SubscribeTransactionsRequest)) {
    throw new Error('Expected argument of type pb.SubscribeTransactionsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_SubscribeTransactionsRequest(buffer_arg) {
  return pb_bchrpc_pb.SubscribeTransactionsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_pb_TransactionNotification(arg) {
  if (!(arg instanceof pb_bchrpc_pb.TransactionNotification)) {
    throw new Error('Expected argument of type pb.TransactionNotification');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_pb_TransactionNotification(buffer_arg) {
  return pb_bchrpc_pb.TransactionNotification.deserializeBinary(new Uint8Array(buffer_arg));
}


// bchrpc contains a set of RPCs that can be exposed publicly via
// the command line options. This service could be authenticated or
// unauthenticated.
var bchrpcService = exports.bchrpcService = {
  // Get info about the mempool.
  getMempoolInfo: {
    path: '/pb.bchrpc/GetMempoolInfo',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetMempoolInfoRequest,
    responseType: pb_bchrpc_pb.GetMempoolInfoResponse,
    requestSerialize: serialize_pb_GetMempoolInfoRequest,
    requestDeserialize: deserialize_pb_GetMempoolInfoRequest,
    responseSerialize: serialize_pb_GetMempoolInfoResponse,
    responseDeserialize: deserialize_pb_GetMempoolInfoResponse,
  },
  // GetBlockchainInfo info about the blockchain including the most recent
  // block hash and height.
  getBlockchainInfo: {
    path: '/pb.bchrpc/GetBlockchainInfo',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetBlockchainInfoRequest,
    responseType: pb_bchrpc_pb.GetBlockchainInfoResponse,
    requestSerialize: serialize_pb_GetBlockchainInfoRequest,
    requestDeserialize: deserialize_pb_GetBlockchainInfoRequest,
    responseSerialize: serialize_pb_GetBlockchainInfoResponse,
    responseDeserialize: deserialize_pb_GetBlockchainInfoResponse,
  },
  // Get info about the given block.
  getBlockInfo: {
    path: '/pb.bchrpc/GetBlockInfo',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetBlockInfoRequest,
    responseType: pb_bchrpc_pb.GetBlockInfoResponse,
    requestSerialize: serialize_pb_GetBlockInfoRequest,
    requestDeserialize: deserialize_pb_GetBlockInfoRequest,
    responseSerialize: serialize_pb_GetBlockInfoResponse,
    responseDeserialize: deserialize_pb_GetBlockInfoResponse,
  },
  // Get a block.
  getBlock: {
    path: '/pb.bchrpc/GetBlock',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetBlockRequest,
    responseType: pb_bchrpc_pb.GetBlockResponse,
    requestSerialize: serialize_pb_GetBlockRequest,
    requestDeserialize: deserialize_pb_GetBlockRequest,
    responseSerialize: serialize_pb_GetBlockResponse,
    responseDeserialize: deserialize_pb_GetBlockResponse,
  },
  // Get a serialized block.
  getRawBlock: {
    path: '/pb.bchrpc/GetRawBlock',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetRawBlockRequest,
    responseType: pb_bchrpc_pb.GetRawBlockResponse,
    requestSerialize: serialize_pb_GetRawBlockRequest,
    requestDeserialize: deserialize_pb_GetRawBlockRequest,
    responseSerialize: serialize_pb_GetRawBlockResponse,
    responseDeserialize: deserialize_pb_GetRawBlockResponse,
  },
  // **Requires CfIndex**
  // Get a block filter.
  getBlockFilter: {
    path: '/pb.bchrpc/GetBlockFilter',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetBlockFilterRequest,
    responseType: pb_bchrpc_pb.GetBlockFilterResponse,
    requestSerialize: serialize_pb_GetBlockFilterRequest,
    requestDeserialize: deserialize_pb_GetBlockFilterRequest,
    responseSerialize: serialize_pb_GetBlockFilterResponse,
    responseDeserialize: deserialize_pb_GetBlockFilterResponse,
  },
  // This RPC sends a block locator object to the server and the server responds with
  // a batch of no more than 2000 headers. Upon parsing the block locator, if the server
  // concludes there has been a fork, it will send headers starting at the fork point,
  // or genesis if no blocks in the locator are in the best chain. If the locator is
  // already at the tip no headers will be returned.
  getHeaders: {
    path: '/pb.bchrpc/GetHeaders',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetHeadersRequest,
    responseType: pb_bchrpc_pb.GetHeadersResponse,
    requestSerialize: serialize_pb_GetHeadersRequest,
    requestDeserialize: deserialize_pb_GetHeadersRequest,
    responseSerialize: serialize_pb_GetHeadersResponse,
    responseDeserialize: deserialize_pb_GetHeadersResponse,
  },
  // Get a transaction given its hash.
  //
  // **Requires TxIndex**
  getTransaction: {
    path: '/pb.bchrpc/GetTransaction',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetTransactionRequest,
    responseType: pb_bchrpc_pb.GetTransactionResponse,
    requestSerialize: serialize_pb_GetTransactionRequest,
    requestDeserialize: deserialize_pb_GetTransactionRequest,
    responseSerialize: serialize_pb_GetTransactionResponse,
    responseDeserialize: deserialize_pb_GetTransactionResponse,
  },
  // Get a serialized transaction given its hash.
  //
  // **Requires TxIndex**
  getRawTransaction: {
    path: '/pb.bchrpc/GetRawTransaction',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetRawTransactionRequest,
    responseType: pb_bchrpc_pb.GetRawTransactionResponse,
    requestSerialize: serialize_pb_GetRawTransactionRequest,
    requestDeserialize: deserialize_pb_GetRawTransactionRequest,
    responseSerialize: serialize_pb_GetRawTransactionResponse,
    responseDeserialize: deserialize_pb_GetRawTransactionResponse,
  },
  // Returns the transactions for the given address. Offers offset,
  // limit, and from block options.
  //
  // **Requires AddressIndex**
  getAddressTransactions: {
    path: '/pb.bchrpc/GetAddressTransactions',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetAddressTransactionsRequest,
    responseType: pb_bchrpc_pb.GetAddressTransactionsResponse,
    requestSerialize: serialize_pb_GetAddressTransactionsRequest,
    requestDeserialize: deserialize_pb_GetAddressTransactionsRequest,
    responseSerialize: serialize_pb_GetAddressTransactionsResponse,
    responseDeserialize: deserialize_pb_GetAddressTransactionsResponse,
  },
  // Returns the raw transactions for the given address. Offers offset,
  // limit, and from block options.
  //
  // **Requires AddressIndex**
  getRawAddressTransactions: {
    path: '/pb.bchrpc/GetRawAddressTransactions',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetRawAddressTransactionsRequest,
    responseType: pb_bchrpc_pb.GetRawAddressTransactionsResponse,
    requestSerialize: serialize_pb_GetRawAddressTransactionsRequest,
    requestDeserialize: deserialize_pb_GetRawAddressTransactionsRequest,
    responseSerialize: serialize_pb_GetRawAddressTransactionsResponse,
    responseDeserialize: deserialize_pb_GetRawAddressTransactionsResponse,
  },
  // Returns all the unspent transaction outpoints for the given address.
  // Offers offset, limit, and from block options.
  //
  // **Requires AddressIndex**
  getAddressUnspentOutputs: {
    path: '/pb.bchrpc/GetAddressUnspentOutputs',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetAddressUnspentOutputsRequest,
    responseType: pb_bchrpc_pb.GetAddressUnspentOutputsResponse,
    requestSerialize: serialize_pb_GetAddressUnspentOutputsRequest,
    requestDeserialize: deserialize_pb_GetAddressUnspentOutputsRequest,
    responseSerialize: serialize_pb_GetAddressUnspentOutputsResponse,
    responseDeserialize: deserialize_pb_GetAddressUnspentOutputsResponse,
  },
  // Returns a merkle (SPV) proof that the given transaction is in the provided block.
  //
  // **Requires TxIndex***
  getMerkleProof: {
    path: '/pb.bchrpc/GetMerkleProof',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.GetMerkleProofRequest,
    responseType: pb_bchrpc_pb.GetMerkleProofResponse,
    requestSerialize: serialize_pb_GetMerkleProofRequest,
    requestDeserialize: deserialize_pb_GetMerkleProofRequest,
    responseSerialize: serialize_pb_GetMerkleProofResponse,
    responseDeserialize: deserialize_pb_GetMerkleProofResponse,
  },
  // Submit a transaction to all connected peers.
  submitTransaction: {
    path: '/pb.bchrpc/SubmitTransaction',
    requestStream: false,
    responseStream: false,
    requestType: pb_bchrpc_pb.SubmitTransactionRequest,
    responseType: pb_bchrpc_pb.SubmitTransactionResponse,
    requestSerialize: serialize_pb_SubmitTransactionRequest,
    requestDeserialize: deserialize_pb_SubmitTransactionRequest,
    responseSerialize: serialize_pb_SubmitTransactionResponse,
    responseDeserialize: deserialize_pb_SubmitTransactionResponse,
  },
  // Subscribe to relevant transactions based on the subscription requests.
  // The parameters to filter transactions on can be updated by sending new
  // SubscribeTransactionsRequest objects on the stream.
  //
  // This RPC does not use bi-directional streams and therefore can be used
  // with grpc-web. You will need to close and re-open the stream whenever
  // you want to update the addresses. If you are not using grpc-web
  // then SubscribeTransactionStream is more appropriate.
  //
  // **Requires TxIndex to receive input metadata**
  subscribeTransactions: {
    path: '/pb.bchrpc/SubscribeTransactions',
    requestStream: false,
    responseStream: true,
    requestType: pb_bchrpc_pb.SubscribeTransactionsRequest,
    responseType: pb_bchrpc_pb.TransactionNotification,
    requestSerialize: serialize_pb_SubscribeTransactionsRequest,
    requestDeserialize: deserialize_pb_SubscribeTransactionsRequest,
    responseSerialize: serialize_pb_TransactionNotification,
    responseDeserialize: deserialize_pb_TransactionNotification,
  },
  // Subscribe to relevant transactions based on the subscription requests.
  // The parameters to filter transactions on can be updated by sending new
  // SubscribeTransactionsRequest objects on the stream.
  //
  // Because this RPC using bi-directional streaming it cannot be used with
  // grpc-web.
  //
  // **Requires TxIndex to receive input metadata**
  subscribeTransactionStream: {
    path: '/pb.bchrpc/SubscribeTransactionStream',
    requestStream: true,
    responseStream: true,
    requestType: pb_bchrpc_pb.SubscribeTransactionsRequest,
    responseType: pb_bchrpc_pb.TransactionNotification,
    requestSerialize: serialize_pb_SubscribeTransactionsRequest,
    requestDeserialize: deserialize_pb_SubscribeTransactionsRequest,
    responseSerialize: serialize_pb_TransactionNotification,
    responseDeserialize: deserialize_pb_TransactionNotification,
  },
  // Subscribe to notifications of new blocks being connected to the blockchain
  // or blocks being disconnected.
  subscribeBlocks: {
    path: '/pb.bchrpc/SubscribeBlocks',
    requestStream: false,
    responseStream: true,
    requestType: pb_bchrpc_pb.SubscribeBlocksRequest,
    responseType: pb_bchrpc_pb.BlockNotification,
    requestSerialize: serialize_pb_SubscribeBlocksRequest,
    requestDeserialize: deserialize_pb_SubscribeBlocksRequest,
    responseSerialize: serialize_pb_BlockNotification,
    responseDeserialize: deserialize_pb_BlockNotification,
  },
};

exports.bchrpcClient = grpc.makeGenericClientConstructor(bchrpcService);
