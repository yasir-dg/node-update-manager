"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const rest_1 = require("@octokit/rest");
const simple_git_1 = __importDefault(require("simple-git"));
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const os_1 = __importDefault(require("os"));
const helpers_1 = require("./helpers");
dotenv_1.default.config();
const GITHUB_TOKEN = process.env.OCTOKIT_AUTH;
const octokit = new rest_1.Octokit({
    auth: `token ${GITHUB_TOKEN}`,
});
const execPromise = util_1.default.promisify(child_process_1.exec);
async function findRepos() {
    try {
        const { data } = await octokit.search.repos({
            //ensures repositories that contain dgx-common libraries are returned but not services.
            q: 'dgx-common in:name ',
            sort: 'updated',
            order: 'desc',
        });
        const filteredRepos = data.items.filter(repo => !repo.name.includes('service'));
        return filteredRepos;
    }
    catch (error) {
        console.error('Failed to fetch repositories:', error);
        return [];
    }
}
async function updateRepository(repo) {
    const repoPath = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'repo-'));
    const gitClient = (0, simple_git_1.default)();
    const repoUrl = `git@github.com:/${repo.full_name}.git`;
    try {
        await gitClient.clone(repoUrl, repoPath);
    }
    catch (error) {
        console.error(`Failed to clone repository ${repoUrl}:`, error);
        fs_1.default.rmSync(repoPath, { recursive: true, force: true });
        return;
    }
    const packageJsonPath = path_1.default.join(repoPath, 'package.json');
    const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.engines === undefined || packageJson.engines === null) {
        return;
    }
    delete packageJson.engines;
    packageJson.version = (0, helpers_1.updateNodePackageVersion)(packageJson.version);
    (0, helpers_1.updateNpmrc)(packageJsonPath, packageJson, repoPath);
    fs_1.default.writeFileSync(path_1.default.join(repoPath, '.nvmrc'), '18\n');
    try {
        const { stdout, stderr } = await execPromise('npm install', {
            cwd: repoPath,
        });
        console.log(stdout);
        if (stderr) {
            console.error('npm install errors:', stderr);
        }
    }
    catch (error) {
        console.error('Failed to run npm install:', error);
        return;
    }
    const { data: repoDetails } = await octokit.repos.get({
        owner: repo.owner.login,
        repo: repo.name
    });
    const defaultBranch = repoDetails.default_branch;
    const branchName = 'remove-node-engines';
    await gitClient.cwd(repoPath).checkoutLocalBranch(branchName);
    await gitClient.add('./*');
    await gitClient.commit('Update package configurations including package-lock.json');
    await gitClient.push('origin', branchName);
    await (0, helpers_1.createPullRequest)(octokit, repo, branchName, defaultBranch, repoPath);
}
async function processUpdate() {
    const repos = await findRepos();
    for (const repo of repos) {
        await updateRepository(repo);
        await (0, helpers_1.delay)(5000);
    }
}
processUpdate();
