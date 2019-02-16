let mongo = require("mongodb");
let BigNumber = require('bignumber.js');

createBigNumber = function(e, c) {
    let a = new BigNumber(0);
    a.e = e;
    a.c = c;
    return a;
}

const queries = {
    async addresses(tokenId) {
        let client = await mongo.MongoClient.connect("mongodb://0.0.0.0:27017", { useNewUrlParser: true });
        let db = client.db("bitdb");
        let res = await db.collection('tokens').findOne({ "tokenDetails.tokenIdHex": tokenId });
        let decimals = res.tokenDetails.decimals;
        let addresses = []
        Object.keys(res.addresses).forEach((k, i, a) => addresses.push({ addr: k, tokens: createBigNumber(res.addresses[k].token_balance.e, res.addresses[k].token_balance.c).dividedBy(10**decimals).toString()}))
        console.log(addresses);
        return;
    }
}

queries.addresses("df808a41672a0a0ae6475b44f272a107bc9961b90f29dc918d71301f24fe92fb");
