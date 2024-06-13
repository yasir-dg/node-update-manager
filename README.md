# node-update-manager

This codebase removes node engines from all `dgx-common` repos and does the following:

1. sets `engine-strict=false` in `.npmrc`
2. creates an `.nvmrc` and adds it to `18`
3. removes node engines block from `package.json` file

## Running the repo

1. `git clone git@github.com:yasir-dg/node-update-manager.git`
2. `npm i`
3. `npm run start`
