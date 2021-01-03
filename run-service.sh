#!/bin/bash

cd /root/SLPDB/

echo "Compiling..."
./node_modules/typescript/bin/tsc
echo "Compiling done."

echo "Checking for DB migrations..."
export db_url=mongodb://127.0.0.1:27017
./node_modules/migrate-mongo/bin/migrate-mongo.js up
echo "Finished DB migrations."

FLAG=./ctl/REPROCESS
if [ -f "$FLAG" ]; then
	echo "Found REPROCESS file flag"
	echo "node --max_old_space_size=8192 ./index.js run --reprocess"
        node --max_old_space_size=8192 ./index.js run --reprocess
else
	echo "Starting normally based on CMD"
	echo "node --max_old_space_size=8192 ./index.js $@"
	node --max_old_space_size=8192 ./index.js "$@"
fi

