#!/bin/bash

echo "INFO: Cleaning up from previous runs..."
docker-compose down

echo "INFO: Creating regtest network from source"
docker-compose up -d

echo "INFO: Running mocha tests in docker"
docker-compose exec slpdb ./regtest/_test.sh
exit_code=$?

if [ $exit_code -eq 0 ]; then
  echo "INFO: All regtest network tests pass (code: $exit_code)"
else
  echo "ERROR: One or more regtest network tests failed (code: $exit_code)"
fi

echo "INFO: Cleaning up."
docker-compose down

exit $exit_code
