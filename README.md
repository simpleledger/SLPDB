
# SLPDB

### Steps for alpha testing SLPDB: 

1) Get mongodb running locally on port 27017, e.g.,:
`docker run -d -p 27017:27017 -v <absolute-path-to-data>:/data/db mongo`

2) Get bitcoind rpc connection running locally, set `user`, `pass`, and `port` in `config.ts`

3) Install deps: `npm install`

4) Start SLPDB: `npm start`, and then wait for sync process to complete (after console stops updating).
    * First SLPDB will need to sync all SLP transactions since SLP started
    * Second SLPDB will build token graphs for each token

5) In another console, run example query script: `node ./examples/addresses.js`

6) Make SLP transactions and see the information update for the particular token, check that the db addresses updated properly.

### NOTES

* The following are being calculated and updated in real-time:
    `qty_valid_txns_since_genesis`
    `qty_valid_token_utxos`
    `qty_valid_token_addresses`
    `qty_token_circulating_supply`
    `qty_token_burned`
    `qty_token_minted`

Statistics not being computed:
    `qty_satoshis_locked_up`
