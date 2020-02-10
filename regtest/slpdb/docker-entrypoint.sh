#!/bin/bash

echo "Compiling..."
./node_modules/typescript/bin/tsc
echo "Compiling done."

echo "Checking for DB migrations..."
export db_url=mongodb://mongo:27017
./node_modules/migrate-mongo/bin/migrate-mongo.js up
echo "Finished DB migrations."

echo "node --max_old_space_size=8192 ./index.js $@"
node --max_old_space_size=8192 ./index.js "$@"
