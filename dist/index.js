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
dotenv_1.default.config();
const GITHUB_TOKEN = process.env.OCTOKIT_AUTH;
const octokit = new rest_1.Octokit({
    auth: `token ${GITHUB_TOKEN}`,
});
const execPromise = util_1.default.promisify(child_process_1.exec);
async function findRepos() {
    try {
        const { data } = await octokit.search.repos({
            q: 'dgx-common in:name',
            sort: 'updated',
            order: 'desc',
        });
        return data.items;
    }
    catch (error) {
        console.error('Failed to fetch repositories:', error);
        return [];
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function updateRepository(repo) {
    const repoPath = path_1.default.join(__dirname, '..', 'repos', repo.name);
    const gitClient = (0, simple_git_1.default)();
    const repoUrl = `git@github.com:/${repo.full_name}.git`;
    if (!fs_1.default.existsSync(repoPath)) {
        fs_1.default.mkdirSync(repoPath, { recursive: true });
    }
    try {
        await gitClient.clone(repoUrl, repoPath);
    }
    catch (error) {
        console.error(`Failed to clone repository ${repoUrl}:`, error);
        return;
    }
    const packageJsonPath = path_1.default.join(repoPath, 'package.json');
    const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.engines === undefined || packageJson.engines === null) {
        return;
    }
    delete packageJson.engines;
    fs_1.default.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    const npmrcPath = path_1.default.join(repoPath, '.npmrc');
    const npmrcContent = fs_1.default.existsSync(npmrcPath)
        ? fs_1.default.readFileSync(npmrcPath, 'utf8')
        : '';
    fs_1.default.writeFileSync(npmrcPath, npmrcContent + '\nengine-strict=false\n');
    fs_1.default.writeFileSync(path_1.default.join(repoPath, '.nvmrc'), '18');
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
    const branchName = 'update-node-versions';
    await gitClient.cwd(repoPath).checkoutLocalBranch(branchName);
    await gitClient.add('./*');
    await gitClient.commit('Update package configurations including package-lock.json');
    await gitClient.push('origin', branchName);
    let defaultBranch = 'main';
    try {
        const { data: repoDetails } = await octokit.repos.get({
            owner: repo.owner.login,
            repo: repo.name,
        });
        defaultBranch = repoDetails.default_branch;
    }
    catch (error) {
        console.error(`Failed to get repository details for ${repo.name}:`, error);
    }
    const { data: pr } = await octokit.pulls.create({
        owner: repo.owner.login,
        repo: repo.name,
        title: 'Update Node version',
        head: branchName,
        base: defaultBranch,
        body: 'This PR updates package.json, .npmrc, .nvmrc and package-lock.json to node 18',
    });
    console.log(`Created PR: ${pr.html_url}`);
}
async function processUpdate() {
    const repos = await findRepos();
    for (const repo of repos) {
        await updateRepository(repo);
        await delay(5000);
    }
}
processUpdate();
