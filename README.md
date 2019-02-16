
# SLPDB

### Steps for alpha testing SLPDB: 

A) get mongodb running on port 27017, e.g.,:
`docker run -d -p 27017:27017 -v /Users/jamescramer/Source/slpdb/_mongo:/data/db mongo`

B) Install deps: `npm install`

C) Start SLPDB: `npm start`, and then wait for sync process to complete (after console stops updating).

D) In another console, run example query script: `node ./examples/addresses.js`