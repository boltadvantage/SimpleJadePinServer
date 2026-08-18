#!/usr/bin/env bash
#
# Sign a draft release from an offline machine.
#
# The release signing key is never given to CI. This script pulls the draft
# release's artifacts down, re-computes the checksums from the actual files
# rather than trusting the published manifest, signs the manifest locally, and
# uploads only the detached signature.
#
# Usage:
#   scripts/sign-release.sh v1.0.0
#
# Requires: gh (authenticated), gpg, sha256sum or shasum.

set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
    echo "usage: $0 <tag>   e.g. $0 v1.0.0" >&2
    exit 1
fi

REPO="${REPO:-boltadvantage/SimpleJadePinServer}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Downloading assets for $TAG from $REPO"
gh release download "$TAG" --repo "$REPO" --dir "$WORKDIR" --clobber

cd "$WORKDIR"

if [ ! -f SHA256SUMS ]; then
    echo "error: the release has no SHA256SUMS asset" >&2
    exit 1
fi

# Recompute from the files themselves. If CI published a manifest that does not
# match its own artifacts, that is a red flag and must stop the signing.
if command -v sha256sum >/dev/null 2>&1; then
    SUM="sha256sum"
else
    SUM="shasum -a 256"
fi

echo
echo "Recomputing checksums from the downloaded artifacts"
$SUM $(ls | grep -vE '^SHA256SUMS(\.asc)?$') > RECOMPUTED

# Compare as sorted sets so asset ordering cannot cause a false mismatch.
if ! diff <(sort SHA256SUMS) <(sort RECOMPUTED) >/dev/null; then
    echo >&2
    echo "REFUSING TO SIGN: published SHA256SUMS does not match the artifacts." >&2
    echo >&2
    diff <(sort SHA256SUMS) <(sort RECOMPUTED) >&2 || true
    exit 1
fi

echo "Published manifest matches the artifacts."
echo
cat SHA256SUMS
echo
read -r -p "Sign this manifest? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || { echo "Aborted."; exit 1; }

gpg --armor --detach-sign --output SHA256SUMS.asc SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS

echo
echo "Uploading SHA256SUMS.asc to $TAG"
gh release upload "$TAG" SHA256SUMS.asc --repo "$REPO" --clobber

echo
echo "Done. The release is still a draft - publish it once you are satisfied."
