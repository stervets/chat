#!/usr/bin/env bash
rm ./chat*.zip
git archive -o chat$1.zip HEAD
#cp ./chat$1.zip ../celesta/download/
