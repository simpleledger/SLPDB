#!/bin/bash

git apply ./patches/*

export RPC1_HOST="bitcoin1"
export RPC1_PORT="18443"
export RPC2_HOST="bitcoin2"
export RPC2_PORT="18443"
export MONGO_HOST="mongo"
export MONGO_PORT="27017"

npm test