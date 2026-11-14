#!/bin/sh
# Prints the image of an e2e compose service, so dependabot's pins there are the only ones.
image=$(awk -v service="$1" '/^    [^ ]/ { found = $0 == "    " service ":" } found && $1 == "image:" { print $2; exit }' "${2:-e2e/docker-compose.e2e.yml}")
[ -n "$image" ] || { echo "no image for service $1" >&2; exit 1; }
echo "$image"
