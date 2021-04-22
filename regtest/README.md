# Regtest tests

Tests are provided for SLPDB using a docker compose network that has two bitcoin node containers, one mongo db container, and one SLPDB container.  Tests are run using mocha and cover the expected data written to MongoDB for various scenarios that would be expected in a live network.  Continuous integration tests have been setup using Travis CI (see `../.travis.yml`).

## Run the tests

`$ cd ./regtest && ./test.sh`