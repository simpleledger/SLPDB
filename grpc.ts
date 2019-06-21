// Example use of BCHD's gRPC bchrpc with nodejs. 

// NOTES: 
// 1. Using localhost requires `export NODE_TLS_REJECT_UNAUTHORIZED=0` 

import * as fs from 'fs';
import * as grpc from 'grpc';
import * as bchrpc from './pb/bchrpc_pb'
import * as bchrpc_grpc from './pb/bchrpc_grpc_pb';

const rootCert = fs.readFileSync('/Users/jamescramer/Library/Application\ Support/Bchd/rpc.cert');
var client = new bchrpc_grpc.bchrpcClient('localhost:8335', grpc.credentials.createSsl(rootCert));  // as service.bchrpcClient;

client.getMempoolInfo(new bchrpc.GetMempoolInfoRequest(), (error: grpc.ServiceError|null, resp: bchrpc.GetMempoolInfoResponse|null) => {
    if (error) {
        console.log("Error: " + error.code + ": " + error.message)
        console.log(error)
    } else {
    var mempool = resp
    console.log("\nGetMempoolInfo:")
    console.log(mempool!.toObject())
    }
});

// Get a raw tx from tx hash

const changeEndianness = (string: string) => {
    const result = [];
    let len = string.length - 2;
    while (len >= 0) {
      result.push(string.substr(len, 2));
      len -= 2;
    }
    return result.join('');
}


var hex = changeEndianness("fe58d09c218d6ea1a0d1ce726d1c5aa6e9c01a9e760aab621484aa21b1f673fb")  //Buffer.from(changeEndianness("fe58d09c218d6ea1a0d1ce726d1c5aa6e9c01a9e760aab621484aa21b1f673fb"),'hex'); //changeEndianness("fe58d09c218d6ea1a0d1ce726d1c5aa6e9c01a9e760aab621484aa21b1f673fb")
var bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))

var getRawTransactionRequest = new bchrpc.GetRawTransactionRequest()
getRawTransactionRequest.setHash(bytes)

client.getRawTransaction(getRawTransactionRequest, function(error, resp) {
    if (error) {
        console.log("Error: " + error.code + ": " + error.message)
        console.log(error)
    } else {
    var tx = resp
    console.log("\nGetRawTransaction:")
    console.log(tx.toObject())
    }
});

// Get deserialized tx from tx hash

var getTransactionRequest = new bchrpc.GetTransactionRequest();
getTransactionRequest.setHash(bytes);

client.getTransaction(getTransactionRequest, function(error, resp) {
    if (error) {
        console.log("Error: " + error.code + ": " + error.message)
        console.log(error)
    } else {
    var tx = resp
    console.log("\nGetTransaction:")
    console.log(tx.toObject())
    }
});


// Setup live transaction stream

var transactionFilter = new bchrpc.TransactionFilter();
transactionFilter.setAllTransactions(true);

var subscribreTransactionsRequest = new bchrpc.SubscribeTransactionsRequest()
subscribreTransactionsRequest.setIncludeMempool(true)
subscribreTransactionsRequest.setSubscribe(transactionFilter)

var stream = client.subscribeTransactions(subscribreTransactionsRequest)

stream.on('data', function(message: bchrpc.TransactionNotification) {
    var tx = message
    console.log("\nSubscribeTransactions stream:")
    console.log(tx.toObject().unconfirmedTransaction!.transaction!.hash.toString())
});
stream.on('status', function(status: any) {
    console.log("\nSubscribeTransactions status:")
    console.log(status.toObject())
});
stream.on('end', function(status: any) {
    console.log("\nSubscribeTransactions end:")
    console.log(status.toObject())
});